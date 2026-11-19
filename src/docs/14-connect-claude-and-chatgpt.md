# Connect Claude or ChatGPT
> Let an AI app read and edit your project files, with your approval.

KingxTech has a connector for AI apps that support MCP, such as Claude and ChatGPT. Once you approve it, you can ask the app things like "list my projects", "read src/App.jsx" or "change the heading on my home page" and it works on your real project files.

## Connect an app
1. Open **Account > Apps** and copy the connector address.
2. In **Claude**, open Settings > Connectors and add a custom connector with that address. In **ChatGPT**, turn on Developer mode in Settings > Apps & Connectors > Advanced settings and create an app with that address and OAuth sign-in. What you can do in ChatGPT depends on your plan.
3. The app sends you to a KingxTech page. Check the app name and where it will return to, then press **Approve**.

## What an approved app can do
- See your project list and whether each project is published or has a server running.
- Read the text files in your projects. Secrets files such as `.env` are hidden.
- Create, edit or replace text files in projects you can edit. This uses your plan's storage as usual.
- Turn **Install as App** on or off, and set an app icon the AI designs for you, in projects you own. Custom icons need Pro.
- See your **Data for your site** collections and records, and choose whether visitors can add or read them, in projects you own.
- Read a short guide that teaches the AI how KingxTech works (projects, publishing, plans), so it knows what to do before it edits.
- See your plan and how much storage you have used.

## What it cannot do
- Delete files, records or projects.
- Publish a site or start a server.
- See or change environment variables and secrets.
- Touch billing, domains or account settings.

## Stay in control
- Changes are saved to your project right away but do **not** go live until you press **Publish changes**. Use **restore points** in the project to go back.
- Remove an app any time in **Account > Apps**. It may keep working for up to an hour until its current sign-in expires.
- Only approve an app you just connected yourself. Read the name and the address it will return to on the approval page.
- Text inside your files is read by the AI app. Be careful with files you did not write, because they could contain instructions meant to trick an AI.

## Limits
An app can make up to 120 requests a minute, and 30 file writes a minute. Files can be up to 500,000 characters. Long files are read in pieces of about 30,000 characters, so the AI app may make several reads for one big file.

## If an app says a file is empty or cannot be read
Ask it to read the file again and to continue from where it stopped. If it still fails, tell us at the support address in the app, with the project name and the file path.
