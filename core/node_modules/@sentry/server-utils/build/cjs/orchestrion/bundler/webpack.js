Object.defineProperty(exports, Symbol.toStringTag, { value: 'Module' });

const Module = require('node:module');
const node_path = require('node:path');
const index = require('../config/index.js');
const codeTransformerWebpack = require('@apm-js-collab/code-transformer-bundler-plugins/webpack');
const core = require('@apm-js-collab/code-transformer-bundler-plugins/core');
const options = require('./options.js');

const _interopDefault = e => e && e.__esModule ? e.default : e;

const codeTransformerWebpack__default = /*#__PURE__*/_interopDefault(codeTransformerWebpack);

function getOrchestrionRequire() {
  let nodeRequire;
  nodeRequire = Module.createRequire(__filename);
  return nodeRequire;
}
function getOrchestrionLoaderPath() {
  return getOrchestrionRequire().resolve("@apm-js-collab/code-transformer-bundler-plugins/webpack-loader");
}
function getTracingHooksDirectory() {
  const packageJsonPath = getOrchestrionRequire().resolve("@apm-js-collab/tracing-hooks/package.json");
  return node_path.dirname(packageJsonPath).replace(/\\/g, "/");
}
function getSentryInstrumentations() {
  return index.SENTRY_INSTRUMENTATIONS;
}
function externalizedWebpackModules(externals, moduleNames) {
  const entries = Array.isArray(externals) ? externals : [externals];
  return moduleNames.filter(
    (name) => entries.some((entry) => {
      if (typeof entry === "string") {
        return options.externalEntryMatchesModule(entry, name);
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
function sentryOrchestrionWebpackPlugin(options$1 = {}) {
  const plugin = codeTransformerWebpack__default(options.orchestrionTransformOptions(options$1));
  const moduleNames = index.instrumentedModuleNames(options$1.instrumentations);
  const apply = plugin.apply.bind(plugin);
  plugin.apply = (compiler) => {
    const externalizedModules = externalizedWebpackModules(compiler.options.externals, moduleNames);
    if (externalizedModules.length > 0) {
      compiler.hooks.thisCompilation.tap("SentryOrchestrionExternalsCheck", (compilation) => {
        compilation.warnings.push(new compiler.webpack.WebpackError(options.externalizedModulesWarning(externalizedModules)));
      });
    }
    apply(compiler);
  };
  return plugin;
}

exports.serializeInstrumentations = core.serializeInstrumentations;
exports.getOrchestrionLoaderPath = getOrchestrionLoaderPath;
exports.getSentryInstrumentations = getSentryInstrumentations;
exports.getTracingHooksDirectory = getTracingHooksDirectory;
exports.sentryOrchestrionWebpackPlugin = sentryOrchestrionWebpackPlugin;
//# sourceMappingURL=webpack.js.map
