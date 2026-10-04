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
export const SECURITY_CHECK_CREDIT_COST = 14; // One SecureCheck run costs 14 credits, regardless of whether Claude succeeds or fallback Gemini runs.

const MAX_CONTEXT_CHARS = 60_000; // keep both calls well inside context limits regardless of project size

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
    if (context.length + chunk.length > MAX_CONTEXT_CHARS) break; // truncate rather than blow the context window
    context += chunk;
  }
  return context;
}

async function reviewWithClaude(fileContext: string): Promise<string> {
  const response = await anthropic.messages.create({
    model: CLAUDE_MODEL_ID,
    max_tokens: 2048,
    system: SYSTEM_PROMPT,
    messages: [{ role: 'user', content: `Project source follows:${fileContext}` }],
  });
  const textBlock = response.content.find((b): b is Anthropic.TextBlock => b.type === 'text');
  return textBlock?.text ?? '(Claude returned no text response.)';
}

async function reviewWithGemini(fileContext: string): Promise<string> {
  const model = genAI.getGenerativeModel({ model: GEMINI_MODEL_ID, systemInstruction: SYSTEM_PROMPT });
  const result = await model.generateContent(`Project source follows:${fileContext}`);
  return result.response.text() || '(Gemini returned no text response.)';
}

export interface SecurityCheckResult {
  claude: string | null;
  gemini: string | null;
  claudeError: string | null;
  geminiError: string | null;
  filesReviewed: number;
  generatedAt: string;
}

export async function runSecurityCheck(userId: string, projectId: string): Promise<SecurityCheckResult> {
  const files = await listProjectFilesWithContent(userId, projectId);
  const fileContext = buildFileContext(files);

  // SecureCheck is deliberately sequential: Claude is the primary reviewer.
  // Gemini 3.8 Flash is only used when Claude fails, avoiding two provider
  // calls for every run while keeping a fallback available.
  let claude: string | null = null;
  let gemini: string | null = null;
  let claudeError: string | null = null;
  let geminiError: string | null = null;

  try {
    claude = await reviewWithClaude(fileContext);
  } catch (error) {
    claudeError = String((error as Error)?.message ?? error);
  }

  if (!claude) {
    try {
      gemini = await reviewWithGemini(fileContext);
    } catch (error) {
      geminiError = String((error as Error)?.message ?? error);
    }
  }

  if (!claude && !gemini) {
    throw new Error(`SecureCheck: primary and fallback reviewers failed. Claude: ${claudeError}. Gemini: ${geminiError}`);
  }
  return {
    claude,
    gemini,
    claudeError,
    geminiError,
    filesReviewed: files.filter((f) => f.content).length,
    generatedAt: new Date().toISOString(),
  };
}