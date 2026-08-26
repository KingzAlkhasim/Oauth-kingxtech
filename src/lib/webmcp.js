import { listFiles, readFile, writeFile, previewUrl, publishProject } from './projectFiles';

const WORKSPACE_RE = /^\/projects\/([^/]+)\/workspace(?:\/.*)?$/;

function currentProjectId() {
  const match = window.location.pathname.match(WORKSPACE_RE);
  return match?.[1] || null;
}

function requireWorkspace() {
  const projectId = currentProjectId();
  if (!projectId) {
    throw new Error('Open a KingxTech project workspace before using project tools.');
  }
  return projectId;
}

async function confirmAction(client, message) {
  if (client?.requestUserInteraction) {
    await client.requestUserInteraction();
    return true;
  }
  return window.confirm(message);
}

export async function registerKingxTechWebMCP() {
  if (typeof document === 'undefined' || !document.modelContext?.registerTool) return false;

  const controller = new AbortController();

  const tools = [
    {
      name: 'open_project_workspace',
      title: 'Open a KingxTech project workspace',
      description: 'Open a KingxTech project workspace by project ID so the agent can work with the project.',
      inputSchema: {
        type: 'object',
        properties: {
          projectId: { type: 'string', description: 'The KingxTech project UUID.' },
        },
        required: ['projectId'],
        additionalProperties: false,
      },
      annotations: { readOnlyHint: true },
      execute: async ({ projectId }) => {
        if (!projectId || typeof projectId !== 'string') throw new Error('projectId is required.');
        window.location.assign(`/projects/${encodeURIComponent(projectId)}/workspace`);
        return `Opening project workspace ${projectId}.`;
      },
    },
    {
      name: 'get_workspace_context',
      title: 'Get current KingxTech workspace',
      description: 'Return the currently open KingxTech project workspace and browser path.',
      inputSchema: { type: 'object', properties: {}, additionalProperties: false },
      annotations: { readOnlyHint: true },
      execute: async () => ({
        projectId: currentProjectId(),
        path: window.location.pathname,
        ready: !!currentProjectId(),
      }),
    },
    {
      name: 'list_project_files',
      title: 'List project files',
      description: 'List files and folders in the currently open KingxTech project.',
      inputSchema: { type: 'object', properties: {}, additionalProperties: false },
      annotations: { readOnlyHint: true, untrustedContentHint: true },
      execute: async () => {
        const files = await listFiles(requireWorkspace());
        return files.slice(0, 300);
      },
    },
    {
      name: 'read_project_file',
      title: 'Read a project file',
      description: 'Read the text content of one file from the currently open KingxTech project.',
      inputSchema: {
        type: 'object',
        properties: {
          path: { type: 'string', description: 'Project-relative file path, for example src/App.jsx.' },
        },
        required: ['path'],
        additionalProperties: false,
      },
      annotations: { readOnlyHint: true, untrustedContentHint: true },
      execute: async ({ path }) => {
        if (!path || typeof path !== 'string') throw new Error('path is required.');
        const file = await readFile(requireWorkspace(), path);
        const content = String(file.content ?? '');
        if (content.length > 1400) {
          return { path: file.path, truncated: true, content: content.slice(0, 1400) };
        }
        return { path: file.path, truncated: false, content };
      },
    },
    {
      name: 'write_project_file',
      title: 'Edit a project file',
      description: 'Write text content to a file in the current KingxTech project. This changes project state.',
      inputSchema: {
        type: 'object',
        properties: {
          path: { type: 'string', description: 'Project-relative file path.' },
          content: { type: 'string', description: 'Complete replacement text for the file.' },
        },
        required: ['path', 'content'],
        additionalProperties: false,
      },
      annotations: { readOnlyHint: false, untrustedContentHint: true },
      execute: async ({ path, content }, client) => {
        if (!path || typeof path !== 'string') throw new Error('path is required.');
        if (typeof content !== 'string') throw new Error('content must be a string.');
        if (content.length > 200000) throw new Error('File is too large for an agent edit.');
        const confirmed = await confirmAction(client, `Allow the agent to replace ${path}?`);
        if (!confirmed) return 'User cancelled the file edit.';
        await writeFile(requireWorkspace(), path, content);
        window.dispatchEvent(new CustomEvent('kxpert:files-changed', { detail: { projectId: currentProjectId() } }));
        return `Updated ${path}.`;
      },
    },
    {
      name: 'preview_project',
      title: 'Preview the current project',
      description: 'Return the live KingxTech preview URL for the current project.',
      inputSchema: { type: 'object', properties: {}, additionalProperties: false },
      annotations: { readOnlyHint: true },
      execute: async () => previewUrl(requireWorkspace()),
    },
    {
      name: 'publish_project',
      title: 'Publish the current project',
      description: 'Publish the current KingxTech project and return its public URL. Requires user confirmation.',
      inputSchema: { type: 'object', properties: {}, additionalProperties: false },
      annotations: { readOnlyHint: false },
      execute: async (_input, client) => {
        const projectId = requireWorkspace();
        const confirmed = await confirmAction(client, 'Allow the agent to publish this KingxTech project publicly?');
        if (!confirmed) return 'User cancelled publishing.';
        const result = await publishProject(projectId);
        return { published: true, ...result };
      },
    },
  ];

  for (const tool of tools) {
    await document.modelContext.registerTool(tool, { signal: controller.signal });
  }

  return true;
}

registerKingxTechWebMCP().catch((error) => {
  console.warn('[WebMCP] Tool registration unavailable:', error?.message || error);
});
