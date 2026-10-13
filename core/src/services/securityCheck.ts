import Anthropic from '@anthropic-ai/sdk';
import { GoogleGenerativeAI } from '@google/generative-ai';
import { listProjectFilesWithContent } from './projectFs';

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY!);

// Security review is a plain one-shot completion — deliberately NOT using
// the agentic tool-calling loop (runAnthropicAgent/runGeminiAgent), since
// those can read/write/edit project files. A review should only ever read
// and report, never touch anything.
const CLAUDE_MODEL_ID = 'claude-sonnet-5';
const GEMINI_MODEL_ID = 'gemini-3.8-flash';
export const SECURITY_CHECK_CREDIT_COST = 14;

const MAX_CONTEXT_CHARS = 60_000;

const SYSTEM_PROMPT = `You are a senior application security reviewer. You are given the full source of a web project.
Review it for real, concrete security issues only — do not invent hypothetical ones. Focus on things like:
- Secrets or API keys committed in source
- Missing or broken authentication/authorization checks on sensitive routes
- SQL/NoSQL injection, XSS, SSRF, path traversal
- Insecure direct object references (missing ownership checks)
- Unsafe use of eval/exec/deserialization
- Overly permissive CORS or missing input validation on state-changing endpoints

Respond in this exact format, nothing else:
## Findings
- [severity: high/medium/low] <file path>: <concise description of the issue and why it matters>
(one line per finding, or "No significant issues found." if genuinely clean)

## Summary
<2-3 sentence plain-English summary for a non-security-expert founder>`;

function buildFileContext(files: { path: string; content: string | null }[]): string {
  let context = '';
  for (const f of files) {
    if (!f.content) continue;
    const chunk = `\n\n--- FILE: ${f.path} ---\n${f.content}`;
    if (context.length + chunk.length > MAX_CONTEXT_CHARS) break;
    context += chunk;
  }
  return context;
}

export interface SecurityUsage {
  provider: 'anthropic' | 'google';
  modelCode: 'sonnet5' | 'flash';
  inputTokens: number;
  outputTokens: number;
  cachedInputTokens: number;
  cacheCreationInputTokens: number;
  estimated: boolean;
}
interface SecurityReview {
  text: string;
  usage: SecurityUsage;
}
function estimateTokens(text: string): number {
  // Conservative text-only estimate used only when the provider omits token usage.
  return Math.max(1, Math.ceil(text.length / 3));
}

async function reviewWithClaude(fileContext: string): Promise<SecurityReview> {
  const userPrompt = `Project source follows:${fileContext}`;
  const response = await anthropic.messages.create({
    model: CLAUDE_MODEL_ID,
    max_tokens: 2048,
    system: SYSTEM_PROMPT,
    messages: [{ role: 'user', content: userPrompt }],
  });
  const textBlock = response.content.find((b): b is Anthropic.TextBlock => b.type === 'text');
  const text = textBlock?.text ?? '(Claude returned no text response.)';
  const usage = response.usage as Anthropic.Usage & {
    cache_read_input_tokens?: number | null;
    cache_creation_input_tokens?: number | null;
  };
  const normalInput = usage.input_tokens ?? 0;
  const cachedInput = usage.cache_read_input_tokens ?? 0;
  const cacheCreation = usage.cache_creation_input_tokens ?? 0;
  const output = usage.output_tokens ?? 0;
  const hasUsage = normalInput + cachedInput + cacheCreation + output > 0;
  return {
    text,
    usage: {
      provider: 'anthropic',
      modelCode: 'sonnet5',
      inputTokens: hasUsage ? normalInput + cachedInput + cacheCreation : estimateTokens(SYSTEM_PROMPT + userPrompt),
      outputTokens: hasUsage ? output : estimateTokens(text),
      cachedInputTokens: cachedInput,
      cacheCreationInputTokens: cacheCreation,
      estimated: !hasUsage,
    },
  };
}

async function reviewWithGemini(fileContext: string): Promise<SecurityReview> {
  const userPrompt = `Project source follows:${fileContext}`;
  const model = genAI.getGenerativeModel({ model: GEMINI_MODEL_ID, systemInstruction: SYSTEM_PROMPT });
  const result = await model.generateContent(userPrompt);
  const text = result.response.text() || '(Gemini returned no text response.)';
  const usage = result.response.usageMetadata;
  const input = usage?.promptTokenCount ?? 0;
  const output = usage?.candidatesTokenCount ?? 0;
  const cached = usage?.cachedContentTokenCount ?? 0;
  const hasUsage = input + output > 0;
  return {
    text,
    usage: {
      provider: 'google',
      modelCode: 'flash',
      inputTokens: hasUsage ? input : estimateTokens(SYSTEM_PROMPT + userPrompt),
      outputTokens: hasUsage ? output : estimateTokens(text),
      cachedInputTokens: cached,
      cacheCreationInputTokens: 0,
      estimated: !hasUsage,
    },
  };
}

export interface SecurityCheckResult {
  claude: string | null;
  gemini: string | null;
  claudeError: string | null;
  geminiError: string | null;
  filesReviewed: number;
  generatedAt: string;
  usage: SecurityUsage;
}

export async function runSecurityCheck(userId: string, projectId: string): Promise<SecurityCheckResult> {
  const files = await listProjectFilesWithContent(userId, projectId);
  const fileContext = buildFileContext(files);
  let claude: string | null = null;
  let gemini: string | null = null;
  let claudeError: string | null = null;
  let geminiError: string | null = null;
  let usage: SecurityUsage | null = null;

  try {
    const review = await reviewWithClaude(fileContext);
    claude = review.text;
    usage = review.usage;
  } catch (error) {
    claudeError = String((error as Error)?.message ?? error);
  }

  if (!claude) {
    try {
      const review = await reviewWithGemini(fileContext);
      gemini = review.text;
      usage = review.usage;
    } catch (error) {
      geminiError = String((error as Error)?.message ?? error);
    }
  }

  if (!claude && !gemini) {
    throw new Error(`SecureCheck: primary and fallback reviewers failed. Claude: ${claudeError}. Gemini: ${geminiError}`);
  }
  if (!usage) throw new Error('SecureCheck completed without usage accounting data.');
  return {
    claude,
    gemini,
    claudeError,
    geminiError,
    filesReviewed: files.filter((f) => f.content).length,
    generatedAt: new Date().toISOString(),
    usage,
  };
}