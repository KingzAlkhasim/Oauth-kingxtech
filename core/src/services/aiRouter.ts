import { toolsForContext, synthesizeFallbackText } from './agentTools';
import type { ProjectContext, AgentTurn, AgentResult, ToolStep } from './agentTools';
import { getProjectRole } from './projectPermissions';
import { runGeminiAgent } from './providers/gemini';
import { runAnthropicAgent } from './providers/anthropic';
import { runOpenAIAgent } from './providers/openai';
import { runOpenWeightsAgent } from './providers/openweights';
import { runGemmaGoogleAgent } from './providers/gemmaGoogle';
import { REGISTRY } from './modelRegistry';
import { resolveDefaultModelForTier } from './modelDefaults';
import { sanitizeGemmaError, shouldFallbackToFreeModel } from './gemmaFallback';
import type { Provider } from './modelRegistry';

export const generateContent = async (
  prompt: string,
  provider: Provider,
  modelId: string,
  history: AgentTurn[],
  ctx: ProjectContext,
  onStep?: (step: ToolStep) => void,
  onUsage?: (usage: {inputTokens:number;outputTokens:number;cachedInputTokens:number;cacheCreationInputTokens?:number}) => boolean | void
): Promise<AgentResult> => {
  let effectiveCtx = ctx;
  if (ctx.projectId) {
    const role = await getProjectRole(ctx.userId, ctx.projectId);
    if (!role) throw new Error('You are no longer a member of this project.');
    // Viewers are permanently Plan-mode for project K-XpertAI. This is server-side,
    // so a client cannot switch itself into Build mode by changing request JSON.
    if (role === 'viewer') effectiveCtx = { ...ctx, readOnly: true };
  }
  const tools = toolsForContext(effectiveCtx);
  const opts = { modelId, history, prompt, tools, ctx: effectiveCtx, onStep, onUsage };

  let result: AgentResult;
  if (provider === 'anthropic') result = await runAnthropicAgent(opts);
  else if (provider === 'openai') result = await runOpenAIAgent(opts);
  else if (provider === 'openweights') {
    const freeModels = REGISTRY.filter((m) => m.provider === 'openweights');
    const FREE_ROUTER_MODEL_ID = 'openrouter/free';
    const ordered = [freeModels.find((m) => m.modelId === modelId), ...freeModels.filter((m) => m.modelId !== modelId)]
      .filter((m): m is (typeof freeModels)[number] => !!m)
      .map((m) => ({ ...m, modelId: m.modelId.endsWith(':free') ? FREE_ROUTER_MODEL_ID : m.modelId }))
      .filter((m, i, arr) => arr.findIndex((x) => x.modelId === m.modelId) === i);
    let lastErr: any; let succeeded = false; result = undefined as unknown as AgentResult;
    for (const candidate of ordered) {
      try { result = await runOpenWeightsAgent({ ...opts, modelId: candidate.modelId }); succeeded = true; break; }
      catch (err: any) { console.error(`[openweights fallback] ${candidate.modelId} failed:`, err?.message ?? err); lastErr = err; }
    }
    if (!succeeded) throw lastErr;
  } else if (provider === 'gemma-google') {
    let gemmaToolStepSeen = false;
    const gemmaOpts = { ...opts, onStep: (step: ToolStep) => { gemmaToolStepSeen = true; onStep?.(step); } };
    try { result = await runGemmaGoogleAgent(gemmaOpts); }
    catch (error) {
      console.error('[aiRouter] Gemma unavailable; attempting a free-model fallback.', error);
      if (!shouldFallbackToFreeModel(provider, true, gemmaToolStepSeen)) throw new Error(sanitizeGemmaError(error));
      const fallback = resolveDefaultModelForTier('free', REGISTRY);
      try { result = await generateContent(prompt, fallback.provider, fallback.modelId, history, effectiveCtx, onStep, onUsage); result = { ...result, text: 'Gemma was unavailable, answered with ' + fallback.label + '.\n\n' + result.text }; }
      catch (fallbackError) { console.error('[aiRouter] Free-model fallback failed after Gemma failure.', fallbackError); throw new Error(sanitizeGemmaError(error)); }
    }
  } else result = await runGeminiAgent(opts);

  if (!result.text || !result.text.trim() || result.text === 'No response generated.') result = { ...result, text: synthesizeFallbackText(result.steps) };
  return result;
};
