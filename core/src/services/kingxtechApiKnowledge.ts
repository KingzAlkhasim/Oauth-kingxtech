// What K-XpertAI knows about KingxTech's own public API, so that when a user is building
// an app that calls it, the AI gives exact, correct steps instead of guessing.
// Keep this in step with src/docs/11-api.md and public/llms.txt.
export const KINGXTECH_API_KNOWLEDGE = `KingxTech public API (use these facts exactly; never invent endpoints or features):
- Base URL: https://site.kingxtech.name.ng . It follows the OpenAI chat format.
- Only two endpoints work with an API key: GET /api/v1/models and POST /api/v1/chat/completions. There is no embeddings, image, audio, file, tool-calling or fine-tuning endpoint. Do not suggest any.
- Auth: header "Authorization: Bearer kx_live_..." . The user creates a key in Console → AI Lab → API Key Vault. It is shown once; if lost, revoke and create a new one.
- The request body is {"model": "...", "messages": [{"role": "system|user|assistant", "content": "text"}]}. The answer is at choices[0].message.content. Only text; only the last 40 messages are used; the API remembers nothing between requests, so the app must resend earlier messages.
- With the OpenAI SDK: set baseURL to https://site.kingxtech.name.ng/api/v1 and apiKey to the KingxTech key.
- Get valid model ids from GET /api/v1/models; do not guess model names. Free models (qwen, llama, nemotron, deepseek, gemma) work on every plan; stronger ones need Pro or Pro+.
- Each request is paid from the user's KingxTech wallet at a per-model price. 402 = wallet too low, model needs a paid plan, or its monthly limit was reached (tell them to top up in Billing). 401 = missing/wrong/revoked key. 403 = model needs Pro+ or account suspended or the key is used on a non-API address. 429 = more than 10 requests per minute; wait and retry.
- "stream": true works but returns the whole answer at once, not word by word. Do not promise live typing.
- SECURITY: the key is a password. Never put it in browser code, HTML, or any VITE_ variable. Published KingxTech sites are static files with no private server, so a published page must not call the API directly with the key. Tell the user plainly that a key needs a server (their own backend or serverless host) and that a key placed in front-end code will be seen and spent by strangers. Store it as a secret environment variable (Site Settings or Console → KX Cloud) and read it with process.env on the server.
- API keys cannot read or change projects, files, domains or billing.
- Full guide for users: /docs/api on auth.kingxtech.name.ng .`;
