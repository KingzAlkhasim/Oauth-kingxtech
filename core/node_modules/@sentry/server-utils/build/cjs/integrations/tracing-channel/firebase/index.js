Object.defineProperty(exports, Symbol.toStringTag, { value: 'Module' });

const diagnosticsChannel = require('node:diagnostics_channel');
const core = require('@sentry/core');
const instrumentation = require('./instrumentation.js');

const INTEGRATION_NAME = "Firebase";
const _firebaseChannelIntegration = (() => {
  return {
    name: INTEGRATION_NAME,
    setupOnce() {
      if (!diagnosticsChannel.tracingChannel) {
        return;
      }
      core.waitForTracingChannelBinding(() => {
        instrumentation.instrumentFirebase();
      });
    }
  };
});
const firebaseChannelIntegration = core.defineIntegration(_firebaseChannelIntegration);

exports.firebaseChannelIntegration = firebaseChannelIntegration;
//# sourceMappingURL=index.js.map
