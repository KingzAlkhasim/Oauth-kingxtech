import { executeTerminalCommand } from './commandExecutor';
import {
  listProjectFiles,
  readProjectFile,
  writeProjectFile,
  createProjectFolder,
  deleteProjectFile,
} from './projectFs';
import { snapshotBeforeChange } from './versioning';

// --- Generic (provider-agnostic) tool schema --------------------------------
// Plain JSON Schema shapes. Gemini needs a small conversion (SchemaType enum);
// Anthropic and OpenAI accept this shape almost as-is.

export interface JSONSchemaProp {
  type: 'string' | 'array' | 'object';
  description?: string;
  items?: JSONSchemaProp;
}

export interface ToolDef {
  name: string;
  description: string;
  parameters: {
    type: 'object';
    properties: Record<string, JSONSchemaProp>;
    required?: string[];
  };
}

export interface ProjectContext {
  userId: string;
  projectId?: string;
  /** Groups every file mutation made in one agent turn, so it can be reviewed/reverted as a unit. */
  turnId?: string;
}

export interface AgentTurn {
  role: 'user' | 'model';
  text: string;
}

export interface ToolStep {
  tool: string;
  args: Record<string, unknown>;
  status: 'ok' | 'error';
  summary: string;
}

export interface AgentOpts {
  modelId: string;
  history: AgentTurn[];
  prompt: string;
  tools: ToolDef[];
  ctx: ProjectContext;
  /** Called immediately after each tool call finishes, for live progress streaming. */
  onStep?: (step: ToolStep) => void;
}

export interface AgentResult {
  text: string;
  steps: ToolStep[];
}

const FILE_TOOLS = [
  'listProjectFiles',
  'readProjectFile',
  'writeProjectFile',
  'createProjectFolder',
  'deleteProjectFile',
];
const MUTATING_TOOLS = ['writeProjectFile', 'createProjectFolder', 'deleteProjectFile'];

export const TOOL_DEFS: ToolDef[] = [
  {
    name: 'executeTerminalCommand',
    description:
      "Run an allowlisted, read-only diagnostic command (git status/log/diff, npm test/run/ls, node --version, ls, pwd). Cannot install packages, build, or modify anything — use the file tools for that.",
    parameters: {
      type: 'object',
      properties: {
        command: { type: 'string', description: "The base command name, e.g. 'git', 'npm', 'ls'." },
        args: {
          type: 'array',
          items: { type: 'string' },
          description: "Arguments to the command, e.g. ['status'] for 'git status'.",
        },
      },
      required: ['command'],
    },
  },
  {
    name: 'listProjectFiles',
    description: 'List every file and folder currently in this project.',
    parameters: { type: 'object', properties: {} },
  },
  {
    name: 'readProjectFile',
    description: 'Read the contents of a file in this project, by path.',
    parameters: {
      type: 'object',
      properties: {
        path: { type: 'string', description: "File path relative to the project root, e.g. 'index.html'." },
      },
      required: ['path'],
    },
  },
  {
    name: 'writeProjectFile',
    description: "Create a new file, or overwrite an existing file's full contents, at the given path.",
    parameters: {
      type: 'object',
      properties: {
        path: { type: 'string', description: 'File path relative to the project root.' },
        content: { type: 'string', description: 'The complete new contents of the file.' },
      },
      required: ['path', 'content'],
    },
  },
  {
    name: 'createProjectFolder',
    description: 'Create a folder at the given path (no-op if it already exists).',
    parameters: {
      type: 'object',
      properties: { path: { type: 'string', description: 'Folder path relative to the project root.' } },
      required: ['path'],
    },
  },
  {
    name: 'deleteProjectFile',
    description:
      "Delete a file, or a folder and everything inside it, at the given path. This can be undone via the version history, but only do it when the user's request clearly calls for it.",
    parameters: {
      type: 'object',
      properties: { path: { type: 'string', description: 'File or folder path relative to the project root.' } },
      required: ['path'],
    },
  },
];

export function toolsForContext(ctx: ProjectContext): ToolDef[] {
  return ctx.projectId ? TOOL_DEFS : TOOL_DEFS.filter((t) => t.name === 'executeTerminalCommand');
}

export const SYSTEM_INSTRUCTION = `
You are K-XpertAI, the official autonomous developer assistant for the KingxTech platform.
Your core model is KX-NeuroCore.
Your goal is to assist with web development, project management, and infrastructure tasks.
Always identify yourself as K-XpertAI when asked.

You can read, create, edit, and delete files inside the user's current project
using your file tools — these operate on that project's own workspace only,
never on any other user's data or the underlying server. Every change you make
is versioned and can be undone by the user, and the user reviews a summary of
everything you changed after each turn — so make deliberate, well-explained
changes rather than speculative ones.

IMPORTANT: after using any tools, you MUST always end your turn with a short
natural-language message to the user explaining what you did and why, in
plain language (e.g. "I created index.html with a hero section and a
contact form, styled with a dark theme to match your brand."). Never end a
turn with only tool calls and no explanation — the user cannot see your
tool calls directly, only your final message.

When creating or editing HTML, always include real, deliberate CSS styling
(via a <style> block or linked stylesheet) by default — good typography,
spacing, and a coherent color scheme — even if the user's request doesn't
mention styling. Bare unstyled HTML is not an acceptable default. Only skip
styling if the user explicitly asks for plain/unstyled HTML.

You also have a small set of read-only diagnostic commands (git status/log/diff,
npm test/run/ls, node --version, ls, pwd) — you cannot install packages, run
builds, or execute arbitrary shell commands. If a request needs that, say so
plainly rather than guessing or pretending you did it.

If the user has marked any KX Cloud environment variables as public, the
project automatically has a virtual /kx-env.js file available — include
<script src="/kx-env.js"></script> before your own scripts in an HTML file
if you want to read one of those values via window.KX_ENV.SOME_KEY. Only do
this if the user's request calls for it; don't add it speculatively.
`;

/**
 * Some models (especially smaller open-weight ones) sometimes return empty
 * or whitespace-only text after a tool-calling turn, despite the system
 * instruction telling them not to. Rather than show the user a bare "No
 * response generated," build an honest, useful summary from what the tools
 * actually did.
 */
export function synthesizeFallbackText(steps: ToolStep[]): string {
  if (steps.length === 0) return 'No response generated.';

  const summary = steps
    .filter((s) => s.status === 'ok')
    .map((s) => `- ${s.summary}`)
    .join('\n');
  const errors = steps.filter((s) => s.status === 'error');

  let text = summary ? `Done. Here's what I did:\n${summary}` : "I ran some tools but didn't produce a final summary — here's what happened:";
  if (errors.length > 0) {
    text += `\n\nSome steps had issues:\n${errors.map((s) => `- ${s.summary}`).join('\n')}`;
  }
  return text;
}

export async function runTool(
  name: string,
  args: Record<string, unknown>,
  ctx: ProjectContext
): Promise<{ result: unknown; step: ToolStep }> {
  if (FILE_TOOLS.includes(name) && !ctx.projectId) {
    const result = { ok: false, error: 'No project is open — file tools are unavailable outside a project workspace.' };
    return { result, step: { tool: name, args, status: 'error', summary: 'No project open.' } };
  }

  try {
    let result: unknown;
    let summary: string;

    // Snapshot the pre-change state for mutating ops, so this turn can be
    // reverted later. Skipped when there's no turnId (e.g. non-agent callers).
    if (MUTATING_TOOLS.includes(name) && ctx.turnId) {
      const path = (args as { path?: string }).path;
      if (path) {
        await snapshotBeforeChange(
          ctx.userId,
          ctx.projectId!,
          path,
          ctx.turnId,
          name === 'deleteProjectFile' ? 'delete' : name === 'createProjectFolder' ? 'create_folder' : 'write'
        );
      }
    }

    switch (name) {
      case 'executeTerminalCommand': {
        const a = args as { command: string; args?: string[] };
        result = await executeTerminalCommand(a.command, a.args ?? []);
        summary = `Ran "${a.command}${a.args?.length ? ' ' + a.args.join(' ') : ''}"`;
        break;
      }
      case 'listProjectFiles': {
        result = await listProjectFiles(ctx.userId, ctx.projectId!);
        summary = 'Listed project files.';
        break;
      }
      case 'readProjectFile': {
        const a = args as { path: string };
        result = await readProjectFile(ctx.userId, ctx.projectId!, a.path);
        summary = `Read ${a.path}`;
        break;
      }
      case 'writeProjectFile': {
        const a = args as { path: string; content: string };
        await writeProjectFile(ctx.userId, ctx.projectId!, a.path, a.content);
        result = { ok: true, path: a.path };
        summary = `Wrote ${a.path}`;
        break;
      }
      case 'createProjectFolder': {
        const a = args as { path: string };
        await createProjectFolder(ctx.userId, ctx.projectId!, a.path);
        result = { ok: true, path: a.path };
        summary = `Created folder ${a.path}`;
        break;
      }
      case 'deleteProjectFile': {
        const a = args as { path: string };
        await deleteProjectFile(ctx.userId, ctx.projectId!, a.path);
        result = { ok: true, path: a.path };
        summary = `Deleted ${a.path}`;
        break;
      }
      default:
        result = { ok: false, error: `Unknown tool: ${name}` };
        summary = `Unknown tool: ${name}`;
    }

    return { result, step: { tool: name, args, status: 'ok', summary } };
  } catch (err: any) {
    const result = { ok: false, error: err.message };
    return { result, step: { tool: name, args, status: 'error', summary: err.message } };
  }
}
