import { createRequire } from 'node:module';
import { dirname } from 'node:path';
import { SENTRY_INSTRUMENTATIONS, instrumentedModuleNames } from '../config/index.js';
import codeTransformerWebpack from '@apm-js-collab/code-transformer-bundler-plugins/webpack';
export { serializeInstrumentations } from '@apm-js-collab/code-transformer-bundler-plugins/core';
import { orchestrionTransformOptions, externalizedModulesWarning, externalEntryMatchesModule } from './options.js';

function getOrchestrionRequire() {
  let nodeRequire;
  nodeRequire = createRequire(import.meta.url);
  return nodeRequire;
}
function getOrchestrionLoaderPath() {
  return getOrchestrionRequire().resolve("@apm-js-collab/code-transformer-bundler-plugins/webpack-loader");
}
function getTracingHooksDirectory() {
  const packageJsonPath = getOrchestrionRequire().resolve("@apm-js-collab/tracing-hooks/package.json");
  return dirname(packageJsonPath).replace(/\\/g, "/");
}
function getSentryInstrumentations() {
  return SENTRY_INSTRUMENTATIONS;
}
function externalizedWebpackModules(externals, moduleNames) {
  const entries = Array.isArray(externals) ? externals : [externals];
  return moduleNames.filter(
    (name) => entries.some((entry) => {
      if (typeof entry === "string") {
        return externalEntryMatchesModule(entry, name);
      }
      if (entry instanceof RegExp) {
        return entry.test(name);
      }
      if (entry && typeof entry === "object") {
        return name in entry;
      }
      return false;
    })
  );
}
function sentryOrchestrionWebpackPlugin(options = {}) {
  const plugin = codeTransformerWebpack(orchestrionTransformOptions(options));
  const moduleNames = instrumentedModuleNames(options.instrumentations);
  const apply = plugin.apply.bind(plugin);
  plugin.apply = (compiler) => {
    const externalizedModules = externalizedWebpackModules(compiler.options.externals, moduleNames);
    if (externalizedModules.length > 0) {
      compiler.hooks.thisCompilation.tap("SentryOrchestrionExternalsCheck", (compilation) => {
        compilation.warnings.push(new compiler.webpack.WebpackError(externalizedModulesWarning(externalizedModules)));
      });
    }
    apply(compiler);
  };
  return plugin;
}

export { getOrchestrionLoaderPath, getSentryInstrumentations, getTracingHooksDirectory, sentryOrchestrionWebpackPlugin };
//# sourceMappingURL=webpack.js.map
