# Custom domains
> Use your own domain, like www.yourbusiness.com, for a published project.

{{video: PASTE_YOUTUBE_LINK_HERE}}

You need a domain you own, bought from a domain registrar, and a published project.

## Add a domain

1. Go to **Domains**.
2. Enter your domain, for example `www.yourbusiness.com`, and choose the project.
3. Press **Connect**.

## Point your domain to KingxTech

At your domain registrar, open the DNS settings for your domain and add the record shown on the Domains page:

- For a name such as `www` or `app` (a subdomain): a **CNAME** record pointing to `cname.vercel-dns.com`.
- For a bare domain such as `yourbusiness.com`: an **A** record pointing to `76.76.21.21`.

If you are unsure, the Domains page shows the exact records for your domain.

## Status

- **Waiting for DNS:** the domain is added, but the records are not pointing to KingxTech yet. DNS changes can take from a few minutes to a few hours.
- **Active:** the domain points to KingxTech and your site is served on it.

Use the verify button on the domain card to check again after you change your DNS records.

## Problems

- Make sure there is no old record for the same name pointing somewhere else.
- A new domain can take up to 24 hours to work everywhere.
- If the domain still does not work, see [Troubleshooting](/docs/troubleshooting) or contact support from Help.
