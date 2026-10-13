import { GoogleGenerativeAI } from '@google/generative-ai';
import { createGeminiCompatibleAgent } from './geminiCompatible';
import { isTransientGemmaError, sanitizeGemmaError } from '../gemmaFallback';
import { env } from '../../config/env';
import type { AgentOpts, AgentResult } from '../agentTools';

// Gemma (Google DeepMind's open-weights family) is served through the same
// Gemini API endpoint as Gemini itself — but billed/quota'd completely
// separately. Using a DIFFERENT API key here (from a Google Cloud project
// with no billing enabled) keeps this genuinely free and fully isolated
// from the paid GEMINI_API_KEY used for Flash/Pro.
const gemmaGenAI = env.GEMMA_FREE_API_KEY ? new GoogleGenerativeAI(env.GEMMA_FREE_API_KEY) : null;
const runGemmaAgentInternal = gemmaGenAI ? createGeminiCompatibleAgent(gemmaGenAI) : null;
const runGemmaChatOnlyInternal = gemmaGenAI ? createGeminiCompatibleAgent(gemmaGenAI, { chatOnly: true }) : null;
const backoff = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

async function runWithTransientRetry(agent: NonNullable<typeof runGemmaAgentInternal>, opts: AgentOpts, canRetry: () => boolean): Promise<AgentResult> {
  try {
    return await agent(opts);
  } catch (error) {
    if (!isTransientGemmaError(error) || !canRetry()) throw error;
    await backoff(300);
    return agent(opts);
  }
}

export async function runGemmaGoogleAgent(opts: AgentOpts): Promise<AgentResult> {
  if (!runGemmaAgentInternal || !runGemmaChatOnlyInternal) {
    throw new Error(sanitizeGemmaError(new Error('Gemma key is not configured')));
  }
  let toolStepSeen = false;
  const observedOpts = { ...opts, onStep: (step: Parameters<NonNullable<typeof opts.onStep>>[0]) => { toolStepSeen = true; opts.onStep?.(step); } };
  const canRetry = () => !toolStepSeen;
  try {
    return await runWithTransientRetry(runGemmaAgentInternal, observedOpts, canRetry);
  } catch (error) {
    console.error('[gemma-google] Standard request failed; retrying without tools or systemInstruction.', error);
    if (toolStepSeen) throw new Error(sanitizeGemmaError(error));
    try {
      return await runWithTransientRetry(runGemmaChatOnlyInternal, { ...observedOpts, tools: [], chatOnly: true }, canRetry);
    } catch (chatOnlyError) {
      console.error('[gemma-google] Chat-only request failed after retry policy.', chatOnlyError);
      throw new Error(sanitizeGemmaError(chatOnlyError));
    }
  }
}
