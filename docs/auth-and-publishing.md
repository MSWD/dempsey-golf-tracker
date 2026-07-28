# Admin auth (GitHub device flow) + report publishing

Any GitHub account can log in — no repo-collaborator invite needed. Whether that account is an
**admin** for the team it's currently viewing, or just a read-only **visitor**, is decided by
`src/teams.json` (slug → allowed GitHub usernames), checked via the Cloudflare Worker — never by
GitHub repo-collaborator status. That distinction matters here specifically because one shared
repo now serves every team: repo permissions are all-or-nothing at the repo level, too coarse to
mean "admin for team X." See `docs/decisions.md` for the reasoning.

## 1. Register the GitHub App (one-time, platform-wide)

Settings → Developer settings → GitHub Apps → New GitHub App, under whichever account/org can
install apps on `MSWD/dempsey-golf-tracker`.

- Name: anything unique
- Homepage URL: `https://middle-school-golf-tracker.mswd.us`
- Webhook: uncheck "Active"
- Repository permissions → **Contents: Read & write**
- Enable **Device Flow**
- Install the app on the `dempsey-golf-tracker` repo
- Note the **Client ID** (public, safe to embed) — goes into every team's `team-config.js` →
  `githubApp.clientId`

## 2. Deploy the Cloudflare Worker relay

See `docs/deployment.md` → "Cloudflare Worker deploy." Note its `*.workers.dev` URL and the
`GITHUB_PAT` secret it needs (a fine-grained PAT scoped to this repo, distinct from the GitHub
App above — the App handles *who's logging in*, the PAT is what the Worker uses to *make the
actual commit* once someone's verified as an admin).

## 3. Wire the config

Every team's `team-config.js` gets the same `githubApp.clientId` and `deviceFlowWorkerUrl` (one
App + one Worker serve every team). `scripts/add-team.py` fills these in automatically from the
constants at the top of that script — update those constants once here, not per team, if they
ever change.

## How login works

1. Coach clicks "Login with GitHub" on their team's page.
2. `github-auth.js` calls the Worker's `/device/code`, which relays to GitHub's
   `/login/device/code`. GitHub returns a short user code and a verification URL.
3. The app shows that code/URL; the coach opens it on any device, enters the code, approves.
4. `github-auth.js` polls the Worker's `/token` endpoint until GitHub issues an access token.
5. The token is stored in localStorage (shared across every team on this domain, since it
   identifies the account, not a team). `GitHubAuth.isAdmin()` then calls the Worker's `/whoami`
   with `{ teamSlug }` to check that account against `teams.json` for the team currently being
   viewed — re-checked live on every page load, not cached client-side.

## How publishing works

`github-publish.js` posts to the Worker's `/publish` with `{ teamSlug, path, content, message }`
and the caller's own token in `Authorization`. The Worker:

1. Resolves the caller's username via `GET /user` with their token (identification only).
2. Looks up `teamSlug` in `teams.json` (cached ~5 minutes — edits may take a few minutes to take
   effect, which is a deliberate tradeoff, not a bug).
3. Rejects if the username isn't in that team's `adminUsernames`, **or** if the requested `path`
   isn't under that team's own `src/teams/<slug>/` directory — the second check is defense in
   depth, so an authorized-for-team-A caller can't redirect a write into team B's files.
4. If authorized, commits using its own `GITHUB_PAT` — the caller's token is never used to make
   the write itself.

`reports/index.html`/`report-viewer.js` reads `reports/data/latest.json` and reconstructs
standings as of any past date dynamically — no per-publish snapshot files, no manifest.

## `teams.json` — who can edit it

Only the platform operator, directly via git. There is intentionally no in-app or Worker code path
that writes to `teams.json` — the Worker only ever reads it. Adding a team or changing its admins
means running `scripts/add-team.py` (for a new team) or hand-editing `src/teams.json` (for an
existing one), then committing.
