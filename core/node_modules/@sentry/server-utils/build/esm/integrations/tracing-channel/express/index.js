import * as diagnosticsChannel from 'node:diagnostics_channel';
import { defineIntegration, waitForTracingChannelBinding } from '@sentry/core';
import { instrumentExpress } from './instrumentation.js';

const INTEGRATION_NAME = "Express";
const _expressChannelIntegration = ((options = {}) => {
  return {
    name: INTEGRATION_NAME,
    setupOnce() {
      if (!diagnosticsChannel.tracingChannel) {
        return;
      }
      waitForTracingChannelBinding(() => {
        instrumentExpress(options, diagnosticsChannel.tracingChannel);
      });
    }
  };
});
const expressChannelIntegration = defineIntegration(_expressChannelIntegration);

export { expressChannelIntegration };
//# sourceMappingURL=index.js.map
