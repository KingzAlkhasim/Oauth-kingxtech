Object.defineProperty(exports, Symbol.toStringTag, { value: 'Module' });

const core = require('@sentry/core');
const diagnosticsChannel = require('node:diagnostics_channel');
const mysql2DcSubscriber = require('./mysql2-dc-subscriber.js');

const _mysql2Integration = (() => {
  return {
    name: "Mysql2",
    setupOnce() {
      if (!diagnosticsChannel.tracingChannel) {
        return;
      }
      core.waitForTracingChannelBinding(() => {
        mysql2DcSubscriber.subscribeMysql2DiagnosticChannels(diagnosticsChannel.tracingChannel);
      });
    }
  };
});
const mysql2Integration = core.defineIntegration(_mysql2Integration);

exports.mysql2Integration = mysql2Integration;
//# sourceMappingURL=index.js.map
