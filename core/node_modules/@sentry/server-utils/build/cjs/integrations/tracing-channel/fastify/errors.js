Object.defineProperty(exports, Symbol.toStringTag, { value: 'Module' });

const diagnosticsChannel = require('node:diagnostics_channel');
const debugBuild = require('../../../debug-build.js');
const core = require('@sentry/core');
const utils = require('./utils.js');

function getFastifyIntegration() {
  const client = core.getClient();
  return client?.getIntegrationByName(utils.INTEGRATION_NAME);
}
function subscribeToFastifyErrorChannel() {
  diagnosticsChannel.subscribe("tracing:fastify.request.handler:error", (message) => {
    const { error, request, reply } = message;
    handleFastifyError.call(handleFastifyError, error, request, reply, "diagnostics-channel");
  });
}
function handleFastifyError(error, request, reply, handlerOrigin) {
  const shouldHandleError = getFastifyIntegration()?.getShouldHandleError() || utils.defaultShouldHandleError;
  if (handlerOrigin === "diagnostics-channel") {
    this.diagnosticsChannelExists = true;
  }
  if (this.diagnosticsChannelExists && handlerOrigin === "onError-hook") {
    debugBuild.DEBUG_BUILD && core.debug.warn(
      "Fastify error handler was already registered via diagnostics channel.",
      "You can safely remove `setupFastifyErrorHandler` call and set `shouldHandleError` on the integration options."
    );
    return;
  }
  if (shouldHandleError(error, request, reply)) {
    core.captureException(error, {
      mechanism: {
        handled: false,
        type: "auto.function.fastify"
      }
    });
  }
}

exports.handleFastifyError = handleFastifyError;
exports.subscribeToFastifyErrorChannel = subscribeToFastifyErrorChannel;
//# sourceMappingURL=errors.js.map
