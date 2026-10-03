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

  const runner = commandForPackageManager(packageManager);
  // Detached commands return immediately by design, so there is no
  // exitCode to inspect here. The browser URL is returned and the runtime
  // process continues inside the persistent sandbox session.
  await sandbox.runCommand({
    cmd: runner,
    args: runtime.args,
    cwd: PROJECT_ROOT,
    env: { HOST: '0.0.0.0', PORT: String(runtime.port) },
    detached: true,
  });

  return {
    sandboxName: sandbox.name,
    url: sandbox.domain(runtime.port),
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
