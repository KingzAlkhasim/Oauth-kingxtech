import type { Sandbox } from '@vercel/sandbox' with { "resolution-mode": "import" };
import { listProjectFilesWithContent, assertProjectOwnership, replacePublishedBuild, type PublishedBuildFile } from './projectFs';
import { getProjectEnvVarsForRuntime } from './projectEnvVars';

const PROJECT_ROOT = '/vercel/sandbox/project';
const SANDBOX_TIMEOUT_MS = 45 * 60 * 1000;

// Keep several common web ports exposed so Vite, Next.js, Express and
// generic Node apps can all get a browser preview without changing the
// sandbox security boundary.
const EXPOSED_PORTS = [3000, 3001, 4173, 5173, 8080];

type SandboxModule = typeof import('@vercel/sandbox', { with: { "resolution-mode": "import" } });
let sandboxModulePromise: Promise<SandboxModule> | null = null;

async function loadSandboxModule(): Promise<SandboxModule> {
  // NeuroCore is compiled as CommonJS, while @vercel/sandbox exposes its
  // ESM build through the import condition. TypeScript would otherwise
  // rewrite import() to require(), which makes Node load the SDK's CJS build
  // and crash when it requires the ESM-only @workflow/serde package.
  if (!sandboxModulePromise) {
    const nativeImport = new Function('return import("@vercel/sandbox")') as () => Promise<SandboxModule>;
    sandboxModulePromise = nativeImport();
  }
  return sandboxModulePromise;
}

export interface RuntimeResult {
  sandboxName: string;
  url: string;
  port: number;
  framework: string;
  packageManager: string;
}

function sandboxName(projectId: string): string {
  return `kx-project-${projectId.replace(/[^a-zA-Z0-9-]/g, '').slice(0, 48)}`;
}

function detectPackageManager(paths: string[]): 'npm' | 'pnpm' | 'yarn' | 'bun' {
  if (paths.includes('pnpm-lock.yaml')) return 'pnpm';
  if (paths.includes('yarn.lock')) return 'yarn';
  if (paths.includes('bun.lock') || paths.includes('bun.lockb')) return 'bun';
  return 'npm';
}

function detectRuntime(packageJson: any): { framework: string; port: number; args: string[] } {
  const deps = {
    ...(packageJson?.dependencies ?? {}),
    ...(packageJson?.devDependencies ?? {}),
  };
  const scripts = packageJson?.scripts ?? {};
  const devScript = typeof scripts.dev === 'string' ? scripts.dev : '';

  if (deps.vite || /vite/i.test(devScript)) {
    return {
      framework: 'Vite',
      port: 5173,
      args: ['run', 'dev', '--', '--host', '0.0.0.0', '--port', '5173'],
    };
  }

  if (deps.next || /next/i.test(devScript)) {
    return {
      framework: 'Next.js',
      port: 3000,
      args: ['run', 'dev', '--', '-H', '0.0.0.0', '-p', '3000'],
    };
  }

  if (deps.express || deps['@types/express']) {
    return {
      framework: 'Node/Express',
      port: 3000,
      args: ['run', 'dev'],
    };
  }

  return {
    framework: 'Node.js',
    port: 3000,
    args: ['run', 'dev'],
  };
}

async function getSandbox(projectId: string): Promise<Sandbox> {
  const { Sandbox } = await loadSandboxModule();
  return Sandbox.getOrCreate({
    name: sandboxName(projectId),
    runtime: 'node24',
    timeout: SANDBOX_TIMEOUT_MS,
    ports: EXPOSED_PORTS,
  });
}

async function syncFiles(userId: string, projectId: string, sandbox: Sandbox): Promise<ProjectFileContentForSandbox[]> {
  await assertProjectOwnership(userId, projectId);
  const files = await listProjectFilesWithContent(userId, projectId);
  const payload = files
    .filter((file) => typeof file.content === 'string')
    .map((file) => ({
      path: `${PROJECT_ROOT}/${file.path}`,
      content: Buffer.from(file.content ?? '', 'utf8'),
    }));

  if (payload.length > 0) {
    await sandbox.writeFiles(payload);
  }

  return files.map((file) => ({ path: file.path, content: file.content ?? '' }));
}

interface ProjectFileContentForSandbox {
  path: string;
  content: string;
}

function installCommand(packageManager: string): { cmd: string; args: string[] } {
  switch (packageManager) {
    case 'pnpm': return { cmd: 'pnpm', args: ['install', '--no-frozen-lockfile'] };
    case 'yarn': return { cmd: 'yarn', args: ['install'] };
    case 'bun': return { cmd: 'bun', args: ['install'] };
    default: return { cmd: 'npm', args: ['install', '--no-audit', '--no-fund'] };
  }
}

function commandForPackageManager(packageManager: string): string {
  return packageManager === 'pnpm'
    ? 'pnpm'
    : packageManager === 'yarn'
      ? 'yarn'
      : packageManager === 'bun'
        ? 'bun'
        : 'npm';
}

const VERIFY_PROJECT_TIMEOUT_MS = 120_000;
const VERIFY_OUTPUT_MAX_CHARS = 12_000;

function trimVerifyOutput(value: string): string {
  const text = value.trim();
  if (text.length <= VERIFY_OUTPUT_MAX_CHARS) return text;
  const half = Math.floor((VERIFY_OUTPUT_MAX_CHARS - 80) / 2);
  return text.slice(0, half) + '\n… [output trimmed] …\n' + text.slice(-half);
}

async function runVerifyCommand(sandbox: Sandbox, command: { cmd: string; args: string[] }, cwd: string, deadlineAt: number, timeoutMs: number) {
  const remainingMs = deadlineAt - Date.now();
  if (remainingMs <= 0) return { timedOut: true, exitCode: -1, stdout: '', stderr: 'Verification time limit reached.' };
  const effectiveTimeout = Math.min(timeoutMs, remainingMs);
  let timer: NodeJS.Timeout | undefined;
  try {
    const result = await Promise.race([
      sandbox.runCommand({ ...command, cwd, timeoutMs: effectiveTimeout }),
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(Object.assign(new Error('Verification time limit reached.'), { code: 'VERIFY_TIMEOUT' })), effectiveTimeout + 1000);
      }),
    ]);
    return { timedOut: false, exitCode: result.exitCode, stdout: await result.stdout(), stderr: await result.stderr() };
  } catch (error) {
    if ((error as { code?: string })?.code === 'VERIFY_TIMEOUT') return { timedOut: true, exitCode: -1, stdout: '', stderr: 'Verification time limit reached.' };
    throw error;
  } finally {
    if (timer) clearTimeout(timer);
  }
}

export async function verifyProject(userId: string, projectId: string): Promise<{
  ok: boolean;
  installed: boolean;
  timedOut: boolean;
  durationMs: number;
  tsc: { exitCode: number; output: string };
  vite: { exitCode: number; output: string };
}> {
  await assertProjectOwnership(userId, projectId);
  const startedAt = Date.now();
  const deadlineAt = startedAt + VERIFY_PROJECT_TIMEOUT_MS;
  const sandbox = await getSandbox(projectId);
  const files = await syncFiles(userId, projectId, sandbox);
  const packageFile = files.find((file) => file.path === 'package.json');
  if (!packageFile) throw new Error('Project verification requires a package.json file.');
  try { JSON.parse(packageFile.content); } catch { throw new Error('Project verification could not parse package.json.'); }

  const packageManager = detectPackageManager(files.map((file) => file.path));
  const hasNodeModules = await sandbox.runCommand({ cmd: 'test', args: ['-d', 'node_modules'], cwd: PROJECT_ROOT, timeoutMs: 5_000 });
  let installed = false;
  if (hasNodeModules.exitCode !== 0) {
    const { cmd, args } = installCommand(packageManager);
    const install = await runVerifyCommand(sandbox, { cmd, args }, PROJECT_ROOT, deadlineAt, 60_000);
    if (install.timedOut) return { ok: false, installed: false, timedOut: true, durationMs: Date.now() - startedAt, tsc: { exitCode: -1, output: 'Skipped because dependency installation timed out.' }, vite: { exitCode: -1, output: 'Skipped because dependency installation timed out.' } };
    if (install.exitCode !== 0) return { ok: false, installed: false, timedOut: false, durationMs: Date.now() - startedAt, tsc: { exitCode: -1, output: 'Skipped because dependency installation failed.' }, vite: { exitCode: -1, output: trimVerifyOutput(install.stderr || install.stdout || 'Dependency installation failed.') } };
    installed = true;
  }

  const tsc = await runVerifyCommand(sandbox, { cmd: './node_modules/.bin/tsc', args: ['--noEmit'] }, PROJECT_ROOT, deadlineAt, 45_000);
  const tscOutput = trimVerifyOutput(tsc.stderr || tsc.stdout || (tsc.exitCode === 0 ? 'TypeScript check passed.' : 'TypeScript check failed.'));
  const verifyDir = '.kx-verify-dist';
  await sandbox.runCommand({ cmd: 'rm', args: ['-rf', verifyDir], cwd: PROJECT_ROOT, timeoutMs: 5_000 });
  const vite = await runVerifyCommand(sandbox, { cmd: './node_modules/.bin/vite', args: ['build', '--outDir', verifyDir, '--emptyOutDir'] }, PROJECT_ROOT, deadlineAt, 60_000);
  await sandbox.runCommand({ cmd: 'rm', args: ['-rf', verifyDir], cwd: PROJECT_ROOT, timeoutMs: 5_000 }).catch(() => undefined);
  const viteOutput = trimVerifyOutput(vite.stderr || vite.stdout || (vite.exitCode === 0 ? 'Vite build passed.' : 'Vite build failed.'));
  const timedOut = tsc.timedOut || vite.timedOut || Date.now() >= deadlineAt;
  return { ok: !timedOut && tsc.exitCode === 0 && vite.exitCode === 0, installed, timedOut, durationMs: Date.now() - startedAt, tsc: { exitCode: tsc.exitCode, output: tscOutput }, vite: { exitCode: vite.exitCode, output: viteOutput } };
}

export async function buildProjectForPublish(userId: string, projectId: string): Promise<{ framework: string; fileCount: number }> {
  const sandbox = await getSandbox(projectId);
  const files = await syncFiles(userId, projectId, sandbox);
  const packageFile = files.find((file) => file.path === 'package.json');
  const packageJson = packageFile ? JSON.parse(packageFile.content) : null;

  // Static HTML/CSS/JS projects do not need a package manager or build step.
  // Publish their source tree directly when an index.html entry point exists.
  if (!packageJson) {
    const staticFiles = files.filter((file) =>
      file.path !== '.kingxtech-dist' && !file.path.startsWith('.kingxtech-dist/')
    );
    if (!staticFiles.some((file) => file.path === 'index.html')) {
      throw new Error('Static publishing requires an index.html file.');
    }

    const publishedFiles: PublishedBuildFile[] = staticFiles.map((file) => {
      const content = file.content ?? '';
      const binaryPrefix = '__KX_BINARY_BASE64__:';
      return content.startsWith(binaryPrefix)
        ? { path: file.path, content: content.slice(binaryPrefix.length), isBinary: true }
        : { path: file.path, content };
    });

    await replacePublishedBuild(userId, projectId, publishedFiles);
    return { framework: 'Static HTML', fileCount: publishedFiles.length };
  }

  const packageManager = detectPackageManager(files.map((file) => file.path));
  const projectEnv = await getProjectEnvVarsForRuntime(userId, projectId);
  const runtime = detectRuntime(packageJson);
  if (runtime.framework !== 'Vite') {
    throw new Error('Permanent publishing currently supports Vite projects. Use Preview for other runtime-based projects.');
  }

  const { cmd: installCmd, args: installArgs } = installCommand(packageManager);
  const install = await sandbox.runCommand({ cmd: installCmd, args: installArgs, cwd: PROJECT_ROOT, env: projectEnv, timeoutMs: 180_000 });
  if (install.exitCode !== 0) {
    const stderr = (await install.stderr()).trim();
    throw new Error(`Dependency install failed: ${stderr || `exit code ${install.exitCode}`}`);
  }

  // Build into a private directory so the published renderer can serve the
  // compiled browser assets without exposing source TS/TSX files. Vite's
  // relative base is intentional: /site/:slug/ is a nested public path.
  await sandbox.runCommand({
    cmd: 'rm',
    args: ['-rf', `.kingxtech-dist`],
    cwd: PROJECT_ROOT,
  });

  const build = await sandbox.runCommand({
    cmd: './node_modules/.bin/vite',
    args: ['build', '--base', './', '--outDir', '.kingxtech-dist'],
    cwd: PROJECT_ROOT,
    env: projectEnv,
    timeoutMs: 180_000,
  });
  if (build.exitCode !== 0) {
    const stderr = (await build.stderr()).trim();
    const stdout = (await build.stdout()).trim();
    throw new Error(`Vite production build failed: ${stderr || stdout || `exit code ${build.exitCode}`}`);
  }

  const listing = await sandbox.runCommand({
    cmd: 'find',
    args: ['.kingxtech-dist', '-type', 'f', '-print'],
    cwd: PROJECT_ROOT,
  });
  if (listing.exitCode !== 0) throw new Error('Could not inspect the generated publish build.');

  const paths = (await listing.stdout()).split('\n').map((line) => line.trim()).filter(Boolean);
  const builtFiles: PublishedBuildFile[] = [];
  for (const relative of paths) {
    const distPrefix = '.kingxtech-dist/';
    const path = relative.startsWith(distPrefix) ? relative.slice(distPrefix.length) : relative;
    const buffer = await sandbox.readFileToBuffer({ path: `${PROJECT_ROOT}/${relative}` });
    if (!buffer) continue;
    const isBinary = /\.(png|jpe?g|gif|webp|ico|avif|woff2?|ttf|otf|mp3|mp4|webm|wasm)$/i.test(path);
    builtFiles.push({
      path,
      content: isBinary ? buffer.toString('base64') : buffer.toString('utf8'),
      isBinary,
    });
  }

  await replacePublishedBuild(userId, projectId, builtFiles);
  return { framework: runtime.framework, fileCount: builtFiles.length };
}

export async function startProjectRuntime(userId: string, projectId: string): Promise<RuntimeResult> {
  const sandbox = await getSandbox(projectId);
  const files = await syncFiles(userId, projectId, sandbox);
  const packageFile = files.find((file) => file.path === 'package.json');
  const packageJson = packageFile ? JSON.parse(packageFile.content) : null;

  if (!packageJson) {
    throw new Error('This project has no package.json yet. Create a Node/Vite/React project first.');
  }

  if (!packageJson.scripts?.dev || typeof packageJson.scripts.dev !== 'string') {
    throw new Error('This project needs a "dev" script in package.json to start a live preview.');
  }

  const packageManager = detectPackageManager(files.map((file) => file.path));
  const projectEnv = await getProjectEnvVarsForRuntime(userId, projectId);
  const runtime = detectRuntime(packageJson);
  const { cmd: installCmd, args: installArgs } = installCommand(packageManager);

  const install = await sandbox.runCommand({
    cmd: installCmd,
    args: installArgs,
    cwd: PROJECT_ROOT,
    env: projectEnv,
  });

  if (install.exitCode !== 0) {
    const stderr = (await install.stderr()).trim();
    throw new Error(`Dependency install failed: ${stderr || `exit code ${install.exitCode}`}`);
  }

  let runner = commandForPackageManager(packageManager);

  // Vite 6.0.9+ introduced stricter Host-header protection, and the 6.0.9+
  // 6.0.x line has a known regression where allowedHosts can be ignored.
  // A project declaring ^6.0.3 can therefore resolve to an affected 6.0.x
  // release even though the user did not explicitly choose it. In the
  // disposable sandbox only, pin affected 6.0.x installs to 6.0.8, which
  // predates the regression. The user's package.json/lockfile is never edited.
  if (runtime.framework === 'Vite' && packageManager === 'npm') {
    const versionCheck = await sandbox.runCommand({
      cmd: 'npm',
      args: ['ls', 'vite', '--depth=0', '--json'],
      cwd: PROJECT_ROOT,
      timeoutMs: 30_000,
    });
    try {
      const tree = JSON.parse((await versionCheck.stdout()).trim() || '{}');
      const installedVersion = tree?.dependencies?.vite?.version;
      const match = typeof installedVersion === 'string'
        ? installedVersion.match(/^(\d+)\.(\d+)\.(\d+)$/)
        : null;
      const major = match ? Number(match[1]) : 0;
      const minor = match ? Number(match[2]) : 0;
      const patch = match ? Number(match[3]) : 0;
      if (major === 6 && minor === 0 && patch >= 9) {
        const compatibilityInstall = await sandbox.runCommand({
          cmd: 'npm',
          args: ['install', 'vite@6.0.8', '--no-save', '--no-audit', '--no-fund'],
          cwd: PROJECT_ROOT,
          timeoutMs: 120_000,
        });
        if (compatibilityInstall.exitCode !== 0) {
          const stderr = (await compatibilityInstall.stderr()).trim();
          throw new Error('Vite compatibility install failed: ' + (stderr || 'exit code ' + compatibilityInstall.exitCode));
        }
      }
    } catch (error) {
      if (error instanceof Error && /Vite compatibility install failed/.test(error.message)) throw error;
      // If npm's dependency tree cannot be parsed, let Vite report its own
      // startup error instead of blocking unrelated projects.
    }
  }
  const previewUrl = sandbox.domain(runtime.port);
  const previewHost = new URL(previewUrl).hostname;

  let commandArgs = runtime.args;
  const runtimeEnv: Record<string, string> = {
    ...projectEnv,
    HOST: '0.0.0.0',
    PORT: String(runtime.port),
    __VITE_ADDITIONAL_SERVER_ALLOWED_HOSTS: previewHost,
  };

  if (runtime.framework === 'Vite') {
    // Vite 6.1+ supports __VITE_ADDITIONAL_SERVER_ALLOWED_HOSTS. Older
    // Vite releases can still appear in user projects, so use a sandbox-only
    // wrapper config as a compatibility fallback. It loads the user's real
    // config and merges the exact sandbox hostname into both server and
    // preview allowedHosts without modifying their project files.
    const viteConfigCandidates = [
      'vite.config.ts',
      'vite.config.js',
      'vite.config.mjs',
      'vite.config.cjs',
    ];
    const existingConfig = viteConfigCandidates.find((path) =>
      files.some((file) => file.path === path),
    );
    const wrapperPath = `${PROJECT_ROOT}/.kingxtech-vite-runtime.mjs`;
    const userConfigPath = existingConfig
      ? `${PROJECT_ROOT}/${existingConfig}`
      : '';
    const wrapper = [
      "import { defineConfig, loadConfigFromFile } from 'vite';",
      `const userConfigPath = ${JSON.stringify(userConfigPath)};`,
      "export default defineConfig(async (env) => {",
      "  const loaded = userConfigPath ? await loadConfigFromFile(env, userConfigPath, process.cwd()) : null;",
      "  const base = loaded?.config || {};",
      "  return {",
      "    ...base,",
      `    server: { ...(base.server || {}), allowedHosts: true },`,
      `    preview: { ...(base.preview || {}), allowedHosts: true },`,
      "  };",
      "});",
      "",
    ].join("\n");
    await sandbox.writeFiles([{
      path: wrapperPath,
      content: Buffer.from(wrapper, 'utf8'),
    }]);
    // Launch Vite directly instead of going through npm's script argument
    // forwarding. This guarantees the sandbox config is the config Vite loads.
    commandArgs = ['--host', '0.0.0.0', '--port', String(runtime.port), '--config', wrapperPath];
  }

  if (runtime.framework === 'Vite') {
    runner = './node_modules/.bin/vite';
  }

  // Detached commands return immediately by design; the process continues
  // inside the persistent sandbox session.
  await sandbox.runCommand({
    cmd: runner,
    args: commandArgs,
    cwd: PROJECT_ROOT,
    env: runtimeEnv,
    detached: true,
  });

  return {
    sandboxName: sandbox.name,
    url: previewUrl,
    port: runtime.port,
    framework: runtime.framework,
    packageManager,
  };
}

export async function runProjectCommand(
  userId: string,
  projectId: string,
  command: string,
  args: string[] = [],
): Promise<{ ok: boolean; output: string }> {
  await assertProjectOwnership(userId, projectId);

  const allowed = new Set(['npm', 'pnpm', 'yarn', 'bun', 'node', 'npx', 'git', 'ls', 'pwd', 'cat', 'tsc', 'vite']);
  if (!allowed.has(command)) {
    return { ok: false, output: `Command "${command}" is not allowed in the project sandbox.` };
  }
  if (args.length > 24 || args.some((arg) => typeof arg !== 'string' || arg.length > 500)) {
    return { ok: false, output: 'Command arguments are too large.' };
  }

  const sandbox = await getSandbox(projectId);
  await syncFiles(userId, projectId, sandbox);
  const result = await sandbox.runCommand({
    cmd: command,
    args,
    cwd: PROJECT_ROOT,
    timeoutMs: 30_000,
  });

  const stdout = (await result.stdout()).trim();
  const stderr = (await result.stderr()).trim();
  return {
    ok: result.exitCode === 0,
    output: stdout || stderr || `exit code ${result.exitCode}`,
  };
}

export async function syncProjectRuntime(userId: string, projectId: string): Promise<{ sandboxName: string; fileCount: number }> {
  const sandbox = await getSandbox(projectId);
  const files = await syncFiles(userId, projectId, sandbox);
  return { sandboxName: sandbox.name, fileCount: files.length };
}
