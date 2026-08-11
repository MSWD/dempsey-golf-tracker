# Deployment: GitHub Pages + custom domain (one-time platform setup)

Everything in this doc happens **once ever**, for the whole platform — not per team. Onboarding a
new team is just `scripts/add-team.py` + a git commit; see `docs/architecture.md`.

Most of this is automated by `scripts/bootstrap-platform.sh` (prompts for a GitHub PAT with repo
admin rights and a Cloudflare API token). What follows is what that script does, plus the pieces
it can't automate.

DNS for `mswd.us` is on Cloudflare nameservers (confirmed via `dig NS mswd.us`) — GoDaddy is just
the registrar.

## GitHub Pages setup

Branch-based Pages only supports a source path of `/` or `/docs` — not `/src` — which doesn't fit
this repo's layout (and `/docs` is already the markdown documentation folder). So this platform
uses **Actions-based Pages** instead: `.github/workflows/deploy-pages.yml` uploads `src/` as the
Pages artifact directly, regardless of its path in the repo.

1. Repo Settings → Pages → Source: **GitHub Actions** (set automatically by the bootstrap script
   via `{"build_type": "workflow"}`; equivalent to picking it manually in that dropdown).
2. `src/CNAME` (committed) contains `middle-school-golf-tracker.mswd.us`.
3. Set the custom domain in the same Settings → Pages panel (or via the API, as the bootstrap
   script does) and let GitHub verify it. Check "Enforce HTTPS" once the cert issues.
4. **The site isn't live until the workflow actually runs.** It triggers on a published GitHub
   Release (tag) — matching the "bump `src/version.js` + cut a release per feature" pattern — or
   can be run manually via Actions → "Deploy to GitHub Pages" → Run workflow.

## Cloudflare DNS record

In the `mswd.us` zone: `CNAME` record, name `middle-school-golf-tracker`, target
`<github-org>.github.io`, **DNS only (grey cloud)** — not proxied. GitHub Pages issues and manages
its own TLS cert for the custom domain; Cloudflare's proxy in front of it commonly breaks GitHub's
domain verification/cert issuance.

## Cloudflare Worker deploy

`worker/wrangler.toml` + `worker/cloudflare-device-flow-relay.js`. This Worker has one npm
dependency (`jose`, for local Google ID-token verification) — run `npm install` inside `worker/`
once before the first deploy (or after a fresh clone); Quick Edit dashboard paste-in is no longer
viable once there's an import to bundle. Deploy with `wrangler deploy` from `worker/`. It gets its
own `*.workers.dev` URL — no custom domain/DNS record needed, since it's only ever called via
`fetch()` from the site's JS, never visited directly.

The Worker needs two secrets, **not** set in `wrangler.toml`:

```
wrangler secret put GITHUB_PAT
wrangler secret put GOOGLE_CLIENT_SECRET
```

`GITHUB_PAT` is a fine-grained personal access token scoped to just this one repo (`contents:
read/write`) — distinct from the GITHUB_TOKEN used one-time by `bootstrap-platform.sh` to configure
Pages. The Worker uses this PAT to make the actual commit once it's verified (via `teams.json`) that
the caller is authorized — see `docs/auth-and-publishing.md`. Fine-grained PATs expire after at most
a year; set a calendar reminder to rotate it. `GOOGLE_CLIENT_SECRET` is unrelated to that write
path — it's for the Google OAuth device-flow login itself; see `docs/auth-and-publishing.md` for how
to generate it.

`worker/wrangler.toml`'s `[vars]` section (`GITHUB_OWNER`, `GITHUB_REPO`, `GITHUB_BRANCH`) points
at this one shared repo — update it there if the repo is ever renamed or moved.

## Forking for a different domain entirely

If you want a genuinely separate deployment (different domain, different repo — not just another
team under this platform), repeat all of the above for the new domain/repo/zone. That's the "one
repo per site" model this platform deliberately moved away from for individual teams, but it's
still the right call for a truly independent fork.
