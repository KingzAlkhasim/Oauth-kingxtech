# KingxTech / K-XpertAI

KingxTech is an AI-powered development workspace built around K-XpertAI / KX-NeuroCore. The repository contains the React/Vite application and the Node/Express AI backend used by the workspace.

## Agent-native WebMCP support

KingxTech now includes a progressive WebMCP integration. When a WebMCP-capable browser exposes `document.modelContext`, the app registers structured tools for the current project workspace:

- `open_project_workspace`
- `get_workspace_context`
- `list_project_files`
- `read_project_file`
- `write_project_file`
- `preview_project`
- `publish_project`

Read-only tools are annotated as such. File writes and publishing keep the human in the loop and require confirmation when the WebMCP client exposes `requestUserInteraction()`.

WebMCP is experimental. For local Chrome testing, enable `chrome://flags/#enable-webmcp-testing`. See the official WebMCP documentation for current availability and origin-trial requirements.

## Vercel backend failover

The frontend no longer needs to hard-code the Cloud Run API origin. Set `VITE_API_BASE_URL` to the URL of the Vercel-hosted KX-NeuroCore backend.

The backend remains the same Express application in `core/`, and can be deployed as a separate Vercel project with **Root Directory = `core`**. Its provider credentials and server-side secrets must be configured as Vercel environment variables; never put API keys in the frontend or Git repository.

Required backend secrets include the existing KX-NeuroCore environment variables such as `OPENAI_API_KEY`, `ANTHROPIC_API_KEY`, `GEMINI_API_KEY`, `OPENWEIGHTS_API_KEY` when used, Supabase credentials, and payment credentials.

For production, configure `ALLOWED_ORIGINS` on the backend to include the KingxTech frontend origin(s).

## Development

Frontend:

```bash
npm install
npm run dev
```

Backend:

```bash
cd core
npm install
npm run dev
```

## License

MIT. See `LICENSE`.
