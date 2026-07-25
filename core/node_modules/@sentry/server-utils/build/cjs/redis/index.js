Object.defineProperty(exports, Symbol.toStringTag, { value: 'Module' });

const core = require('@sentry/core');
const diagnosticsChannel = require('node:diagnostics_channel');
const redisDcSubscriber = require('./redis-dc-subscriber.js');

const _redisIntegration = ((options = {}) => {
  return {
    name: "Redis",
    setupOnce() {
      if (!diagnosticsChannel.tracingChannel) {
        return;
      }
      core.waitForTracingChannelBinding(() => {
        redisDcSubscriber.subscribeRedisDiagnosticChannels(diagnosticsChannel.tracingChannel, options.responseHook);
      });
    }
  };
});
const redisIntegration = core.defineIntegration(_redisIntegration);

exports.redisIntegration = redisIntegration;
//# sourceMappingURL=index.js.map
