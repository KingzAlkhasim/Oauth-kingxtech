import OpenAI from 'openai';
import { createOpenAICompatibleAgent } from './openaiCompatible';
import { env } from '../../config/env';

// OpenRouter (the default OPENWEIGHTS_PROVIDER) is fully OpenAI-compatible —
// same client, just pointed at a different base URL. This is what makes the
// genuinely-free tier possible: these are open-weight models (Qwen, Llama,
// DeepSeek, etc.) with $0 token pricing on OpenRouter's ":free" catalog,
// unlike Gemini which KingxTech pays Google for per request.
const openweights = new OpenAI({
  apiKey: env.OPENWEIGHTS_API_KEY || 'unset',
  baseURL: env.OPENWEIGHTS_BASE_URL,
});

export const runOpenWeightsAgent = createOpenAICompatibleAgent(openweights);
