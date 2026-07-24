# KingxTech SSO client kit

Drop `kingxtech-sso.js` into any KingxTech product that needs to share login
state with `auth.kingxtech.name.ng` — K-XpertAI, SynthCode IDE, KX Cloud, or
anything that comes after.

## Requirements

- The product must use `@supabase/supabase-js`, pointed at the **same**
  Supabase project as the auth app (same `VITE_SUPABASE_URL` /
  `VITE_SUPABASE_ANON_KEY`). SSO only works because every product shares one
  Supabase Auth backend — this kit doesn't do anything if they're on
  different projects.
- In Supabase Dashboard → Authentication → URL Configuration, add each
  product's domain to **Redirect URLs**, e.g.:
  - `https://kxpertai.kingxtech.name.ng/*`
  - `https://synthcode.kingxtech.name.ng/*`
  - `https://auth.kingxtech.name.ng/*`

  Without this, Supabase will reject redirects to these domains during
  OAuth / email-confirmation flows.

## How the flow works

1. An unauthenticated visitor lands on `kxpertai.kingxtech.name.ng`.
2. The app calls `bootstrapSso(supabase)` on startup.
3. No session found → redirected to
   `auth.kingxtech.name.ng/login?redirect=kxpertai.kingxtech.name.ng`.
4. They sign in there. `auth.kingxtech.name.ng` sends them back to
   `https://kxpertai.kingxtech.name.ng/#access_token=...&refresh_token=...`.
5. K-XpertAI's `bootstrapSso()` picks up those tokens, calls
   `supabase.auth.setSession()`, cleans the URL, and the app renders
   normally — same account, no second login.

Tokens travel in the URL **fragment** (`#...`), which browsers never send to
servers and don't show up in server logs — the same mechanism Supabase's own
magic-link and OAuth implicit flows use.

## Usage

```js
// main.jsx / app entrypoint
import { supabase } from './lib/supabase';
import { bootstrapSso } from './kingxtech-sso';

bootstrapSso(supabase).then((session) => {
  if (session) {
    // mount the real app — the person is authenticated
  }
  // if session is null, bootstrapSso already redirected to login
});
```

To link out to another product from inside the app (e.g. a "Open SynthCode"
button inside K-XpertAI):

```js
import { handoffTo } from './kingxtech-sso';

<button onClick={() => handoffTo(supabase, 'synthcode.kingxtech.name.ng')}>
  Open SynthCode
</button>
```

## What this does NOT do

- It doesn't share sessions via cookies across subdomains — Supabase's
  default client uses `localStorage`, which is per-origin. This kit works
  around that with an explicit token handoff on redirect instead. That means
  SSO only kicks in at the moment someone navigates between products, not
  silently in the background — which is fine for the "sign in once, click
  between apps" experience this is built for.
- It doesn't persist across a browser session if the person visits a second
  product in a **new tab** they typed the URL into directly rather than
  clicking a link/redirect from the first. In that case they'll just hit the
  normal login redirect and sign in again — same as visiting any product
  cold.
