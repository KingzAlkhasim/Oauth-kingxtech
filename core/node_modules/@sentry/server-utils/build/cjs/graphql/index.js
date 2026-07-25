Object.defineProperty(exports, Symbol.toStringTag, { value: 'Module' });

const core = require('@sentry/core');
const diagnosticsChannel = require('node:diagnostics_channel');
const graphqlDcSubscriber = require('./graphql-dc-subscriber.js');

const _graphqlIntegration = ((options = {}) => {
  return {
    name: "Graphql",
    setupOnce() {
      if (!diagnosticsChannel.tracingChannel) {
        return;
      }
      core.waitForTracingChannelBinding(() => {
        graphqlDcSubscriber.subscribeGraphqlDiagnosticChannels(diagnosticsChannel.tracingChannel, options);
      });
    }
  };
});
const graphqlIntegration = core.defineIntegration(_graphqlIntegration);

exports.graphqlIntegration = graphqlIntegration;
//# sourceMappingURL=index.js.map
