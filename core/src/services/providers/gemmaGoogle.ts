import { GoogleGenerativeAI } from '@google/generative-ai';
import { createGeminiCompatibleAgent } from './geminiCompatible';
import { env } from '../../config/env';
import type { AgentOpts, AgentResult } from '../agentTools';

// Gemma (Google DeepMind's open-weights family) is served through the same
// Gemini API endpoint as Gemini itself — but billed/quota'd completely
// separately. Using a DIFFERENT API key here (from a Google Cloud project
// with no billing enabled) keeps this genuinely free and fully isolated
// from the paid GEMINI_API_KEY used for Flash/Pro.
const gemmaGenAI = env.GEMMA_FREE_API_KEY ? new GoogleGenerativeAI(env.GEMMA_FREE_API_KEY) : null;
const runGemmaAgentInternal = gemmaGenAI ? createGeminiCompatibleAgent(gemmaGenAI) : null;

export async function runGemmaGoogleAgent(opts: AgentOpts): Promise<AgentResult> {
  if (!runGemmaAgentInternal) {
    throw new Error(
      'Gemma (Google) is not configured yet — set GEMMA_FREE_API_KEY to a free-tier AI Studio key (no billing enabled on that project).'
    );
  }
  return runGemmaAgentInternal(opts);
}
