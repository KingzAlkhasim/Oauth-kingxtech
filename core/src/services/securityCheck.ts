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
const GEMINI_MODEL_ID = 'gemini-3.1-pro-preview';
export const SECURITY_CHECK_CREDIT_COST = 14; // 8 (Claude Sonnet) + 6 (Gemini Pro), matches modelRegistry's per-model costs

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
  claude: string;
  gemini: string;
  filesReviewed: number;
  generatedAt: string;
}

export async function runSecurityCheck(userId: string, projectId: string): Promise<SecurityCheckResult> {
  const files = await listProjectFilesWithContent(userId, projectId);
  const fileContext = buildFileContext(files);

  // Run both reviews concurrently — independent calls, no shared state.
  const [claude, gemini] = await Promise.all([
    reviewWithClaude(fileContext),
    reviewWithGemini(fileContext),
  ]);

  return {
    claude,
    gemini,
    filesReviewed: files.filter((f) => f.content).length,
    generatedAt: new Date().toISOString(),
  };
}