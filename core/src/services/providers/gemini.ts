import { GoogleGenerativeAI } from '@google/generative-ai';
import { createGeminiCompatibleAgent } from './geminiCompatible';

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY!);

export const runGeminiAgent = createGeminiCompatibleAgent(genAI);
