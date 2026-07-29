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
- Under **Optional features**, "User-to-server token expiration" — currently **on** for this app
  (access tokens expire after 8h; GitHub issues a refresh token alongside them). `github-auth.js`
  handles this transparently (see "Token expiry + refresh" below); if it's ever opted back out,
  nothing needs to change — tokens are then treated as non-expiring, same as before this was added.
- Install the app on the `dempsey-golf-tracker` repo
- Note the **Client ID** (public, safe to embed) — goes into every team's `team-config.js` →
  `githubApp.clientId`, **and** into the Worker's `GITHUB_CLIENT_ID` var (see below) — the Worker
  pins device-flow logins to this one App and rejects any other `client_id`, so this relay can't
  be used as a free CORS bridge for a login flow that isn't ours
- Generate a **client secret** (General → "Generate a new client secret") — unlike the Client ID,
  this is never embedded client-side; it goes only into the Worker's `GITHUB_APP_CLIENT_SECRET`
  secret (see below)

## 2. Deploy the Cloudflare Worker relay

See `docs/deployment.md` → "Cloudflare Worker deploy." Note its `*.workers.dev` URL and the
`GITHUB_PAT` secret it needs (a fine-grained PAT scoped to this repo, distinct from the GitHub
App above — the App handles *who's logging in*, the PAT is what the Worker uses to *make the
actual commit* once someone's verified as an admin).

The Worker also needs `GITHUB_APP_CLIENT_SECRET` (`wrangler secret put GITHUB_APP_CLIENT_SECRET`,
value from step 1 above) — used only for refreshing an access token and for revoking a token on
logout, both server-side; never sent to or readable by the browser.

`GITHUB_CLIENT_ID` (the same Client ID from step 1) goes in `wrangler.toml`'s `[vars]` — it's
public, not a secret, but it's what `/device/code` and `/token` check every request's `client_id`
against.

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
5. The access token, its expiry, and the refresh token (plus its own expiry) are stored together
   in localStorage (shared across every team on this domain, since it identifies the account, not
   a team — see `docs/decisions.md`). `GitHubAuth.isAdmin()` then calls the Worker's `/whoami`
   with `{ teamSlug }` to check that account against `teams.json` for the team currently being
   viewed — re-checked live on every page load, not cached client-side.

## Token expiry + refresh

The GitHub App's "User-to-server token expiration" is on (see step 1), so access tokens expire
after 8h. `GitHubAuth.ensureValidSession()` checks the stored expiry before every admin check or
publish call; if the access token is expired but the refresh token is still live, it silently
exchanges it via the Worker's `/token` (`grant_type=refresh_token`, which — unlike the initial
device-code exchange — needs `GITHUB_APP_CLIENT_SECRET` server-side). If refresh isn't possible
(no refresh token, or it's also expired), the session is cleared and `GitHubAuth.sessionExpired` is
set so the UI can show "your session expired — please log in again" instead of the generic
"not an admin" state those two would otherwise look identical to.

## How logout works

Clicking "Logout" clears the local session immediately, then best-effort calls the Worker's
`/revoke` to revoke that specific access token server-side (`DELETE
/applications/{client_id}/token` — revoking only this token, not the coach's entire app
authorization). The revoke call is fire-and-forget from the user's perspective: a slow or failed
network call never blocks or fails the logout, since the local session is already gone by the
time it's attempted.

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

`adminUsernames` matching is case-insensitive (a differently-cased handle shouldn't silently lock
a coach out), but it's still matched by **username**, not by GitHub's permanent numeric user ID.
That means if an admin ever renames their GitHub handle, `teams.json` still has the *old* handle
— and the old handle becomes available for anyone else to register on GitHub, who would then pass
this app's admin check for whichever team(s) still list it. **If you (or any other admin) rename
your GitHub username, update `teams.json` to the new handle in the same change** — don't treat the
rename as a GitHub-only settings change. This is a deliberately accepted, low-likelihood risk for
a single-operator setup like this one (see `docs/decisions.md`) rather than something the code
enforces — the durable fix would be matching on the numeric GitHub user ID instead, which isn't
implemented here.
