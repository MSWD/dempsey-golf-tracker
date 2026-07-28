# Design decisions

## Why localStorage + JSON export/import instead of a database

Single coach, single browser, no server budget. `localStorage` with an explicit Export/Import pair
means the season is never one cache-clear away from gone, without needing any backend at all.

## Why one always-current data file, not a dated snapshot per publish

Baking a full HTML page per published report would mean the report's math is frozen at publish
time and can drift from the live app's scoring logic. `reports/index.html` avoids that by fetching
JSON and running it through the same `scoring-engine.js` the live app uses. The next question was
whether that JSON should be a dated snapshot (`reports/data/2026-07-28.json` + a manifest) or a
single always-current file. Snapshots were the first design, but every round/match already carries
a date — so "week by week progress" doesn't need a separate published snapshot per week, it can be
reconstructed dynamically by filtering one full-history file to rounds on-or-before a chosen date
and re-running the same rank/rolling-average logic. That's strictly better: fewer things to
publish, and it still shows past weeks correctly even if a publish was missed one week, which
per-week snapshots couldn't do retroactively. `reports/data/latest.json` is now the only published
file, and `reports/report-viewer.js`'s "View as of" selector does the date-filtering client-side.

## Why GitHub device-flow login + a Cloudflare Worker relay, not a pasted PAT field

A pasted personal-access-token field would have been simpler to build (no Worker needed), but the
coach already has a Cloudflare account and wanted a real "Login with GitHub" button over a token
field. GitHub's device-flow endpoints don't send CORS headers for direct browser calls, so a small
stateless Worker relays those two requests. No secrets live in the Worker — GitHub Apps' device
flow doesn't require a client secret, only the public Client ID.

## Why admin/viewer mode is gated on live token validation, not just "a token exists"

A stale or revoked token sitting in localStorage should silently fall back to viewer mode, not
throw errors in the coach's face. `GitHubAuth.isAdmin()` re-checks `GET /user` plus a repo
push-permission check every time, rather than trusting a cached "logged in" flag.

## Why scoring rules aren't part of the white-label team-config

`team-config.js` holds team name/branding/repo-target/domain so other teams can fork this cleanly.
Scoring rules (double-par cap, rolling-average window, team-score formula, minimum valid holes) are
the coach's actual competition rules, not a per-team preference — the brief treats them as fixed.
A fork that needs different rules should change `scoring-engine.js` directly rather than get a
settings toggle that would over-engineer a single-user tool.

## Why `isStarter` was added to the match player-entry shape

The original brief's data model didn't have a field distinguishing the 6 official starters from
alternates. But matches sometimes get extra tee times for extra players who play and post a score
just to play — those scores should never count toward team score (rule 5) even though they're
recorded. `isStarter` (default true, toggle-able per player added to a match team) makes that
distinction explicit instead of inferring it from array position.

## Backlog / deliberately deferred

- **Tee box / yardage per tee set.** Middle-school golf typically plays forward tees (yellow/red).
  A next-level feature would let a Course have multiple named tee sets, each with its own
  per-hole yardage (pars stay the same regardless of tee). Not built yet — current `Course` model
  only has a single optional `holeYardages[9]`.
- **Exact minimum-holes-for-valid-round number.** Currently `5` in `scoring-engine.js`
  (`MIN_HOLES_FOR_VALID_ROUND`) — coach is confirming the OHSAA rule, may be `6`. Change that one
  constant once confirmed.
- **Tournament mode (Phase 3).** Up to ~20 teams, boys/girls flights, team + individual rankings,
  flight medalists. Explicitly deferred until the coach supplies exact rules — see
  `prompts/PROJECT_BRIEF.md`.
- **Scorecard photo scan (stretch).** Auto-fill a Course's hole pars/yardages/slope/rating by
  calling Claude's vision API from the browser, with the coach supplying his own API key stored
  only in localStorage. Not started.
