import codeTransformer from '@apm-js-collab/code-transformer-bundler-plugins/rollup';
import { instrumentedModuleNames } from '../config/index.js';
import { externalizedModulesWarning, orchestrionTransformOptions } from './options.js';

function sentryOrchestrionPlugin(options = {}) {
  const moduleNames = instrumentedModuleNames(options.instrumentations);
  return {
    ...codeTransformer(orchestrionTransformOptions(options)),
    buildStart(rollupOptions) {
      const externalizedModules = moduleNames.filter((name) => rollupOptions.external(name, void 0, false));
      if (externalizedModules.length > 0) {
        this.warn(externalizedModulesWarning(externalizedModules));
      }
    }
  };
}

export { sentryOrchestrionPlugin };
//# sourceMappingURL=rollup.js.map
