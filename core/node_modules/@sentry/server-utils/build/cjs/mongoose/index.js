Object.defineProperty(exports, Symbol.toStringTag, { value: 'Module' });

const core = require('@sentry/core');
const diagnosticsChannel = require('node:diagnostics_channel');
const mongooseDcSubscriber = require('./mongoose-dc-subscriber.js');

const _mongooseIntegration = (() => {
  return {
    name: "Mongoose",
    setupOnce() {
      if (!diagnosticsChannel.tracingChannel) {
        return;
      }
      core.waitForTracingChannelBinding(() => {
        mongooseDcSubscriber.subscribeMongooseDiagnosticChannels(diagnosticsChannel.tracingChannel);
      });
    }
  };
});
const mongooseIntegration = core.defineIntegration(_mongooseIntegration);

exports.mongooseIntegration = mongooseIntegration;
//# sourceMappingURL=index.js.map
