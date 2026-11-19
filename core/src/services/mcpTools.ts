import { isBlockedMcpPath } from './mcpAuth';
import { getGuide, GUIDE_TOPICS } from './mcpGuide';

// The tools an AI app gets after the user approves it: look at projects and files, edit files, check usage.
// Deliberately NOT here: deleting, publishing, secrets and environment variables, billing, servers, domains, account settings.
// File contents are untrusted text that an AI app will read, so nothing here can do damage beyond a file the user can restore.

// One reply must stay small: some AI apps reject tool results over roughly 25k tokens. Long files are read in chunks.
export const DEFAULT_READ_CHARS = 30_000;
export const MAX_READ_CHARS = 40_000;
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
  siteSettings(userId: string, projectId: string): Promise<Record<string, unknown>>;
  setInstallable(userId: string, projectId: string, enabled: boolean): Promise<void>;
  setAppIcon(userId: string, projectId: string, svg: string): Promise<{ publicUrl: string }>;
  listCollections(userId: string, projectId: string): Promise<Record<string, unknown>[]>;
  readRows(userId: string, projectId: string, collection: string, limit: number): Promise<Record<string, unknown>[]>;
  setRules(userId: string, projectId: string, collection: string, rules: { publicCreate: boolean; publicRead: boolean }): Promise<{ publicCreate: boolean; publicRead: boolean }>;
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
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  },
  {
    name: 'get_project_status', title: 'Get project status',
    description: 'Show whether a project is published and its live address, plus the state of its server if it has one.',
    inputSchema: { type: 'object', properties: { projectId }, required: ['projectId'], additionalProperties: false },
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  },
  {
    name: 'list_files', title: 'List files',
    description: 'List every file and folder in a project.',
    inputSchema: { type: 'object', properties: { projectId }, required: ['projectId'], additionalProperties: false },
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  },
  {
    name: 'get_platform_guide', title: 'How KingxTech works',
    description: 'Explains how KingxTech works: projects, static sites, publishing, Install as App, site data, plans. Call this once at the start, before editing anything. Optional topic: ' + GUIDE_TOPICS.join(', ') + ', or all.',
    inputSchema: { type: 'object', properties: { topic: { type: 'string', description: 'One of: ' + GUIDE_TOPICS.join(', ') + '. Leave empty for everything.' } }, additionalProperties: false },
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  },
  {
    name: 'read_file', title: 'Read file',
    description: `Read one text file from a project. Returns up to ${MAX_READ_CHARS.toLocaleString('en-US')} characters per call (default ${DEFAULT_READ_CHARS.toLocaleString('en-US')}). If "done" is false, call again with offset set to "nextOffset" to get the rest. Secrets files (.env) and binary files are not readable.`,
    inputSchema: { type: 'object', properties: { projectId, path: filePath, offset: { type: 'integer', minimum: 0, description: 'Character position to start from. Default 0.' }, limit: { type: 'integer', minimum: 1, maximum: MAX_READ_CHARS, description: 'Characters to return.' } }, required: ['projectId', 'path'], additionalProperties: false },
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  },
  {
    name: 'edit_file', title: 'Edit part of a file',
    description: 'Replace one exact piece of text in a file with new text. oldText must appear exactly once (add surrounding text to make it unique). Best for small changes to big files. Needs editor access. The change is saved but not live until the owner publishes.',
    inputSchema: { type: 'object', properties: { projectId, path: filePath, oldText: { type: 'string', description: 'Exact text to find, including whitespace. Must match once.' }, newText: { type: 'string', description: 'Text to put in its place. Empty string deletes oldText.' } }, required: ['projectId', 'path', 'oldText', 'newText'], additionalProperties: false },
    annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: false, openWorldHint: false },
  },
  {
    name: 'write_file', title: 'Create or replace file',
    description: `Create a text file or replace its whole content (up to ${MAX_WRITE_CHARS.toLocaleString('en-US')} characters). Needs editor access and storage space. The user can undo changes from restore points in KingxTech. Read the file first if you are replacing it.`,
    inputSchema: { type: 'object', properties: { projectId, path: filePath, content: { type: 'string', description: 'The complete new content of the file.' } }, required: ['projectId', 'path', 'content'], additionalProperties: false },
    annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: true, openWorldHint: false },
  },
  {
    name: 'get_site_settings', title: 'Get site settings',
    description: 'Show a project\'s Install as App settings: whether it is on, theme and background colors, whether a custom icon is set, and whether the project is published.',
    inputSchema: { type: 'object', properties: { projectId }, required: ['projectId'], additionalProperties: false },
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  },
  {
    name: 'update_site_settings', title: 'Turn Install as App on or off',
    description: 'Turn "Install as App" on or off for a project. Owner only. The site must be published for people to install it.',
    inputSchema: { type: 'object', properties: { projectId, installAsApp: { type: 'boolean', description: 'true to let visitors install the site as an app.' } }, required: ['projectId', 'installAsApp'], additionalProperties: false },
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  },
  {
    name: 'set_app_icon', title: 'Set generated app icon',
    description: 'Design the Install-as-App icon by sending SVG code; KingxTech turns it into a square PNG and sets it. Owner and Pro plan only. Use viewBox="0 0 512 512" with a solid background. No images, links, scripts or filters. Replaces any current custom icon.',
    inputSchema: { type: 'object', properties: { projectId, svg: { type: 'string', description: 'Complete SVG markup for a square icon.' } }, required: ['projectId', 'svg'], additionalProperties: false },
    annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: true, openWorldHint: false },
  },
  {
    name: 'list_data_collections', title: 'List site data collections',
    description: 'List the "Data for your site" collections in a project with record counts and whether the public site may add (publicCreate) or read (publicRead) records.',
    inputSchema: { type: 'object', properties: { projectId }, required: ['projectId'], additionalProperties: false },
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  },
  {
    name: 'read_data_rows', title: 'Read site data records',
    description: 'Read the newest records of a collection (form submissions, orders and so on). These are the owner\'s visitors\' data: summarize, do not repeat personal details unnecessarily.',
    inputSchema: { type: 'object', properties: { projectId, collection: { type: 'string', description: 'Collection name from list_data_collections.' }, limit: { type: 'integer', minimum: 1, maximum: 50, description: 'How many records. Default 20.' } }, required: ['projectId', 'collection'], additionalProperties: false },
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  },
  {
    name: 'set_data_rules', title: 'Set who can add or read site data',
    description: 'Set whether visitors of the public site may add records (publicCreate) and read records (publicRead) for a collection. Owner only. Never enable publicRead for emails, phone numbers or private data: anyone on the internet could read it. Creates the collection if it is new. Records cannot be deleted from here.',
    inputSchema: { type: 'object', properties: { projectId, collection: { type: 'string', description: 'Lowercase letters, digits, - or _, starting with a letter, up to 40 characters.' }, publicCreate: { type: 'boolean' }, publicRead: { type: 'boolean' } }, required: ['projectId', 'collection', 'publicCreate', 'publicRead'], additionalProperties: false },
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  },
  {
    name: 'get_account_usage', title: 'Get plan and storage',
    description: "Show the user's plan and how much project storage they have used.",
    inputSchema: { type: 'object', properties: {}, additionalProperties: false },
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  },
] as const;

export const WRITE_TOOLS: ReadonlySet<string> = new Set(['write_file', 'edit_file', 'update_site_settings', 'set_app_icon', 'set_data_rules']);

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
    case 'get_platform_guide':
      return getGuide(typeof args.topic === 'string' ? args.topic : undefined);
    case 'read_file': {
      const file = await deps.readFile(userId, pid(args), safePath(args));
      if (file.content === null) throw new McpToolError('That path is a folder.');
      if (file.content.startsWith(BINARY_PREFIX)) return JSON.stringify({ path: file.path, binary: true, note: 'Binary file (image, font or PDF). Its content is not shown.' });
      const total = file.content.length;
      const offset = Math.min(Math.max(Math.floor(Number(args.offset) || 0), 0), total);
      const limit = Math.min(Math.max(Math.floor(Number(args.limit) || DEFAULT_READ_CHARS), 1), MAX_READ_CHARS);
      const end = Math.min(offset + limit, total);
      const done = end >= total;
      return JSON.stringify({
        path: file.path, updatedAt: file.updated_at, totalChars: total, offset, returnedChars: end - offset, done, nextOffset: done ? null : end,
        ...(file.content === '' ? { note: 'The file exists but is empty.' } : {}),
        content: file.content.slice(offset, end),
      });
    }
    case 'edit_file': {
      const oldText = args.oldText; const newText = args.newText;
      if (typeof oldText !== 'string' || oldText === '') throw new McpToolError('"oldText" is required.');
      if (typeof newText !== 'string') throw new McpToolError('"newText" is required (use an empty string to delete).');
      const projectIdValue = pid(args); const path = safePath(args);
      const file = await deps.readFile(userId, projectIdValue, path);
      if (file.content === null) throw new McpToolError('That path is a folder.');
      if (file.content.startsWith(BINARY_PREFIX)) throw new McpToolError('Binary files cannot be edited here.');
      const first = file.content.indexOf(oldText);
      if (first === -1) throw new McpToolError('oldText was not found. Read the file again and copy the text exactly, including spaces and line breaks.');
      if (file.content.indexOf(oldText, first + 1) !== -1) throw new McpToolError('oldText appears more than once. Include more surrounding text so it matches exactly one place.');
      const updated = file.content.slice(0, first) + newText + file.content.slice(first + oldText.length);
      if (updated.length > MAX_WRITE_CHARS) throw new McpToolError(`The edited file would be larger than ${MAX_WRITE_CHARS.toLocaleString('en-US')} characters.`);
      await deps.writeFile(userId, projectIdValue, path, updated);
      return JSON.stringify({ ok: true, path, totalChars: updated.length, note: 'Saved. Not live until the owner publishes.' });
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
    case 'get_site_settings':
      return JSON.stringify(await deps.siteSettings(userId, pid(args)));
    case 'update_site_settings': {
      if (typeof args.installAsApp !== 'boolean') throw new McpToolError('"installAsApp" must be true or false.');
      await deps.setInstallable(userId, pid(args), args.installAsApp);
      return JSON.stringify({ ok: true, installAsApp: args.installAsApp, note: 'Saved. The site must be published for people to install it.' });
    }
    case 'set_app_icon': {
      const out = await deps.setAppIcon(userId, pid(args), str(args, 'svg'));
      return JSON.stringify({ ok: true, iconUrl: out.publicUrl, note: 'Icon saved. It shows when the site is installed or re-installed.' });
    }
    case 'list_data_collections':
      return JSON.stringify({ collections: await deps.listCollections(userId, pid(args)) });
    case 'read_data_rows': {
      const limit = Math.min(Math.max(Math.floor(Number(args.limit) || 20), 1), 50);
      const rows = await deps.readRows(userId, pid(args), str(args, 'collection').trim(), limit);
      const text = JSON.stringify({ count: rows.length, rows });
      return text.length > MAX_READ_CHARS ? JSON.stringify({ count: rows.length, note: 'Records are too large to show at once. Ask for a smaller limit.' }) : text;
    }
    case 'set_data_rules': {
      if (typeof args.publicCreate !== 'boolean' || typeof args.publicRead !== 'boolean') throw new McpToolError('"publicCreate" and "publicRead" must be true or false.');
      const rules = await deps.setRules(userId, pid(args), str(args, 'collection').trim(), { publicCreate: args.publicCreate, publicRead: args.publicRead });
      return JSON.stringify({ ok: true, ...rules, ...(rules.publicRead ? { warning: 'Anyone on the internet can now read this collection. Keep emails, phone numbers and private data out of it.' } : {}) });
    }
    case 'get_account_usage':
      return JSON.stringify(await deps.accountUsage(userId));
    default:
      throw new McpToolError(`Unknown tool: ${name}`);
  }
}
