Object.defineProperty(exports, Symbol.toStringTag, { value: 'Module' });

const core = require('@sentry/core');
const vercelAiDcSubscriber = require('./vercel-ai-dc-subscriber.js');
const diagnosticsChannel = require('node:diagnostics_channel');

const _vercelAiIntegration = ((options = {}) => {
  return {
    name: "VercelAI",
    setupOnce() {
      if (!diagnosticsChannel.tracingChannel) {
        return;
      }
      core.waitForTracingChannelBinding(() => {
        vercelAiDcSubscriber.subscribeVercelAiTracingChannel(diagnosticsChannel.tracingChannel, options);
      });
    }
  };
});
const vercelAiIntegration = core.defineIntegration(_vercelAiIntegration);

exports.vercelAiIntegration = vercelAiIntegration;
//# sourceMappingURL=index.js.map
