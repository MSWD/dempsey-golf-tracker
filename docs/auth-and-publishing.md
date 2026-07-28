# Admin auth (GitHub device flow) + report publishing setup

Admin mode = holding a token with write access to this repo, stored in the browser's localStorage.
No token, an unconfigured GitHub App, or a token that fails a live permission check all fall back
to the safe default: read-only viewer mode. See `src/js/github-auth.js`.

## 1. Register the GitHub App

Settings → Developer settings → GitHub Apps → New GitHub App (personal account or an org you
admin both work — for the `MSWD/dempsey-golf-tracker` repo, register it under whichever account
can install apps on that repo).

- Name: anything unique (e.g. "Dempsey Golf Tracker Admin")
- Homepage URL: the Pages URL (`https://dempsey-golf-tracker.mswd.us`)
- Webhook: uncheck "Active" — not needed
- Repository permissions → **Contents: Read & write**
- Under "General" → check **Enable Device Flow**
- Create the app, then note the **Client ID** (public, safe to embed in client-side JS — device
  flow doesn't require a client secret)
- Install the app on the `dempsey-golf-tracker` repo only

## 2. Deploy the Cloudflare Worker relay

See `docs/deployment.md` → "Cloudflare Worker" section. Deploy `worker/cloudflare-device-flow-relay.js`
and note its `*.workers.dev` URL.

## 3. Wire the config

In `src/js/team-config.js`, set:

```js
githubApp: {
  clientId: '<the Client ID from step 1>',
  deviceFlowWorkerUrl: '<the Worker URL from step 2>',
},
```

Until both are set (they ship as `REPLACE_...` placeholders), `GitHubAuth.isConfigured()` returns
false and the login button shows a message pointing back at this doc instead of erroring.

## How the flow works

1. Coach clicks "Login with GitHub".
2. `github-auth.js` calls the Worker's `/device/code` endpoint, which relays to GitHub's
   `/login/device/code`. GitHub returns a short user code and a verification URL.
3. The app shows that code/URL; the coach opens the URL on any device, enters the code, approves.
4. `github-auth.js` polls the Worker's `/token` endpoint until GitHub issues an access token.
5. The token is validated against `GET /user` + a repo-permissions check (`push: true`), then
   stored in localStorage. Admin mode unlocks.

## Report publishing

Admin-only "Publish report" button (`src/js/github-publish.js`) commits the full current
players/courses/rounds/matches dataset to a single always-current `reports/data/latest.json`,
via the GitHub Contents API using the stored token. There's no per-publish snapshot file and no
manifest — every round/match already carries a date, so `reports/report-viewer.js` reconstructs
"standings as of any past date" dynamically from the full history, using the same
`scoring-engine.js` the live app uses. Publishing just needs to happen often enough to stay current
(e.g. after each match) — it's not a per-week ritual, since past weeks are still browsable from a
single up-to-date publish.

No token/Worker set up yet? There's currently no manual-download fallback wired into the UI — the
Publish button will show an error pointing back at this doc. If you want to publish before setting
up the GitHub App, use the Export button and hand-commit the JSON as `reports/data/latest.json`.
