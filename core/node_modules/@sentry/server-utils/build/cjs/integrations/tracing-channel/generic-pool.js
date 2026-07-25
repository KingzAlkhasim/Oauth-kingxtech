Object.defineProperty(exports, Symbol.toStringTag, { value: 'Module' });

const diagnosticsChannel = require('node:diagnostics_channel');
const core = require('@sentry/core');
const channels = require('../../orchestrion/channels.js');
const tracingChannel = require('../../tracing-channel.js');

const INTEGRATION_NAME = "GenericPool";
const _genericPoolChannelIntegration = (() => {
  return {
    name: INTEGRATION_NAME,
    setupOnce() {
      if (!diagnosticsChannel.tracingChannel) {
        return;
      }
      core.waitForTracingChannelBinding(() => instrumentGenericPool());
    }
  };
});
const genericPoolChannelIntegration = core.defineIntegration(_genericPoolChannelIntegration);
function instrumentGenericPool() {
  tracingChannel.bindTracingChannelToSpan(
    diagnosticsChannel.tracingChannel(channels.CHANNELS.GENERIC_POOL_ACQUIRE),
    () => core.startInactiveSpan({
      name: "generic-pool.acquire",
      attributes: {
        [core.SEMANTIC_ATTRIBUTE_SENTRY_ORIGIN]: "auto.db.orchestrion.generic_pool"
      }
    })
  );
}

exports.genericPoolChannelIntegration = genericPoolChannelIntegration;
//# sourceMappingURL=generic-pool.js.map
