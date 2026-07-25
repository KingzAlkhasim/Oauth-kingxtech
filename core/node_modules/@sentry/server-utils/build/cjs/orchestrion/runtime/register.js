Object.defineProperty(exports, Symbol.toStringTag, { value: 'Module' });

const core = require('@sentry/core');
const Module = require('node:module');
const node_url = require('node:url');
const node_worker_threads = require('node:worker_threads');
const index = require('../config/index.js');

function hasStableSyncModuleHooks(denoVersionString) {
  const parseVersion = (v) => v.split(".").map((n) => parseInt(n, 10));
  const nodeVersion = parseVersion(process.versions.node ?? "0.0.0");
  const denoVersion = parseVersion(denoVersionString ?? "0.0.0");
  return (nodeVersion[0] ?? 0) > 25 || nodeVersion[0] === 25 && (nodeVersion[1] ?? 0) >= 1 || nodeVersion[0] === 24 && (nodeVersion[1] ?? 0) >= 13 || (denoVersion[0] ?? 0) > 2 || denoVersion[0] === 2 && (denoVersion[1] ?? 0) >= 8;
}
function registerDiagnosticsChannelInjection(options) {
  if (!node_worker_threads.isMainThread && !node_worker_threads.parentPort) {
    return;
  }
  if (core.GLOBAL_OBJ?.__SENTRY_ORCHESTRION__?.runtime) {
    return;
  }
  const globalAny = globalThis;
  const stableSyncHooks = hasStableSyncModuleHooks(globalAny.Deno?.version?.deno);
  let thisModuleUrl;
  thisModuleUrl = node_url.pathToFileURL(__filename).href;
  let nodeRequire;
  nodeRequire = require;
  const tracingHooksDir = options?.tracingHooksDir;
  const requireFromHooksDir = tracingHooksDir ? Module.createRequire(thisModuleUrl) : void 0;
  const mod = Module;
  try {
    const { setDiagnosticsHook } = requireFromHooksDir ? requireFromHooksDir(`${tracingHooksDir}/lib/diagnostics.js`) : nodeRequire("@apm-js-collab/tracing-hooks/lib/diagnostics.js");
    const onDiagnostics = ({ moduleName, error }) => {
      if (error) {
        core.debug.warn(`[orchestrion] failed to inject diagnostics-channel into ${moduleName}:`, error);
      } else {
        core.GLOBAL_OBJ.__SENTRY_ORCHESTRION__ = core.GLOBAL_OBJ.__SENTRY_ORCHESTRION__ || {};
        core.GLOBAL_OBJ.__SENTRY_ORCHESTRION__.runtime = core.GLOBAL_OBJ.__SENTRY_ORCHESTRION__.runtime || [];
        core.GLOBAL_OBJ.__SENTRY_ORCHESTRION__.runtime.push(moduleName);
      }
    };
    setDiagnosticsHook(onDiagnostics);
    if (typeof mod.registerHooks === "function" && stableSyncHooks) {
      const { initialize, resolve, load } = requireFromHooksDir ? requireFromHooksDir(`${tracingHooksDir}/hook-sync.mjs`) : nodeRequire("@apm-js-collab/tracing-hooks/hook-sync.mjs");
      initialize({ instrumentations: index.SENTRY_INSTRUMENTATIONS });
      mod.registerHooks({ resolve, load });
      core.debug.log("Registered diagnostics-channel injection via Module.registerHooks()");
    } else if (typeof mod.register === "function" && !globalAny.Bun && !globalAny.Deno) {
      const hookSpecifier = tracingHooksDir ? node_url.pathToFileURL(`${tracingHooksDir}/hook.mjs`).href : "@apm-js-collab/tracing-hooks/hook.mjs";
      const { port1, port2 } = new node_worker_threads.MessageChannel();
      port1.on("message", onDiagnostics);
      port1.unref();
      mod.register(hookSpecifier, {
        parentURL: thisModuleUrl,
        data: { instrumentations: index.SENTRY_INSTRUMENTATIONS, diagnosticsPort: port2 },
        transferList: [port2]
      });
      const ModulePatch = requireFromHooksDir && tracingHooksDir ? requireFromHooksDir(tracingHooksDir) : nodeRequire("@apm-js-collab/tracing-hooks");
      new ModulePatch({ instrumentations: index.SENTRY_INSTRUMENTATIONS }).patch();
      core.debug.log("Registered diagnostics-channel injection via Module.register()");
    } else {
      core.debug.warn("No available Node API to register diagnostics-channel injection hooks; skipping.");
      return;
    }
  } catch (error) {
    core.debug.warn(
      "Failed to register diagnostics-channel injection hooks; channel-based integrations will not record spans.",
      error
    );
    return;
  }
  core.GLOBAL_OBJ.__SENTRY_ORCHESTRION__ = core.GLOBAL_OBJ.__SENTRY_ORCHESTRION__ || {};
  core.GLOBAL_OBJ.__SENTRY_ORCHESTRION__.runtime = core.GLOBAL_OBJ.__SENTRY_ORCHESTRION__.runtime || [];
}

exports.registerDiagnosticsChannelInjection = registerDiagnosticsChannelInjection;
//# sourceMappingURL=register.js.map
