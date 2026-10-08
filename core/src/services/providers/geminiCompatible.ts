import {
  GoogleGenerativeAI,
  SchemaType,
  type FunctionDeclaration,
  type Tool as GeminiTool,
  type Content,
} from '@google/generative-ai';
import { AGENT_MAX_DURATION_MS, AGENT_MAX_TOOL_STEPS, buildAgentTimeoutSummary, isAgentTimeout, runProviderCall, runTool, serializeToolResult, buildSystemInstruction } from '../agentTools';
import type { AgentOpts, AgentResult, ToolDef, JSONSchemaProp, ToolStep } from '../agentTools';

function toGeminiProp(p: JSONSchemaProp): any {
  if (p.type === 'array') return { type: SchemaType.ARRAY, description: p.description, items: toGeminiProp(p.items!) };
  if (p.type === 'object') return { type: SchemaType.OBJECT, description: p.description, properties: {} };
  return { type: SchemaType.STRING, description: p.description };
}

function toGeminiTool(t: ToolDef): FunctionDeclaration {
  const properties: Record<string, any> = {};
  for (const [k, v] of Object.entries(t.parameters.properties)) properties[k] = toGeminiProp(v);
  return {
    name: t.name,
    description: t.description,
    parameters: { type: SchemaType.OBJECT, properties, required: t.parameters.required },
  };
}

/**
 * Shared implementation for any Gemini-API-compatible client (the paid
 * Gemini models, or Gemma served through the same Gemini API under a
 * separate, genuinely-free-tier key) — same request/response shape either
 * way, just a different bound client. Returns a ready-to-use runAgent
 * function bound to one client.
 */
export function createGeminiCompatibleAgent(genAI: GoogleGenerativeAI) {
  return async function runAgent(opts: AgentOpts): Promise<AgentResult> {
    const { modelId, history, prompt, tools, ctx, onStep } = opts;
    const geminiTools: GeminiTool[] = [{ functionDeclarations: tools.map(toGeminiTool) }];

    const model = genAI.getGenerativeModel({ model: modelId, tools: geminiTools, systemInstruction: buildSystemInstruction(ctx.readOnly) });
    const geminiHistory: Content[] = history.map((h) => ({ role: h.role, parts: [{ text: h.text }] }));
    const contents: Content[] = [
      ...geminiHistory,
      { role: 'user', parts: [{ text: prompt }] },
    ];

    const steps: ToolStep[] = [];
    const deadlineAt = Date.now() + AGENT_MAX_DURATION_MS;

    const generate = () => model.generateContent({ contents });
    let result;
    try {
      result = await runProviderCall(generate, deadlineAt);
    } catch (error) {
      if (isAgentTimeout(error)) return { text: buildAgentTimeoutSummary(steps), steps };
      throw error;
    }

    let call = result.response.functionCalls()?.[0];
    let iterations = 0;

    while (call && iterations < AGENT_MAX_TOOL_STEPS) {
      if (Date.now() >= deadlineAt) return { text: buildAgentTimeoutSummary(steps), steps };

      const modelContent = result.response.candidates?.[0]?.content;
      if (!modelContent) {
        throw new Error('Gemini provider returned no candidate content.');
      }
      contents.push(modelContent);

      const { result: toolResult, step } = await runTool(
        call.name,
        (call.args ?? {}) as Record<string, unknown>,
        ctx
      );
      steps.push(step);
      onStep?.(step);

      const userParts: Content['parts'] = [
        {
          functionResponse: {
            name: call.name,
            response: { result: serializeToolResult(toolResult) },
          },
        },
      ];

      iterations += 1;
      if (iterations === AGENT_MAX_TOOL_STEPS - 2) {
        userParts.push({
          text: 'You have only 2 tool steps remaining. Stop using tools after the next necessary step and provide a concise summary of the work completed.',
        });
      }

      // Gemini requires functionResponse parts to be in a user turn. Do not use
      // chat.sendMessage here: that path produced production 400s with role "function".
      contents.push({ role: 'user', parts: userParts });

      try {
        result = await runProviderCall(generate, deadlineAt);
      } catch (error) {
        if (isAgentTimeout(error)) return { text: buildAgentTimeoutSummary(steps), steps };
        throw error;
      }
      call = result.response.functionCalls()?.[0];
    }

    if (Date.now() >= deadlineAt) return { text: buildAgentTimeoutSummary(steps), steps };
    return { text: result.response.text() || 'No response generated.', steps };
  };
}
