# Middle School Golf Tracker

A multi-team web app for running a middle-school golf team: roster, practice/tryout scores,
match-day scoring, per-player trend charts, and shareable rank reports. Built to replace an
Excel-based workflow — Delaware Dempsey Pacers Golf is the first team on it.

No backend — everything lives in the browser via `localStorage`, with JSON export/import for
backup. Deploys as a static site on GitHub Pages at
[middle-school-golf-tracker.mswd.us](https://middle-school-golf-tracker.mswd.us). Multiple teams
share this one domain, each at its own path (`/teams/<slug>/`) — see
[`docs/architecture.md`](docs/architecture.md) for why.

## Tech stack

Plain HTML/CSS/JS, no build step, no framework. Chart.js via CDN for trend charts. A Cloudflare
Worker relays GitHub device-flow login and gatekeeps report publishing per team (see
[`docs/auth-and-publishing.md`](docs/auth-and-publishing.md)).

## Running locally

No build step — just serve `src/` with any static file server, e.g.:

```
cd src
python3 -m http.server 8000
```

Then open `http://localhost:8000` for the team directory, or
`http://localhost:8000/teams/dempsey/index.html` directly. (Opening files via `file://` won't
work — the seed-data fetch requires an HTTP server.)

## Structure

- `src/` — the app itself: `teams.json` + `teams/<slug>/` per team, shared `js/`/`css`/`assets/`
  (see [`docs/architecture.md`](docs/architecture.md) for the full layout)
- `worker/` — the Cloudflare Worker used for GitHub device-flow login and publish gatekeeping
- `scripts/` — `add-team.py` (onboard a new team) and `bootstrap-platform.sh` (one-time platform setup)
- `docs/` — architecture, deployment, and auth/publishing setup notes
- `prompts/` — the original project brief and any maintenance-oriented prompts

## Docs

- [`docs/coach-guide.md`](docs/coach-guide.md) — for coaches: requesting a new team, and a full
  guide to using the app
- [`docs/architecture.md`](docs/architecture.md) — data model, scoring rules, multi-team file layout
- [`docs/deployment.md`](docs/deployment.md) — GitHub Pages + custom domain + Cloudflare DNS setup
- [`docs/auth-and-publishing.md`](docs/auth-and-publishing.md) — GitHub App + Worker setup, `teams.json` model
- [`docs/decisions.md`](docs/decisions.md) — why things are built the way they are

## Admin vs. viewer mode

The app defaults to read-only viewer mode. Any GitHub account can log in — whether that unlocks
admin rights (roster/round/match editing, report publishing) for the team being viewed depends on
`src/teams.json`, not on GitHub repo access. See `docs/auth-and-publishing.md`.

## Requesting a new team

See [`docs/coach-guide.md`](docs/coach-guide.md) — how to get a team added to the platform (no
cost or technical setup required), plus a full guide to using the app once you have one.

## Adding a new team (fulfilling a request)

Run `scripts/add-team.py` — it scaffolds `src/teams/<slug>/` and adds an entry to
`src/teams.json`. Review what it generated, then commit and push yourself; the script doesn't run
git for you. No DNS, GitHub App, or Cloudflare setup needed per team — that's all one-time platform
setup (`scripts/bootstrap-platform.sh`, `docs/deployment.md`).
