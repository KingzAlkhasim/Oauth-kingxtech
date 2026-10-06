import OpenAI from 'openai';
import { AGENT_MAX_DURATION_MS, AGENT_MAX_TOOL_STEPS, buildAgentTimeoutSummary, isAgentTimeout, runProviderCall, runTool, serializeToolResult, SYSTEM_INSTRUCTION } from '../agentTools';
import type { AgentOpts, AgentResult, ToolDef, ToolStep } from '../agentTools';

function toOpenAITool(t: ToolDef): OpenAI.Chat.ChatCompletionTool {
  return { type: 'function', function: { name: t.name, description: t.description, parameters: t.parameters as any } };
}

/**
 * Shared implementation for any OpenAI-compatible chat completions API
 * (OpenAI itself, or OpenRouter / Together for the free open-weights tier —
 * they all speak the same request/response shape). Returns a ready-to-use
 * runAgent function bound to one client.
 */
export function createOpenAICompatibleAgent(client: OpenAI) {
  return async function runAgent(opts: AgentOpts): Promise<AgentResult> {
    const { modelId, history, prompt, tools, ctx, onStep } = opts;

    const messages: OpenAI.Chat.ChatCompletionMessageParam[] = [
      { role: 'system', content: SYSTEM_INSTRUCTION },
      ...history.map((h) => ({
        role: (h.role === 'model' ? 'assistant' : 'user') as 'assistant' | 'user',
        content: h.text,
      })),
      { role: 'user', content: prompt },
    ];

    const openaiTools = tools.map(toOpenAITool);
    const steps: ToolStep[] = [];
    let iterations = 0;
    const deadlineAt = Date.now() + AGENT_MAX_DURATION_MS;

    while (iterations < AGENT_MAX_TOOL_STEPS) {
      if (Date.now() >= deadlineAt) return { text: buildAgentTimeoutSummary(steps), steps };
      let completion: OpenAI.Chat.ChatCompletion;
      try {
        completion = await runProviderCall(
          () => client.chat.completions.create({
            model: modelId,
            messages,
            tools: openaiTools,
            ...(modelId === 'gpt-6-sol' || modelId === 'gpt-6-luna' ? { reasoning_effort: 'none' as any } : {}),
          }),
          deadlineAt
        );
      } catch (error) {
        if (isAgentTimeout(error)) return { text: buildAgentTimeoutSummary(steps), steps };
        throw error;
      }
      const choice = completion.choices?.[0];
      if (!choice) {
        throw new Error('OpenAI-compatible provider returned no completion choice.');
      }
      const msg = choice.message;

      if (!msg.tool_calls || msg.tool_calls.length === 0) {
        return { text: msg.content || 'No response generated.', steps };
      }

      messages.push({ role: 'assistant', content: msg.content, tool_calls: msg.tool_calls });

      for (const call of msg.tool_calls) {
        let args: Record<string, unknown> = {};
        try {
          args = call.function.arguments ? JSON.parse(call.function.arguments) : {};
        } catch {
          // Malformed arguments — runTool will surface a clear error for this.
        }
        const { result, step } = await runTool(call.function.name, args, ctx);
        steps.push(step);
        onStep?.(step);
        messages.push({ role: 'tool', tool_call_id: call.id, content: serializeToolResult(result) });
      }
      iterations += 1;
      if (iterations === AGENT_MAX_TOOL_STEPS - 2) {
        messages.push({
          role: 'user',
          content: 'You have only 2 tool steps remaining. Stop using tools after the next necessary step and provide a concise summary of the work completed.',
        });
      }
    }

    return { text: buildAgentTimeoutSummary(steps), steps };
  };
}
