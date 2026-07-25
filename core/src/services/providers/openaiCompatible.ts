import OpenAI from 'openai';
import { runTool, SYSTEM_INSTRUCTION } from '../agentTools';
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

    while (iterations < 8) {
      const completion = await client.chat.completions.create({ model: modelId, messages, tools: openaiTools });
      const msg = completion.choices[0].message;

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
        messages.push({ role: 'tool', tool_call_id: call.id, content: JSON.stringify(result) });
      }
      iterations += 1;
    }

    return { text: 'Reached the maximum number of tool steps without a final answer.', steps };
  };
}
