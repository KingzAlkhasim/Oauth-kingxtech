import type { Sandbox } from '@vercel/sandbox';
import { listProjectFilesWithContent, assertProjectOwnership } from './projectFs';

const PROJECT_ROOT = '/vercel/sandbox/project';
const SANDBOX_TIMEOUT_MS = 45 * 60 * 1000;

// Keep several common web ports exposed so Vite, Next.js, Express and
// generic Node apps can all get a browser preview without changing the
// sandbox security boundary.
const EXPOSED_PORTS = [3000, 3001, 4173, 5173, 8080];

type SandboxModule = typeof import('@vercel/sandbox');
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
  const runtime = detectRuntime(packageJson);
  const { cmd: installCmd, args: installArgs } = installCommand(packageManager);

  const install = await sandbox.runCommand({
    cmd: installCmd,
    args: installArgs,
    cwd: PROJECT_ROOT,
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
