Object.defineProperty(exports, Symbol.toStringTag, { value: 'Module' });

const core = require('@sentry/core');
const index = require('../../vercel-ai/index.js');
const diagnosticsChannel = require('node:diagnostics_channel');
const vercelAiOrchestrionSubscriber = require('../../vercel-ai/vercel-ai-orchestrion-subscriber.js');

const _vercelAiChannelIntegration = ((options = {}) => {
  const parentIntegration = index.vercelAiIntegration(options);
  return core.extendIntegration(parentIntegration, {
    options,
    setupOnce() {
      if (!diagnosticsChannel.tracingChannel) {
        return;
      }
      core.waitForTracingChannelBinding(() => {
        vercelAiOrchestrionSubscriber.subscribeVercelAiOrchestrionChannels(diagnosticsChannel.tracingChannel, options);
      });
    }
  });
});
const vercelAiChannelIntegration = core.defineIntegration(_vercelAiChannelIntegration);

exports.vercelAiChannelIntegration = vercelAiChannelIntegration;
//# sourceMappingURL=vercel-ai.js.map
