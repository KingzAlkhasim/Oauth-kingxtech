Object.defineProperty(exports, Symbol.toStringTag, { value: 'Module' });

const diagnosticsChannel = require('node:diagnostics_channel');
const core = require('@sentry/core');
const debugBuild = require('../../../debug-build.js');
const index = require('../../../graphql/index.js');
const channels = require('../../../orchestrion/channels.js');
const tracingChannel = require('../../../tracing-channel.js');
const spans = require('./spans.js');

const INTEGRATION_NAME = "Graphql";
function getOptionsWithDefaults(options) {
  return {
    ignoreResolveSpans: options.ignoreResolveSpans !== false,
    ignoreTrivialResolveSpans: options.ignoreTrivialResolveSpans !== false,
    useOperationNameForRootSpan: options.useOperationNameForRootSpan !== false
  };
}
function safe(fn) {
  try {
    return fn();
  } catch (error) {
    debugBuild.DEBUG_BUILD && core.debug.warn("[orchestrion:graphql] error building span", error);
    return void 0;
  }
}
const _graphqlChannelIntegration = ((options = {}) => {
  const config = getOptionsWithDefaults(options);
  const getConfig = () => config;
  return {
    name: INTEGRATION_NAME,
    setupOnce() {
      if (!diagnosticsChannel.tracingChannel) {
        return;
      }
      core.waitForTracingChannelBinding(() => {
        tracingChannel.bindTracingChannelToSpan(
          diagnosticsChannel.tracingChannel(channels.CHANNELS.GRAPHQL_PARSE),
          () => safe(() => spans.startParseSpan())
        );
        tracingChannel.bindTracingChannelToSpan(
          diagnosticsChannel.tracingChannel(channels.CHANNELS.GRAPHQL_VALIDATE),
          (data) => safe(() => spans.startValidateSpan(data.arguments[1])),
          { beforeSpanEnd: (span, data) => void safe(() => spans.finalizeValidateSpan(span, data.result)) }
        );
        tracingChannel.bindTracingChannelToSpan(
          diagnosticsChannel.tracingChannel(channels.CHANNELS.GRAPHQL_EXECUTE),
          (data) => safe(() => spans.startExecuteSpan(data.arguments, data.self, config, getConfig)),
          { beforeSpanEnd: (span, data) => void safe(() => spans.finalizeExecuteSpan(span, data.result)) }
        );
      });
    }
  };
});
const graphqlChannelIntegration = core.defineIntegration(_graphqlChannelIntegration);
const graphqlDiagnosticsChannelIntegration = (options) => {
  const orchestrion = graphqlChannelIntegration(options);
  return core.extendIntegration(index.graphqlIntegration(options), {
    name: INTEGRATION_NAME,
    setupOnce: () => orchestrion.setupOnce?.()
  });
};

exports.graphqlChannelIntegration = graphqlChannelIntegration;
exports.graphqlDiagnosticsChannelIntegration = graphqlDiagnosticsChannelIntegration;
//# sourceMappingURL=index.js.map
