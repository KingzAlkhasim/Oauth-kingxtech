# Publishing your site
> Put a project online, update it, and go back to an earlier version.

{{video: PASTE_YOUTUBE_LINK_HERE}}

## Publish

Open your project and press **Publish**. KingxTech builds your site if it needs building, then puts it online. A progress card shows how long it has taken. The first publish of a project with many packages can take a few minutes.

When it finishes you get your link, for example `https://site.kingxtech.name.ng/your-project/`. Press **Copy link** to share it.

## What can be published

- **Plain HTML projects:** any project with an `index.html` file in the main folder.
- **Vite projects** (React, Vue and others built with Vite).

Other kinds of projects can still be run in Preview, but cannot be published permanently yet.

## Update your site

After you change files, the Publish button turns into **Publish changes** and a badge says "Unpublished changes". Press it to put the latest version online.

## If publishing fails

You will see a plain message and a **Try again** button. Common causes:

- **"Your project has no index.html":** add an `index.html` file in the project's main folder.
- **"Installing your packages failed":** check `package.json` for a wrong package name or version.
- **"Your project failed to build":** open Technical details to see the error, or ask K-XpertAI to fix it.

If the connection drops while publishing, KingxTech checks whether the publish actually finished before showing an error.

## Restore points

Every time you publish, KingxTech saves a copy of your files. Open **Site Settings → Restore points** to see them. You can:

- **Restore** an earlier version. Your current version is saved first as "Before restore", so you can undo it. Then publish again to put the restored version online.
- **Save now** to make a restore point yourself before a big change.
- **Delete** a restore point you no longer need.

Free keeps the latest 3 restore points, Pro keeps 5 and Pro+ keeps 10. They do not use your storage limit.

## Visits

**Site Settings → Visits** shows how many people opened your site today, in the last 7 and 30 days, and in total. It counts page loads in real browsers. It does not store cookies or IP addresses, ignores bots and your own previews, and the numbers are approximate.
