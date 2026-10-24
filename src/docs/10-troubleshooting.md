# Troubleshooting
> Fixes for the most common problems.

## The app looks old after an update

Your browser may be showing a saved copy. Reload on a stable connection. If you use the installed app, close it and open it again. If it is still old, clear the site data for `auth.kingxtech.name.ng` in your browser settings and sign in again.

## "Could not reach KingxTech"

This means your device could not connect. Check your internet connection and try again. Your work is saved on the server, so nothing is lost.

## My site is blank after publishing

- Open the browser console for errors about files not found.
- In a Vite project, make sure `vite.config` sets `base: './'`. Without it, files are looked up in the wrong place on your published address. Ask K-XpertAI to "check my live site", and it will look for this.
- Make sure `index.html` is in the project's main folder.

## "Storage is full"

You reached your plan's [storage limit](/docs/plans-and-limits). Delete files you no longer need, or upgrade. Check the [Usage page](/usage) to see which project uses the most.

## My domain says "Waiting for DNS"

Your DNS records are not pointing to KingxTech yet. Compare them with the records shown on the Domains page, remove old conflicting records, and wait. It can take up to 24 hours. See [Custom domains](/docs/custom-domains).

## My environment variable is not showing up

- Publish again after changing a variable.
- In the browser, only Public variables are available, as `window.KX_ENV.NAME`, and only if `index.html` includes `<script src="./kx-env.js"></script>`.
- In a Vite project, browser code only sees names that start with `VITE_`.

## K-XpertAI says my usage is full

Your session or weekly allowance is used up. See the meters on the [Usage page](/usage) for when they reset.

## Still stuck?

Send us a message from the [Help page](/help) or write to hello@kingxtech.name.ng. Tell us what you did, what you expected and what you saw, and include a screenshot if you can.
