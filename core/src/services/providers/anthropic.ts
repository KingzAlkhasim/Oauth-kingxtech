import Anthropic from '@anthropic-ai/sdk';
import { runTool, SYSTEM_INSTRUCTION } from '../agentTools';
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

  while (iterations < 8) {
    const response = await anthropic.messages.create({
      model: modelId,
      max_tokens: 4096,
      system: SYSTEM_INSTRUCTION,
      messages,
      tools: anthropicTools,
    });

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
      toolResults.push({ type: 'tool_result', tool_use_id: block.id, content: JSON.stringify(result) });
    }
    messages.push({ role: 'user', content: toolResults });
    iterations += 1;
  }

  return { text: 'Reached the maximum number of tool steps without a final answer.', steps };
}
