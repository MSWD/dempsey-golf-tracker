# Admin auth (Google device flow) + report publishing

Any Google account can log in — no directory access, no Workspace admin coordination, nothing
beyond a normal Google sign-in. Whether that account is an **admin** for the team it's currently
viewing, or just a read-only **visitor**, is decided by `src/teams.json` (slug → allowed Google
account emails), checked via the Cloudflare Worker — never by any Google-side group/directory
membership. That distinction matters here specifically because one shared repo now serves every
team: no single identity provider's own permission model can scope "admin for team X." See
`docs/decisions.md` for the reasoning, including why Google replaced GitHub as the login provider
(issue #26).

## 1. Register the Google OAuth Client (one-time, platform-wide)

[Google Cloud Console](https://console.cloud.google.com/) → create or select a project (this
platform uses a dedicated one, "School Golf Tracker") →

- **OAuth consent screen**: User type **External**. App name/support email/developer contact —
  anything reachable by the platform operator. Scopes: **`openid`, `email`, `profile`** only — all
  three are Google's "non-sensitive" category, no justification or extra review required. Don't add
  anything beyond that (no Drive/Calendar/etc. — this app only ever needs identity, never access to
  a coach's actual Google data). Publishing status: **Testing** — caps logins at 100 explicitly-added
  test users and shows an "unverified app" warning on the consent screen, but skips Google's full
  app-verification review entirely. That review process is built for public consumer apps; for a
  small, operator-administered admin list, Testing mode is the right fit (see `docs/decisions.md`).
  Add every coach who'll actually log in as admin as a **test user** here — this is required just to
  let them past the consent screen, independent of whether their email is also in `adminEmails`.
- **Credentials → Create Credentials → OAuth client ID**: application type **"TVs and Limited Input
  devices"** — this is Google's name for the same category of flow GitHub's device flow used to be
  (OAuth 2.0 Device Authorization Grant, RFC 8628). Name it, create it.
- Note the **Client ID** (public, safe to embed) — goes into every team's `team-config.js` →
  `googleAuth.clientId`, **and** into the Worker's `GOOGLE_CLIENT_ID` var (see below) — the Worker
  pins device-flow logins to this one OAuth Client and rejects any other `client_id`, so this relay
  can't be used as a free CORS bridge for a login flow that isn't ours.
- Note the **Client Secret** — unlike the Client ID, this is never embedded client-side; it goes
  only into the Worker's `GOOGLE_CLIENT_SECRET` secret (see below). Unlike GitHub's App, Google
  requires this secret on *every* token-poll call to `/token`, not just the refresh grant.

## 2. Deploy the Cloudflare Worker relay

See `docs/deployment.md` → "Cloudflare Worker deploy." Note its `*.workers.dev` URL and the
`GITHUB_PAT` secret it needs (a fine-grained PAT scoped to this repo — unrelated to login, this is
the credential the Worker uses to *make the actual commit* once someone's verified as an admin via
Google; that write path didn't change).

This Worker now has one npm dependency (`jose`, for local Google ID-token verification) — run
`npm install` inside `worker/` once before deploying; Quick Edit dashboard paste-in is no longer
viable once there's an import to bundle.

The Worker also needs `GOOGLE_CLIENT_SECRET` (`wrangler secret put GOOGLE_CLIENT_SECRET`, value
from step 1 above) — needed for every `/token` call (both the initial device-code exchange and
refresh), unlike GitHub's App which only needed a secret for refresh. Revoking a token on logout
needs no secret at all with Google — simpler than GitHub's Basic-auth revoke call.

`GOOGLE_CLIENT_ID` (the same Client ID from step 1) goes in `wrangler.toml`'s `[vars]` — it's
public, not a secret, but it's what `/device/code` and `/token` check every request's `client_id`
against.

## 3. Wire the config

Every team's `team-config.js` gets the same `googleAuth.clientId` and `deviceFlowWorkerUrl` (one
OAuth Client + one Worker serve every team). `scripts/add-team.py` fills these in automatically from
the constants at the top of that script — update those constants once here, not per team, if they
ever change.

## How login works

1. Coach clicks "Login with Google" on their team's page.
2. `google-auth.js` calls the Worker's `/device/code`, which relays to Google's
   `/device/code` with `scope=openid email profile` (hardcoded server-side — the client never
   dictates scope). Google returns a short user code and a verification URL.
3. The app shows that code/URL; the coach opens it on any device, enters the code, approves.
4. `google-auth.js` polls the Worker's `/token` endpoint until Google issues an access token, a
   refresh token, and an **ID token** — a signed JWT containing the coach's verified email, which is
   the actual credential used for admin checks (see below), not the OAuth access token.
5. The full session (access token, ID token, expiry, refresh token) is stored together in
   localStorage (shared across every team on this domain, since it identifies the account, not a
   team — see `docs/decisions.md`). `GoogleAuth.isAdmin()` sends the ID token to the Worker's
   `/whoami` with `{ teamSlug }`; the Worker verifies the token's signature locally (against
   Google's public keys, no outbound identity API call needed) and checks the verified email
   against `teams.json` for the team currently being viewed — re-checked live on every page load,
   not cached client-side.

## Token expiry + refresh

Google's issued access/ID tokens last about an hour — much shorter than GitHub App tokens' old 8h.
`GoogleAuth.ensureValidSession()` checks the stored expiry before every admin check or publish call;
if the access token is expired but the refresh token is still live, it silently exchanges it via the
Worker's `/token` (`grant_type=refresh_token`, requiring `GOOGLE_CLIENT_SECRET` server-side same as
the initial exchange). If refresh isn't possible (no refresh token, or it's also expired), the
session is cleared and `GoogleAuth.sessionExpired` is set so the UI can show "your session expired —
please log in again" instead of the generic "not an admin" state those two would otherwise look
identical to.

Google doesn't document a fixed refresh-token expiry the way GitHub's App did — instead a refresh
token is invalidated by roughly 6 months of non-use (a successful refresh resets that clock), a cap
of 100 live refresh tokens per (Google account, OAuth Client) with the oldest silently invalidated
past that, or explicit revocation. Separately, while the OAuth consent screen stays in **Testing**
mode, Google's own test-user grants may be subject to their own shorter re-consent window — worth
confirming directly in Cloud Console if this ever becomes noticeable in practice; even if so, it's a
quick re-click through the account picker, not a real support burden at this app's scale.

## How logout works

Clicking "Logout" clears the local session immediately, then best-effort calls the Worker's
`/revoke` to revoke that specific access token server-side. Google's revoke
(`POST https://oauth2.googleapis.com/revoke`, form-encoded `token=...`) needs no client secret and
no Basic auth — simpler than GitHub's revoke call. The revoke call is fire-and-forget from the
user's perspective: a slow or failed network call never blocks or fails the logout, since the local
session is already gone by the time it's attempted.

## How publishing works

`github-publish.js` posts to the Worker's `/publish` with `{ teamSlug, path, content, message }` and
the caller's own **ID token** in `Authorization`. The Worker:

1. Verifies the caller's Google ID token locally (JWKS signature check + issuer/audience/expiry) to
   resolve their verified email (identification only).
2. Looks up `teamSlug` in `teams.json` (cached ~5 minutes — edits may take a few minutes to take
   effect, which is a deliberate tradeoff, not a bug).
3. Rejects if the email isn't in that team's `adminEmails`, **or** if the requested `path` isn't
   under that team's own `src/teams/<slug>/` directory — the second check is defense in depth, so an
   authorized-for-team-A caller can't redirect a write into team B's files.
4. If authorized, commits using its own `GITHUB_PAT` — the caller's credential is never used to make
   the write itself. This part is entirely unchanged by the Google swap: published reports still
   live in this GitHub repo regardless of which identity provider gated who could trigger the write.

`reports/index.html`/`report-viewer.js` reads `reports/data/latest.json` and reconstructs standings
as of any past date dynamically — no per-publish snapshot files, no manifest.
`reports/match.html`/`match-viewer.js` reads that same file client-side to render one match by id
(see `docs/architecture.md`'s "Sharing a single match") — there's no separate publish step or
per-match file for it.

## `teams.json` — who can edit it

Only the platform operator, directly via git. There is intentionally no in-app or Worker code path
that writes to `teams.json` — the Worker only ever reads it. Adding a team or changing its admins
means running `scripts/add-team.py` (for a new team) or hand-editing `src/teams.json` (for an
existing one), then committing.

`adminEmails` matching is case-insensitive (a differently-cased entry shouldn't silently lock a
coach out). Unlike a GitHub username, an email address doesn't become "squattable" if an admin
leaves — nobody else can register their exact address. The rough equivalent gotcha here is a
**deprovisioned or deleted Google Workspace account**: if a coach's school-issued Google account is
deactivated (they leave the district, the district changes email systems, etc.), `teams.json` should
be updated to their replacement email in the same change — but unlike the old GitHub-handle case,
the failure mode here is fail-*safe*: a deactivated account simply can't complete Google's login at
all anymore, it doesn't silently become available for someone else to claim and inherit admin
rights.
