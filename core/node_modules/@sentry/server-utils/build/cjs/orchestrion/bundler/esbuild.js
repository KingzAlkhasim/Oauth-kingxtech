Object.defineProperty(exports, Symbol.toStringTag, { value: 'Module' });

const codeTransformer = require('@apm-js-collab/code-transformer-bundler-plugins/esbuild');
const core = require('@sentry/core');
const index = require('../config/index.js');
const options = require('./options.js');

const _interopDefault = e => e && e.__esModule ? e.default : e;

const codeTransformer__default = /*#__PURE__*/_interopDefault(codeTransformer);

function matchesEsbuildExternal(entry, moduleName) {
  if (entry.includes("*")) {
    return new RegExp(`^${entry.split("*").map(core.escapeStringForRegex).join(".*")}$`).test(moduleName);
  }
  return options.externalEntryMatchesModule(entry, moduleName);
}
function sentryOrchestrionPlugin(options$1 = {}) {
  const plugin = codeTransformer__default(options.orchestrionTransformOptions(options$1));
  const moduleNames = index.instrumentedModuleNames(options$1.instrumentations);
  const setup = plugin.setup;
  return {
    ...plugin,
    setup(build) {
      const external = build.initialOptions.external || [];
      const externalizedModules = moduleNames.filter(
        (name) => external.some((entry) => matchesEsbuildExternal(entry, name))
      );
      if (externalizedModules.length > 0) {
        build.onStart(() => ({ warnings: [{ text: options.externalizedModulesWarning(externalizedModules) }] }));
      }
      return setup(build);
    }
  };
}

exports.sentryOrchestrionPlugin = sentryOrchestrionPlugin;
//# sourceMappingURL=esbuild.js.map
