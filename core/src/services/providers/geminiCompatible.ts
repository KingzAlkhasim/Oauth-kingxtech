import {
  GoogleGenerativeAI,
  SchemaType,
  type FunctionDeclaration,
  type Tool as GeminiTool,
  type Content,
} from '@google/generative-ai';
import { runTool, SYSTEM_INSTRUCTION } from '../agentTools';
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

    const model = genAI.getGenerativeModel({ model: modelId, tools: geminiTools, systemInstruction: SYSTEM_INSTRUCTION });
    const geminiHistory: Content[] = history.map((h) => ({ role: h.role, parts: [{ text: h.text }] }));
    const chat = model.startChat({ history: geminiHistory });

    const steps: ToolStep[] = [];
    let result = await chat.sendMessage(prompt);
    let call = result.response.functionCalls()?.[0];
    let iterations = 0;

    while (call && iterations < 8) {
      const { result: toolResult, step } = await runTool(call.name, (call.args ?? {}) as Record<string, unknown>, ctx);
      steps.push(step);
      onStep?.(step);
      result = await chat.sendMessage([
        { functionResponse: { name: call.name, response: { result: toolResult } } },
      ]);
      call = result.response.functionCalls()?.[0];
      iterations += 1;
    }

    return { text: result.response.text() || 'No response generated.', steps };
  };
}
