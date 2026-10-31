# Save data and run a server
> Give your published site a backend: save form entries with no code on the server, or run your own Node server on the Pro plan.

{{video: PASTE_YOUTUBE_LINK_HERE}}

## Two ways to get a backend

A KingxTech site is a set of static files, so the browser alone cannot keep a secret or remember what visitors send. There are two safe ways to add a backend.

- **Data for your site** is the simple one. Your page saves and lists records (contact form messages, guestbook entries, scores). No server code. Free for everyone.
- **Server for your site** runs your own Node server (for example Express) for custom logic, private keys and payments. Pro plan only.

## Data for your site

1. Open your project, go to **Site Settings**, and find **Data for your site**.
2. Add a collection, for example `messages`.
3. Choose who can do what. Both boxes start off:
   - **Visitors can add records** lets your page save entries.
   - **Visitors can read records** lets your page show them to everyone. Never turn this on for emails or phone numbers.
4. Copy the example into your site's JavaScript and publish.

Visitors can never edit or delete records. You can see and delete them in the same card. Each record is a flat set of text, numbers and true/false values, up to 16 KB, and a project holds up to 5000 records. To catch spam bots, add a hidden form field called `_hp` that real people leave empty.

## Server for your site (Pro)

1. Put a Node server in your project with a `start` script in `package.json`. It must listen on `process.env.PORT` on host `0.0.0.0`.
2. Open **Site Settings → Server for your site** and turn it on.
3. Press **Wake it up now and test**. If it fails, the last lines of its log are shown.
4. Call it from your page at `/api/public/server/YOUR_PROJECT_ID/your-route`.

The server **sleeps after about 10 quiet minutes** and wakes on the next request, which takes a few seconds. Do not keep important information in memory; save it somewhere permanent, such as Data for your site.

Good to know:

- Anyone can call your server, like any website API. Protect private actions with your own login token.
- Cookies are not passed through, redirects are not followed, and there are no live connections (websockets) yet.
- Replies are limited to 5 MB and 25 seconds, and requests to 1 MB.
- Keep secrets in **Site Settings → variables** and read them with `process.env`. Never put them in your code.
- If your plan ends, the server stops answering until you renew.
