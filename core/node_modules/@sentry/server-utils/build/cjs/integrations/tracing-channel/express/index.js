Object.defineProperty(exports, Symbol.toStringTag, { value: 'Module' });

const diagnosticsChannel = require('node:diagnostics_channel');
const core = require('@sentry/core');
const instrumentation = require('./instrumentation.js');

const INTEGRATION_NAME = "Express";
const _expressChannelIntegration = ((options = {}) => {
  return {
    name: INTEGRATION_NAME,
    setupOnce() {
      if (!diagnosticsChannel.tracingChannel) {
        return;
      }
      core.waitForTracingChannelBinding(() => {
        instrumentation.instrumentExpress(options, diagnosticsChannel.tracingChannel);
      });
    }
  };
});
const expressChannelIntegration = core.defineIntegration(_expressChannelIntegration);

exports.expressChannelIntegration = expressChannelIntegration;
//# sourceMappingURL=index.js.map
