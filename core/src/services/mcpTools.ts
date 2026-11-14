import { isBlockedMcpPath } from './mcpAuth';

// The tools an AI app gets after the user approves it: look at projects and files, edit files, check usage.
// Deliberately NOT here: deleting, publishing, secrets and environment variables, billing, servers, domains, account settings.
// File contents are untrusted text that an AI app will read, so nothing here can do damage beyond a file the user can restore.

export const MAX_READ_CHARS = 200_000;
export const MAX_WRITE_CHARS = 500_000;
const BINARY_PREFIX = '__KX_BINARY_BASE64__:';

export interface McpProject { id: string; name: string; slug: string | null; status: string | null; role: string; published: boolean; publishedAt: string | null }

export interface McpDeps {
  listProjects(userId: string): Promise<McpProject[]>;
  listFiles(userId: string, projectId: string): Promise<{ path: string; is_folder: boolean; updated_at: string }[]>;
  readFile(userId: string, projectId: string, path: string): Promise<{ path: string; content: string | null; updated_at: string }>;
  writeFile(userId: string, projectId: string, path: string, content: string): Promise<void>;
  projectStatus(userId: string, projectId: string): Promise<Record<string, unknown>>;
  accountUsage(userId: string): Promise<Record<string, unknown>>;
}

/** A failure the AI app should see and may act on (bad input, no access, storage full). Anything else is hidden. */
export class McpToolError extends Error {}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const projectId = { type: 'string', description: 'Project id from list_projects.' };
const filePath = { type: 'string', description: 'Path relative to the project root, like "src/App.jsx". No leading slash.' };

export const MCP_TOOLS = [
  {
    name: 'list_projects', title: 'List projects',
    description: 'List the KingxTech projects the signed-in user owns or collaborates on, with their role.',
    inputSchema: { type: 'object', properties: {}, additionalProperties: false },
    annotations: { readOnlyHint: true, openWorldHint: false },
  },
  {
    name: 'get_project_status', title: 'Get project status',
    description: 'Show whether a project is published and its live address, plus the state of its server if it has one.',
    inputSchema: { type: 'object', properties: { projectId }, required: ['projectId'], additionalProperties: false },
    annotations: { readOnlyHint: true, openWorldHint: false },
  },
  {
    name: 'list_files', title: 'List files',
    description: 'List every file and folder in a project.',
    inputSchema: { type: 'object', properties: { projectId }, required: ['projectId'], additionalProperties: false },
    annotations: { readOnlyHint: true, openWorldHint: false },
  },
  {
    name: 'read_file', title: 'Read file',
    description: `Read one text file from a project (up to ${MAX_READ_CHARS.toLocaleString('en-US')} characters). Secrets files (.env) and binary files are not readable.`,
    inputSchema: { type: 'object', properties: { projectId, path: filePath }, required: ['projectId', 'path'], additionalProperties: false },
    annotations: { readOnlyHint: true, openWorldHint: false },
  },
  {
    name: 'write_file', title: 'Create or replace file',
    description: `Create a text file or replace its whole content (up to ${MAX_WRITE_CHARS.toLocaleString('en-US')} characters). Needs editor access and storage space. The user can undo changes from restore points in KingxTech. Read the file first if you are replacing it.`,
    inputSchema: { type: 'object', properties: { projectId, path: filePath, content: { type: 'string', description: 'The complete new content of the file.' } }, required: ['projectId', 'path', 'content'], additionalProperties: false },
    annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: true, openWorldHint: false },
  },
  {
    name: 'get_account_usage', title: 'Get plan and storage',
    description: "Show the user's plan and how much project storage they have used.",
    inputSchema: { type: 'object', properties: {}, additionalProperties: false },
    annotations: { readOnlyHint: true, openWorldHint: false },
  },
] as const;

export const WRITE_TOOLS: ReadonlySet<string> = new Set(['write_file']);

function str(args: Record<string, unknown>, key: string): string {
  const v = args[key];
  if (typeof v !== 'string' || v.trim() === '') throw new McpToolError(`"${key}" is required.`);
  return v;
}
function pid(args: Record<string, unknown>): string {
  const v = str(args, 'projectId').trim();
  if (!UUID.test(v)) throw new McpToolError('"projectId" must be an id from list_projects.');
  return v;
}
function safePath(args: Record<string, unknown>): string {
  const p = str(args, 'path');
  if (isBlockedMcpPath(p)) throw new McpToolError('That path is not available to AI apps (secrets and build output are off limits).');
  return p;
}

/** Runs a tool and returns the text the AI app will see. Throws McpToolError for problems worth showing. */
export async function runMcpTool(name: string, rawArgs: unknown, userId: string, deps: McpDeps): Promise<string> {
  const args = rawArgs && typeof rawArgs === 'object' ? (rawArgs as Record<string, unknown>) : {};
  switch (name) {
    case 'list_projects':
      return JSON.stringify({ projects: await deps.listProjects(userId) });
    case 'get_project_status':
      return JSON.stringify(await deps.projectStatus(userId, pid(args)));
    case 'list_files': {
      const files = (await deps.listFiles(userId, pid(args))).filter((f) => !isBlockedMcpPath(f.path));
      return JSON.stringify({ count: files.length, files: files.map((f) => ({ path: f.path, folder: f.is_folder, updatedAt: f.updated_at })) });
    }
    case 'read_file': {
      const file = await deps.readFile(userId, pid(args), safePath(args));
      if (file.content === null) throw new McpToolError('That path is a folder.');
      if (file.content.startsWith(BINARY_PREFIX)) return JSON.stringify({ path: file.path, binary: true, note: 'Binary file (image, font or PDF). Its content is not shown.' });
      const truncated = file.content.length > MAX_READ_CHARS;
      return JSON.stringify({ path: file.path, updatedAt: file.updated_at, truncated, content: truncated ? file.content.slice(0, MAX_READ_CHARS) : file.content });
    }
    case 'write_file': {
      const content = args.content;
      if (typeof content !== 'string') throw new McpToolError('"content" is required and must be text.');
      if (content.length > MAX_WRITE_CHARS) throw new McpToolError(`That file is larger than ${MAX_WRITE_CHARS.toLocaleString('en-US')} characters. Split it into smaller files.`);
      if (content.startsWith(BINARY_PREFIX)) throw new McpToolError('Binary files cannot be written here. Upload them in KingxTech.');
      const path = safePath(args);
      await deps.writeFile(userId, pid(args), path, content);
      return JSON.stringify({ ok: true, path, bytes: Buffer.byteLength(content, 'utf8') });
    }
    case 'get_account_usage':
      return JSON.stringify(await deps.accountUsage(userId));
    default:
      throw new McpToolError(`Unknown tool: ${name}`);
  }
}
