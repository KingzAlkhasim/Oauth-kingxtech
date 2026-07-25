import { GLOBAL_OBJ, debug } from '@sentry/core';
import * as Module from 'node:module';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';
import { isMainThread, parentPort, MessageChannel } from 'node:worker_threads';
import { SENTRY_INSTRUMENTATIONS } from '../config/index.js';

function hasStableSyncModuleHooks(denoVersionString) {
  const parseVersion = (v) => v.split(".").map((n) => parseInt(n, 10));
  const nodeVersion = parseVersion(process.versions.node ?? "0.0.0");
  const denoVersion = parseVersion(denoVersionString ?? "0.0.0");
  return (nodeVersion[0] ?? 0) > 25 || nodeVersion[0] === 25 && (nodeVersion[1] ?? 0) >= 1 || nodeVersion[0] === 24 && (nodeVersion[1] ?? 0) >= 13 || (denoVersion[0] ?? 0) > 2 || denoVersion[0] === 2 && (denoVersion[1] ?? 0) >= 8;
}
function registerDiagnosticsChannelInjection(options) {
  if (!isMainThread && !parentPort) {
    return;
  }
  if (GLOBAL_OBJ?.__SENTRY_ORCHESTRION__?.runtime) {
    return;
  }
  const globalAny = globalThis;
  const stableSyncHooks = hasStableSyncModuleHooks(globalAny.Deno?.version?.deno);
  let thisModuleUrl;
  thisModuleUrl = import.meta.url;
  let nodeRequire;
  nodeRequire = createRequire(import.meta.url);
  const tracingHooksDir = options?.tracingHooksDir;
  const requireFromHooksDir = tracingHooksDir ? createRequire(thisModuleUrl) : void 0;
  const mod = Module;
  try {
    const { setDiagnosticsHook } = requireFromHooksDir ? requireFromHooksDir(`${tracingHooksDir}/lib/diagnostics.js`) : nodeRequire("@apm-js-collab/tracing-hooks/lib/diagnostics.js");
    const onDiagnostics = ({ moduleName, error }) => {
      if (error) {
        debug.warn(`[orchestrion] failed to inject diagnostics-channel into ${moduleName}:`, error);
      } else {
        GLOBAL_OBJ.__SENTRY_ORCHESTRION__ = GLOBAL_OBJ.__SENTRY_ORCHESTRION__ || {};
        GLOBAL_OBJ.__SENTRY_ORCHESTRION__.runtime = GLOBAL_OBJ.__SENTRY_ORCHESTRION__.runtime || [];
        GLOBAL_OBJ.__SENTRY_ORCHESTRION__.runtime.push(moduleName);
      }
    };
    setDiagnosticsHook(onDiagnostics);
    if (typeof mod.registerHooks === "function" && stableSyncHooks) {
      const { initialize, resolve, load } = requireFromHooksDir ? requireFromHooksDir(`${tracingHooksDir}/hook-sync.mjs`) : nodeRequire("@apm-js-collab/tracing-hooks/hook-sync.mjs");
      initialize({ instrumentations: SENTRY_INSTRUMENTATIONS });
      mod.registerHooks({ resolve, load });
      debug.log("Registered diagnostics-channel injection via Module.registerHooks()");
    } else if (typeof mod.register === "function" && !globalAny.Bun && !globalAny.Deno) {
      const hookSpecifier = tracingHooksDir ? pathToFileURL(`${tracingHooksDir}/hook.mjs`).href : "@apm-js-collab/tracing-hooks/hook.mjs";
      const { port1, port2 } = new MessageChannel();
      port1.on("message", onDiagnostics);
      port1.unref();
      mod.register(hookSpecifier, {
        parentURL: thisModuleUrl,
        data: { instrumentations: SENTRY_INSTRUMENTATIONS, diagnosticsPort: port2 },
        transferList: [port2]
      });
      const ModulePatch = requireFromHooksDir && tracingHooksDir ? requireFromHooksDir(tracingHooksDir) : nodeRequire("@apm-js-collab/tracing-hooks");
      new ModulePatch({ instrumentations: SENTRY_INSTRUMENTATIONS }).patch();
      debug.log("Registered diagnostics-channel injection via Module.register()");
    } else {
      debug.warn("No available Node API to register diagnostics-channel injection hooks; skipping.");
      return;
    }
  } catch (error) {
    debug.warn(
      "Failed to register diagnostics-channel injection hooks; channel-based integrations will not record spans.",
      error
    );
    return;
  }
  GLOBAL_OBJ.__SENTRY_ORCHESTRION__ = GLOBAL_OBJ.__SENTRY_ORCHESTRION__ || {};
  GLOBAL_OBJ.__SENTRY_ORCHESTRION__.runtime = GLOBAL_OBJ.__SENTRY_ORCHESTRION__.runtime || [];
}

export { registerDiagnosticsChannelInjection };
//# sourceMappingURL=register.js.map
