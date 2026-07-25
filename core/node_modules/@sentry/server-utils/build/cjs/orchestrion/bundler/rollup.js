Object.defineProperty(exports, Symbol.toStringTag, { value: 'Module' });

const codeTransformer = require('@apm-js-collab/code-transformer-bundler-plugins/rollup');
const index = require('../config/index.js');
const options = require('./options.js');

const _interopDefault = e => e && e.__esModule ? e.default : e;

const codeTransformer__default = /*#__PURE__*/_interopDefault(codeTransformer);

function sentryOrchestrionPlugin(options$1 = {}) {
  const moduleNames = index.instrumentedModuleNames(options$1.instrumentations);
  return {
    ...codeTransformer__default(options.orchestrionTransformOptions(options$1)),
    buildStart(rollupOptions) {
      const externalizedModules = moduleNames.filter((name) => rollupOptions.external(name, void 0, false));
      if (externalizedModules.length > 0) {
        this.warn(options.externalizedModulesWarning(externalizedModules));
      }
    }
  };
}

exports.sentryOrchestrionPlugin = sentryOrchestrionPlugin;
//# sourceMappingURL=rollup.js.map
