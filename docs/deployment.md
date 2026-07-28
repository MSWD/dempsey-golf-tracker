# Deployment: GitHub Pages + custom domain

DNS for `mswd.us` is on Cloudflare nameservers (confirmed via `dig NS mswd.us`) — GoDaddy is just
the registrar. That means the custom domain, the Pages site, and the auth relay Worker all live in
the same Cloudflare account.

## GitHub Pages setup

1. Repo Settings → Pages → Source: deploy from the `main` branch, folder `/src`.
2. `src/CNAME` (already committed) contains `dempsey-golf-tracker.mswd.us` — GitHub uses this to
   know the custom domain and to redirect the default `<org>.github.io` URL.
3. In the same Settings → Pages panel, enter the custom domain and let GitHub verify it. Check
   "Enforce HTTPS" once the cert issues (can take a few minutes after the DNS record below exists).

## Cloudflare DNS record

In the `mswd.us` zone in the Cloudflare dashboard, add:

- Type: `CNAME`
- Name: `dempsey-golf-tracker`
- Target: `<github-org-or-user>.github.io`
- Proxy status: **DNS only (grey cloud)** — not proxied. GitHub Pages issues and manages its own
  TLS cert for the custom domain, and Cloudflare's proxy in front of it commonly breaks GitHub's
  domain verification/cert issuance. If page-load performance or Cloudflare-side caching is wanted
  later, that's a deliberate follow-up, not the default.

## Cloudflare Worker (device-flow relay)

Deploy `worker/cloudflare-device-flow-relay.js` via `wrangler deploy` or the dashboard's Quick
Edit, under the same Cloudflare account. It gets its own `*.workers.dev` URL by default — no custom
domain or extra DNS record is needed, since it's only ever called via `fetch()` from
`src/js/github-auth.js`, never visited directly. Copy that URL into
`src/js/team-config.js` → `githubApp.deviceFlowWorkerUrl`.

No secrets are stored in the Worker — it only relays the GitHub App's public Client ID and forwards
request/response bodies for GitHub's two device-flow endpoints, adding CORS headers so a static
site's browser JS can call them.

## Forking for a new team/domain

If a fork wants a different custom domain: update `src/CNAME`, update `domain` in
`team-config.js`, and repeat the Cloudflare DNS step above for the new domain/zone.
