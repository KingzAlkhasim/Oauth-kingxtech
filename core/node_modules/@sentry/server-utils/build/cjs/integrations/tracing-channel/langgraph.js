Object.defineProperty(exports, Symbol.toStringTag, { value: 'Module' });

const diagnosticsChannel = require('node:diagnostics_channel');
const core = require('@sentry/core');
const debugBuild = require('../../debug-build.js');
const channels = require('../../orchestrion/channels.js');
const tracingChannel = require('../../tracing-channel.js');

const INTEGRATION_NAME = core.LANGGRAPH_INTEGRATION_NAME;
let subscribed = false;
let insideCreateReactAgent = false;
const _langGraphChannelIntegration = ((options = {}) => {
  return {
    name: INTEGRATION_NAME,
    setupOnce() {
      if (!diagnosticsChannel.tracingChannel || subscribed) {
        return;
      }
      subscribed = true;
      const resolvedOptions = core.resolveAIRecordingOptions(options);
      const sentryHandler = core.createLangChainCallbackHandler(resolvedOptions);
      core.waitForTracingChannelBinding(() => {
        debugBuild.DEBUG_BUILD && core.debug.log(`[orchestrion:langgraph] subscribing to channel "${channels.CHANNELS.LANGGRAPH_STATE_GRAPH_COMPILE}"`);
        tracingChannel.bindTracingChannelToSpan(
          diagnosticsChannel.tracingChannel(channels.CHANNELS.LANGGRAPH_STATE_GRAPH_COMPILE),
          (data) => {
            if (insideCreateReactAgent) {
              return void 0;
            }
            const compileOptions = getFirstArgObject(data.arguments);
            const name = typeof compileOptions?.name === "string" ? compileOptions.name : void 0;
            return core.startInactiveSpan(core._INTERNAL_getLangGraphCreateAgentSpanOptions(name));
          },
          {
            beforeSpanEnd: (_span, data) => {
              wrapCompiledGraphInvoke(
                data.result,
                getFirstArgObject(data.arguments) ?? {},
                resolvedOptions,
                null,
                sentryHandler
              );
            }
          }
        );
        debugBuild.DEBUG_BUILD && core.debug.log(`[orchestrion:langgraph] subscribing to channel "${channels.CHANNELS.LANGGRAPH_CREATE_REACT_AGENT}"`);
        const reactAgentChannel = diagnosticsChannel.tracingChannel(
          channels.CHANNELS.LANGGRAPH_CREATE_REACT_AGENT
        );
        reactAgentChannel.start.subscribe((message) => {
          insideCreateReactAgent = true;
          try {
            const { arguments: args } = message;
            const params = getFirstArgObject(args);
            if (params && Array.isArray(params.tools) && params.tools.length > 0) {
              core.wrapToolsWithSpans(params.tools, resolvedOptions, core.extractAgentNameFromParams(args) ?? void 0);
            }
          } catch (error) {
            debugBuild.DEBUG_BUILD && core.debug.error("[orchestrion:langgraph] failed to wrap createReactAgent tools", error);
          }
        });
        reactAgentChannel.end.subscribe((message) => {
          insideCreateReactAgent = false;
          const { arguments: args, result } = message;
          const agentName = core.extractAgentNameFromParams(args) ?? void 0;
          const compileOptions = agentName ? { name: agentName } : {};
          wrapCompiledGraphInvoke(result, compileOptions, resolvedOptions, core.extractLLMFromParams(args), sentryHandler);
        });
        reactAgentChannel.error.subscribe(() => {
          insideCreateReactAgent = false;
        });
      });
    }
  };
});
function getFirstArgObject(args) {
  const first = (args ?? [])[0];
  return typeof first === "object" && first !== null ? first : void 0;
}
function wrapCompiledGraphInvoke(graph, compileOptions, options, llm, sentryHandler) {
  if (!graph || typeof graph !== "object") {
    return;
  }
  const compiledGraph = graph;
  const originalInvoke = compiledGraph.invoke;
  if (typeof originalInvoke === "function") {
    compiledGraph.invoke = core.instrumentCompiledGraphInvoke(
      originalInvoke.bind(compiledGraph),
      compiledGraph,
      compileOptions,
      options,
      llm,
      sentryHandler
    );
  }
}
const langGraphChannelIntegration = core.defineIntegration(_langGraphChannelIntegration);

exports.langGraphChannelIntegration = langGraphChannelIntegration;
//# sourceMappingURL=langgraph.js.map
