import { execFile } from 'child_process';
import util from 'util';
import path from 'path';

const execFilePromise = util.promisify(execFile);

/**
 * PROJECT_ROOT confines file reads to a single directory tree so the model
 * can never be prompted into reading .env files, SSH keys, or anything
 * outside the project it's meant to be helping with.
 *
 * Set this via env var in production; defaults to cwd for local dev.
 */
const PROJECT_ROOT = path.resolve(process.env.AGENT_PROJECT_ROOT || process.cwd());

/**
 * ALLOWLIST: every entry is a command name mapped to the argument patterns
 * we're willing to run. This is intentionally small and explicit — add to
 * it deliberately, don't loosen it to unblock a one-off request.
 *
 * Each validator receives the full argument array (everything after the
 * command name) and returns true only if it's a shape we trust.
 */
type Validator = (args: string[]) => boolean;

const isSafeToken = (token: string) => /^[a-zA-Z0-9_\-.\/]+$/.test(token);

const ALLOWLIST: Record<string, Validator> = {
  // git: read-only / informational subcommands only
  git: (args) =>
    ['status', 'log', 'diff', 'branch', '--version'].includes(args[0]) &&
    args.slice(1).every(isSafeToken),

  // npm: safe, non-mutating subcommands only
  npm: (args) =>
    ['test', 'run', 'ls', '--version', 'lint'].includes(args[0]) &&
    args.slice(1).every(isSafeToken),

  // node/tsc version checks — harmless introspection
  node: (args) => args.length === 1 && args[0] === '--version',
  tsc: (args) => args.every((a) => a === '--noEmit' || a === '--version'),

  // basic read-only filesystem introspection
  ls: (args) => args.every(isSafeToken),
  pwd: (args) => args.length === 0,
};

export interface CommandResult {
  ok: boolean;
  output: string;
}

/**
 * Executes an allowlisted command with a fixed argument array.
 * Deliberately takes `command` + `args[]` separately (never a single raw
 * shell string) so there is no shell to inject into — execFile does not
 * spawn a shell, so `;`, `&&`, backticks, `$()`, etc. are inert here.
 */
export const executeTerminalCommand = async (
  command: string,
  args: string[] = []
): Promise<CommandResult> => {
  const validator = ALLOWLIST[command];

  if (!validator) {
    return { ok: false, output: `Command "${command}" is not on the allowlist.` };
  }

  if (!validator(args)) {
    return {
      ok: false,
      output: `Arguments for "${command}" were rejected by the allowlist policy.`,
    };
  }

  try {
    const { stdout, stderr } = await execFilePromise(command, args, {
      cwd: PROJECT_ROOT,
      timeout: 10_000, // 10s hard cap — agentic loops should not hang the server
      maxBuffer: 1024 * 1024, // 1MB output cap
    });
    return { ok: true, output: stdout || stderr || 'Command executed successfully.' };
  } catch (error: any) {
    return { ok: false, output: `Error: ${error.message}` };
  }
};
