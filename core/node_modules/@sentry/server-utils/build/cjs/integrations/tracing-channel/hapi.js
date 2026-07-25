Object.defineProperty(exports, Symbol.toStringTag, { value: 'Module' });

const diagnosticsChannel = require('node:diagnostics_channel');
const core = require('@sentry/core');
const debugBuild = require('../../debug-build.js');
const channels = require('../../orchestrion/channels.js');
const hapiUtils = require('./hapi-utils.js');

const INTEGRATION_NAME = "Hapi";
const _hapiChannelIntegration = (() => {
  return {
    name: INTEGRATION_NAME,
    setupOnce() {
      if (!diagnosticsChannel.tracingChannel) {
        return;
      }
      debugBuild.DEBUG_BUILD && core.debug.log(`[orchestrion:hapi] subscribing to channels "${channels.CHANNELS.HAPI_ROUTE}" / "${channels.CHANNELS.HAPI_EXT}"`);
      diagnosticsChannel.tracingChannel(channels.CHANNELS.HAPI_ROUTE).subscribe({
        start(rawCtx) {
          const ctx = rawCtx;
          hapiUtils.wrapRouteArguments(ctx.arguments, ctx.self?.realm?.plugin);
        },
        end() {
        },
        asyncStart() {
        },
        asyncEnd() {
        },
        error() {
        }
      });
      diagnosticsChannel.tracingChannel(channels.CHANNELS.HAPI_EXT).subscribe({
        start(rawCtx) {
          const ctx = rawCtx;
          hapiUtils.wrapExtArguments(ctx.arguments, ctx.self?.realm?.plugin);
        },
        end() {
        },
        asyncStart() {
        },
        asyncEnd() {
        },
        error() {
        }
      });
    }
  };
});
const hapiChannelIntegration = core.defineIntegration(_hapiChannelIntegration);

exports.hapiChannelIntegration = hapiChannelIntegration;
//# sourceMappingURL=hapi.js.map
