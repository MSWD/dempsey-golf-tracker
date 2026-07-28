# Dempsey Golf Tracker

A single-page web app for running the Delaware Dempsey Pacers middle-school golf team: roster,
practice/tryout scores, match-day scoring, per-player trend charts, and shareable rank reports.
Built to replace an Excel-based workflow.

No backend — everything lives in the browser via `localStorage`, with JSON export/import for
backup. Deploys as a static site on GitHub Pages at
[dempsey-golf-tracker.mswd.us](https://dempsey-golf-tracker.mswd.us).

## Tech stack

Plain HTML/CSS/JS, no build step, no framework. Chart.js via CDN for trend charts. A Cloudflare
Worker relays the GitHub device-flow auth calls that static Pages can't make directly (see
[`docs/auth-and-publishing.md`](docs/auth-and-publishing.md)).

## Running locally

No build step — just serve `src/` with any static file server, e.g.:

```
cd src
python3 -m http.server 8000
```

Then open `http://localhost:8000`. (Opening `index.html` directly via `file://` won't work — the
seed-data fetch requires an HTTP server.)

## Structure

- `src/` — the app itself (see [`docs/architecture.md`](docs/architecture.md) for the full layout)
- `worker/` — the Cloudflare Worker used for GitHub device-flow login
- `docs/` — architecture, deployment, and auth/publishing setup notes
- `prompts/` — the original project brief, seed data, and any maintenance-oriented prompts

## Docs

- [`docs/architecture.md`](docs/architecture.md) — data model, scoring rules, file layout
- [`docs/deployment.md`](docs/deployment.md) — GitHub Pages + custom domain + Cloudflare DNS setup
- [`docs/auth-and-publishing.md`](docs/auth-and-publishing.md) — GitHub App + Worker setup for admin login/report publishing
- [`docs/decisions.md`](docs/decisions.md) — why things are built the way they are

## Admin vs. viewer mode

The app defaults to read-only viewer mode. Logging in with a GitHub account that has write access
to this repo (via the "Login with GitHub" button) unlocks roster/round/match editing and report
publishing. See `docs/auth-and-publishing.md` for how that's wired up.

## Forking this for your own team

This app is built to be forked and re-branded. To stand up your own copy:

1. Edit `src/js/team-config.js` — team name, colors, GitHub repo target, custom domain.
2. Drop your own logo into `src/assets/branding/` and update the path in `team-config.js`.
3. Replace `prompts/seed_data.json` with your own roster and courses.
4. Register your own GitHub App + Cloudflare Worker + custom domain — see
   `docs/deployment.md` and `docs/auth-and-publishing.md`.

Scoring rules (double-par cap, rolling-average window, team-score formula) are intentionally not
part of that config — they're fixed competition rules, not a per-team preference.
