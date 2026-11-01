import { APP_USER, APP_HOME, APP_DIR, APP_PATH, SERVER_PORT, APP_PORT, restrictedCommand } from './projectServerPolicy';
import { GATE_DIR, GATE_KEY_FILE, GATE_SCRIPT_FILE } from './projectGateRuntime';

/**
 * Pure builders for every command run inside a project's sandbox. They return argv arrays (never interpolated
 * shell strings holding user data), so the exact same steps can be unit-tested, replayed in a real sandbox
 * and executed by the SDK. Project code only ever runs through restrictedCommand(): clean env, user kxapp,
 * no-new-privs. Root is used only for fixed provisioning scripts and the gate.
 */
export const STAGE_DIR = '/tmp/.kx-stage';
export const GATE_LOG = '/tmp/kx-gate.log';
export const APP_LOG = '/tmp/kx-server.log';

/** Non-root: a private staging directory for the files about to be handed to root. */
export const stagePrepareArgs = () => ['sh', '-c', `rm -rf ${STAGE_DIR} && mkdir -m 700 ${STAGE_DIR} && mkdir ${STAGE_DIR}/app`];

/** Root: user, ownership, kills old processes, installs the gate + key root-only, moves project files to kxapp. */
export const PROVISION_SCRIPT = `set -eu
id ${APP_USER} >/dev/null 2>&1 || useradd -m -s /bin/bash ${APP_USER}
chmod 700 ${APP_HOME}
pkill -KILL -u ${APP_USER} || true
pkill -KILL -f '^node ${GATE_SCRIPT_FILE}' || true
install -d -m 700 -o root -g root ${GATE_DIR}
install -m 600 -o root -g root ${STAGE_DIR}/gate.cjs ${GATE_SCRIPT_FILE}
install -m 600 -o root -g root ${STAGE_DIR}/key ${GATE_KEY_FILE}
mkdir -p ${APP_DIR}
find ${APP_DIR} -mindepth 1 -maxdepth 1 ! -name node_modules ! -name .kx-hash -exec rm -rf {} +
cp -a ${STAGE_DIR}/app/. ${APP_DIR}/
chown -R ${APP_USER}:${APP_USER} ${APP_HOME}
rm -rf ${STAGE_DIR}
`;
export const provisionArgs = () => ['sh', '-c', PROVISION_SCRIPT];

export const freshCheckArgs = (userEnv: Record<string, string>, hash: string) =>
  restrictedCommand(userEnv, ['sh', '-c', '[ -d node_modules ] && [ "$(cat .kx-hash 2>/dev/null)" = "$1" ]', 'sh', hash]);
export const installArgs = (userEnv: Record<string, string>) => restrictedCommand(userEnv, ['npm', 'install', '--no-audit', '--no-fund']);
export const writeHashArgs = (userEnv: Record<string, string>, hash: string) => restrictedCommand(userEnv, ['sh', '-c', 'echo "$1" > .kx-hash', 'sh', hash]);

/** Root, detached. Started BEFORE project code so the gate owns the public port first. */
export const gateStartArgs = (projectId: string) =>
  ['sh', '-c', 'exec "$@" > "$0" 2>&1', GATE_LOG,
    'env', '-i', `PATH=${APP_PATH}`, 'node', GATE_SCRIPT_FILE, projectId, String(SERVER_PORT), String(APP_PORT)];

/** Root-launched but permanently unprivileged, detached. */
export const appStartArgs = (userEnv: Record<string, string>) =>
  ['sh', '-c', 'exec "$@" > "$0" 2>&1', APP_LOG, ...restrictedCommand(userEnv, ['npm', 'start'])];

export const tailLogArgs = () => ['sh', '-c', `tail -c 3000 ${APP_LOG} 2>/dev/null || true`];
export const stopProcessesArgs = () => ['sh', '-c', `pkill -KILL -u ${APP_USER} || true; pkill -KILL -f '^node ${GATE_SCRIPT_FILE}' || true`];
