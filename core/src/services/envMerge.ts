// Pure helpers for combining account-wide and project environment variables.
// Kept free of database imports so they can be unit tested.

// Names that change how the shell, Node or the dynamic linker behave. Never let a stored
// variable override these inside the sandbox.
const BLOCKED_KEYS = new Set([
  'PATH', 'HOME', 'USER', 'SHELL', 'PWD', 'TMPDIR', 'LD_PRELOAD', 'LD_LIBRARY_PATH',
  'NODE_OPTIONS', 'NODE_PATH', 'NODE_ENV_FILE', 'NPM_CONFIG_PREFIX', 'NPM_CONFIG_USERCONFIG',
  'PYTHONPATH', 'PYTHONSTARTUP', 'BASH_ENV', 'ENV', 'IFS',
]);

export function isUsableEnvKey(key: string): boolean {
  return /^[A-Za-z_][A-Za-z0-9_]{0,127}$/.test(key) && !BLOCKED_KEYS.has(key.toUpperCase());
}

/** Account variables are the base; project variables win on the same key. Unsafe names are dropped. */
export function mergeRuntimeEnv(
  accountVars: Record<string, string>,
  projectVars: Record<string, string>,
): Record<string, string> {
  const merged: Record<string, string> = {};
  for (const source of [accountVars, projectVars]) {
    for (const [key, value] of Object.entries(source)) {
      if (isUsableEnvKey(key) && typeof value === 'string') merged[key] = value;
    }
  }
  return merged;
}
