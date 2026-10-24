# Environment variables
> Store settings and keys for your projects without writing them into your code.

{{video: PASTE_YOUTUBE_LINK_HERE}}

Environment variables are named values, like `API_URL` or `SUPABASE_URL`, that your project reads. KingxTech has two places to set them.

## Account-wide variables

**Console → KX Cloud → Env Vars.** These are available to all of your projects, during builds and in server code (`process.env.NAME`). Use them for values you reuse across projects.

## Project variables

**Project → Site Settings → Secrets & environment.** These belong to one project. If a project variable has the same name as an account variable, the project's value wins.

## Public and private

- **Private** (the default) variables are only available during builds and in server code. They are never sent to visitors.
- **Public** variables are also available to your published site in the browser as `window.KX_ENV.NAME`. Add `<script src="./kx-env.js"></script>` to your `index.html` to use them. Anyone who opens your site can read public variables, so **never mark a real secret as public**.

## Vite projects

Vite only exposes variables that start with `VITE_` to your browser code, as `import.meta.env.VITE_NAME`. Do not put real secrets in `VITE_` variables, because they end up in the published files.

## Good to know

- Values are stored as plain text, like a `.env` file. This is not a vault for passwords you cannot afford to leak.
- After you change a variable, publish again so the new value is used.
- Names must use letters, numbers and underscores only, and cannot start with a number. Names that change how the system runs, such as `PATH`, are ignored.
