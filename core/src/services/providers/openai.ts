import OpenAI from 'openai';
import { createOpenAICompatibleAgent } from './openaiCompatible';

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

export const runOpenAIAgent = createOpenAICompatibleAgent(openai);
