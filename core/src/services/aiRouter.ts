import { toolsForContext, synthesizeFallbackText } from './agentTools';
import type { ProjectContext, AgentTurn, AgentResult, ToolStep } from './agentTools';
import { runGeminiAgent } from './providers/gemini';
import { runAnthropicAgent } from './providers/anthropic';
import { runOpenAIAgent } from './providers/openai';
import { runOpenWeightsAgent } from './providers/openweights';
import { runGemmaGoogleAgent } from './providers/gemmaGoogle';
import { REGISTRY } from './modelRegistry';
import type { Provider } from './modelRegistry';

export const generateContent = async (
  prompt: string,
  provider: Provider,
  modelId: string,
  history: AgentTurn[],
  ctx: ProjectContext,
  onStep?: (step: ToolStep) => void
): Promise<AgentResult> => {
  const tools = toolsForContext(ctx);
  const opts = { modelId, history, prompt, tools, ctx, onStep };

  let result: AgentResult;
  if (provider === 'anthropic') {
    result = await runAnthropicAgent(opts);
  } else if (provider === 'openai') {
    result = await runOpenAIAgent(opts);
  } else if (provider === 'openweights') {
    // OpenRouter's free tier is a SHARED quota across every KingxTech user,
    // and individual free model IDs occasionally get renamed/retired by
    // OpenRouter. Try every free model in sequence — on ANY failure (rate
    // limit, invalid ID, transient provider error) — before giving up, so
    // one bad or busy model never takes down the whole free tier.
    const freeModels = REGISTRY.filter((m) => m.provider === 'openweights');
    const ordered = [
      freeModels.find((m) => m.modelId === modelId),
      ...freeModels.filter((m) => m.modelId !== modelId),
    ].filter((m): m is (typeof freeModels)[number] => !!m);

    let lastErr: any;
    let succeeded = false;
    result = undefined as unknown as AgentResult;
    for (const candidate of ordered) {
      try {
        result = await runOpenWeightsAgent({ ...opts, modelId: candidate.modelId });
        succeeded = true;
        break;
      } catch (err: any) {
        console.error(`[openweights fallback] ${candidate.modelId} failed:`, err?.message ?? err);
        lastErr = err;
        // Keep trying the next candidate regardless of error type.
      }
    }
    if (!succeeded) throw lastErr;
  } else if (provider === 'gemma-google') {
    result = await runGemmaGoogleAgent(opts);
  } else {
    result = await runGeminiAgent(opts);
  }

  // Defense-in-depth: some models (esp. smaller open-weight ones) sometimes
  // return empty text after tool calls despite the system instruction. Never
  // show the user a bare "No response generated" when we can build a real
  // summary from what the tools actually did.
  if (!result.text || !result.text.trim() || result.text === 'No response generated.') {
    result = { ...result, text: synthesizeFallbackText(result.steps) };
  }

  return result;
};
