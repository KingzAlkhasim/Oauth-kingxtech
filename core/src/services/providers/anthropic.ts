import Anthropic from '@anthropic-ai/sdk';
import { AGENT_MAX_DURATION_MS, AGENT_MAX_TOOL_STEPS, buildAgentTimeoutSummary, isAgentTimeout, runProviderCall, runTool, serializeToolResult, buildSystemInstruction } from '../agentTools';
import type { AgentOpts, AgentResult, ToolDef, ToolStep } from '../agentTools';

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

function toAnthropicTool(t: ToolDef): Anthropic.Tool {
  return { name: t.name, description: t.description, input_schema: t.parameters as any };
}

export async function runAnthropicAgent(opts: AgentOpts): Promise<AgentResult> {
  const { modelId, history, prompt, tools, ctx, onStep } = opts;

  const messages: Anthropic.MessageParam[] = [
    ...history.map((h) => ({ role: (h.role === 'model' ? 'assistant' : 'user') as 'assistant' | 'user', content: h.text })),
    { role: 'user' as const, content: prompt },
  ];

  const anthropicTools = tools.map(toAnthropicTool);
  const steps: ToolStep[] = [];
  let iterations = 0;
  const deadlineAt = Date.now() + AGENT_MAX_DURATION_MS;

  while (iterations < AGENT_MAX_TOOL_STEPS) {
    if (Date.now() >= deadlineAt) return { text: buildAgentTimeoutSummary(steps), steps };
    let response: Anthropic.Message;
    try {
      response = await runProviderCall(
        () => anthropic.messages.create({
          model: modelId,
          max_tokens: 4096,
          system: buildSystemInstruction(ctx.readOnly),
          messages,
          tools: anthropicTools,
        }),
        deadlineAt
      );
    } catch (error) {
      if (isAgentTimeout(error)) return { text: buildAgentTimeoutSummary(steps), steps };
      throw error;
    }

    const toolUseBlocks = response.content.filter(
      (b): b is Anthropic.ToolUseBlock => b.type === 'tool_use'
    );

    if (toolUseBlocks.length === 0) {
      const textBlock = response.content.find((b): b is Anthropic.TextBlock => b.type === 'text');
      return { text: textBlock?.text || 'No response generated.', steps };
    }

    messages.push({ role: 'assistant', content: response.content });

    const toolResults: Anthropic.ToolResultBlockParam[] = [];
    for (const block of toolUseBlocks) {
      const { result, step } = await runTool(block.name, (block.input ?? {}) as Record<string, unknown>, ctx);
      steps.push(step);
      onStep?.(step);
      toolResults.push({ type: 'tool_result', tool_use_id: block.id, content: serializeToolResult(result) });
    }
    messages.push({ role: 'user', content: toolResults });
    iterations += 1;
    if (iterations === AGENT_MAX_TOOL_STEPS - 2) {
      messages.push({
        role: 'user',
        content: 'You have only 2 tool steps remaining. Stop using tools after the next necessary step and provide a concise summary of the work completed.',
      });
    }
  }

  return { text: buildAgentTimeoutSummary(steps), steps };
}
