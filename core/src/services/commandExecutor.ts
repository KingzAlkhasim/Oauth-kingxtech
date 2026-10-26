import { execFile } from 'child_process';
import util from 'util';
import path from 'path';
import fs from 'fs';

const execFilePromise = util.promisify(execFile);

/**
 * PROJECT_ROOT confines the terminal tool to a single directory tree so the model
 * (or a user prompting it) can never read .env files, SSH keys, /proc/self/environ,
 * or anything else outside the project it is meant to be helping with.
 *
 * Set this via env var in production; defaults to cwd for local dev.
 */
function resolveRoot(): string {
  const configured = path.resolve(process.env.AGENT_PROJECT_ROOT || process.cwd());
  try {
    return fs.realpathSync(configured);
  } catch {
    return configured;
  }
}
const PROJECT_ROOT = resolveRoot();

export interface CommandResult {
  ok: boolean;
  output: string;
}

export type ValidationResult = { ok: true } | { ok: false; reason: string };

const MAX_ARGS = 12;
const MAX_ARG_LENGTH = 200;
const SAFE_TOKEN = /^[a-zA-Z0-9_\-.\/]+$/;
const SENSITIVE_SEGMENT = /^(\.env.*|\.npmrc|\.netrc|\.git|\.ssh|id_rsa.*|id_ed25519.*|.*\.(pem|key|p12|pfx))$/i;

/**
 * Flags are matched against an exact allowlist, never a denylist: git accepts
 * unambiguous abbreviations of long options (`--no-ind` == `--no-index`), so a
 * denylist can always be walked around.
 */
const GIT_FLAGS: Record<string, ReadonlySet<string>> = {
  status: new Set(['-s', '--short', '-b', '--branch', '--porcelain']),
  log: new Set([
    '--oneline', '--stat', '--name-only', '--name-status', '--graph', '--decorate',
    '--all', '-p', '--patch', '--no-merges', '--merges', '--first-parent', '--no-color',
  ]),
  diff: new Set([
    '--stat', '--name-only', '--name-status', '--cached', '--staged', '-p', '--patch',
    '--shortstat', '--numstat', '--summary', '--no-color',
  ]),
  branch: new Set(['--list', '-a', '--all', '-r', '--remotes', '-v', '-vv', '--show-current']),
};
const NUMERIC_FLAG = /^-\d{1,3}$/; // e.g. `git log -5`
const NPM_SCRIPTS = new Set(['lint', 'test', 'typecheck']);
const LS_FLAGS = new Set(['-l', '-a', '-la', '-al', '-1', '-h', '-lh', '-lah', '-alh']);

/**
 * True when `token` names a location inside `root`. Rejects absolute paths, any
 * `..` segment, sensitive file names, and symlinks that point outside the root.
 */
export function isPathInsideRoot(root: string, token: string): boolean {
  if (!token || path.isAbsolute(token)) return false;
  const segments = token.split('/').filter(Boolean);
  if (segments.some((s) => s === '..' || SENSITIVE_SEGMENT.test(s))) return false;

  const resolved = path.resolve(root, token);
  if (resolved !== root && !resolved.startsWith(root + path.sep)) return false;

  try {
    const real = fs.realpathSync(resolved);
    if (real !== root && !real.startsWith(root + path.sep)) return false;
  } catch {
    // Path does not exist yet; the lexical check above is enough.
  }
  return true;
}

const fail = (reason: string): ValidationResult => ({ ok: false, reason });
const pass: ValidationResult = { ok: true };

export function validateCommand(command: string, args: string[], root: string = PROJECT_ROOT): ValidationResult {
  if (typeof command !== 'string' || !Array.isArray(args)) return fail('Malformed command.');
  if (args.length > MAX_ARGS) return fail('Too many arguments.');
  for (const a of args) {
    if (typeof a !== 'string' || a.length === 0 || a.length > MAX_ARG_LENGTH) return fail('Invalid argument.');
    if (!SAFE_TOKEN.test(a)) return fail('Arguments may only contain letters, numbers, "_", "-", "." and "/".');
  }

  const isFlag = (a: string) => a.startsWith('-');
  const positionalsOk = (list: string[]) => list.every((p) => isPathInsideRoot(root, p));

  switch (command) {
    case 'git': {
      const [sub, ...rest] = args;
      if (sub === '--version') return rest.length === 0 ? pass : fail('git --version takes no arguments.');
      const allowedFlags = GIT_FLAGS[sub];
      if (!allowedFlags) return fail('Only git status, log, diff and branch are allowed.');

      if (sub === 'branch') {
        // Listing only. Any positional argument would create, rename or delete a branch.
        return rest.every((a) => allowedFlags.has(a)) ? pass : fail('git branch may only list branches.');
      }

      let afterDashes = false;
      for (const a of rest) {
        if (afterDashes) {
          if (!isPathInsideRoot(root, a)) return fail('Paths must stay inside the project.');
          continue;
        }
        if (a === '--') { afterDashes = true; continue; }
        if (isFlag(a)) {
          if (!allowedFlags.has(a) && !(sub === 'log' && NUMERIC_FLAG.test(a))) return fail(`Flag "${a}" is not allowed.`);
          continue;
        }
        if (!isPathInsideRoot(root, a)) return fail('Paths must stay inside the project.');
      }
      return pass;
    }

    case 'npm': {
      const [sub, ...rest] = args;
      if (sub === '--version') return rest.length === 0 ? pass : fail('npm --version takes no arguments.');
      if (sub === 'test') return rest.length === 0 ? pass : fail('npm test takes no arguments.');
      if (sub === 'run') {
        return rest.length === 1 && NPM_SCRIPTS.has(rest[0]) ? pass : fail('Only "npm run lint|test|typecheck" is allowed.');
      }
      if (sub === 'ls') {
        const ok = rest.every((a, i) => ['--depth', '--all', '--json', '-a'].includes(a) || (/^\d$/.test(a) && rest[i - 1] === '--depth'));
        return ok ? pass : fail('npm ls only accepts --depth <n>, --all and --json.');
      }
      return fail('Only npm test, run, ls and --version are allowed.');
    }

    case 'node':
      return args.length === 1 && args[0] === '--version' ? pass : fail('Only node --version is allowed.');

    case 'tsc':
      return args.length <= 2 && args.every((a) => a === '--noEmit' || a === '--version') ? pass : fail('Only tsc --noEmit and --version are allowed.');

    case 'ls': {
      const flags = args.filter(isFlag);
      const positionals = args.filter((a) => !isFlag(a));
      if (!flags.every((f) => LS_FLAGS.has(f))) return fail('Flag is not allowed for ls.');
      return positionalsOk(positionals) ? pass : fail('Paths must stay inside the project.');
    }

    case 'pwd':
      return args.length === 0 ? pass : fail('pwd takes no arguments.');

    default:
      return fail(`Command "${command}" is not on the allowlist.`);
  }
}

/**
 * The child process gets a minimal environment so that nothing the server holds
 * (service-role key, API keys, tokens) can ever be printed by a command.
 */
export function buildChildEnv(): NodeJS.ProcessEnv {
  return {
    PATH: process.env.PATH ?? '/usr/local/bin:/usr/bin:/bin',
    HOME: '/tmp',
    LANG: 'C',
    NO_COLOR: '1',
    GIT_CONFIG_NOSYSTEM: '1',
    GIT_CONFIG_GLOBAL: '/dev/null',
    GIT_PAGER: 'cat',
    GIT_TERMINAL_PROMPT: '0',
    GIT_OPTIONAL_LOCKS: '0',
  };
}

/**
 * Executes an allowlisted command with a fixed argument array.
 * Takes `command` + `args[]` separately (never a single raw shell string) so
 * there is no shell to inject into — execFile does not spawn a shell.
 */
export const executeTerminalCommand = async (
  command: string,
  args: string[] = []
): Promise<CommandResult> => {
  const verdict = validateCommand(command, args);
  if (!verdict.ok) {
    return { ok: false, output: `Rejected by the allowlist policy: ${verdict.reason}` };
  }

  try {
    const { stdout, stderr } = await execFilePromise(command, args, {
      cwd: PROJECT_ROOT,
      env: buildChildEnv(),
      timeout: 10_000, // 10s hard cap — agentic loops should not hang the server
      maxBuffer: 1024 * 1024, // 1MB output cap
    });
    return { ok: true, output: stdout || stderr || 'Command executed successfully.' };
  } catch (error: any) {
    return { ok: false, output: `Error: ${error.message}` };
  }
};
