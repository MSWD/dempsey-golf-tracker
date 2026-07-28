# Design decisions

## Why GitHub Pages deploys via a GitHub Actions workflow, not the branch/path source setting

Discovered mid-setup: branch-based GitHub Pages only accepts a source path of `/` or `/docs` —
`/src` was never valid, and the bootstrap script's Pages API call was silently failing on it.
Three fixes were on the table: move the whole site to the repo root, move it to `/docs` (which
collides with this repo's markdown documentation folder of the same name), or deploy via a custom
GitHub Actions workflow (`build_type: "workflow"`), which uploads `src/` as the Pages artifact
directly and isn't subject to that path restriction at all. Went with the Actions workflow —
avoids restructuring every file path project-wide, and avoids the `/docs` naming collision. The
one real tradeoff: it's a "build step" of sorts (checkout + upload + deploy), a small departure
from the project's plain-static-site philosophy, but it runs entirely inside GitHub's
infrastructure with zero local tooling, so it doesn't compromise the "no build step to run
locally" property that actually mattered.

It also gave a natural home for a request that came up around the same time: cutting deploys on a
published GitHub Release rather than every push to `main`, matching the "bump `version.js` + tag a
release per feature" pattern from the coach's other app — see `.github/workflows/deploy-pages.yml`.

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

## Why admin/viewer mode is gated on a live check, not just "a token exists"

A stale or revoked token sitting in localStorage should silently fall back to viewer mode, not
throw errors in the coach's face. `GitHubAuth.isAdmin()` re-checks live every time, rather than
trusting a cached "logged in" flag. What it checks against changed with the move to path-based
hosting — see the next entry.

## Why path-based multi-team hosting instead of one repo/domain per team

The app was originally built around "fork the repo, each team gets its own custom domain" —
clean permission model (GitHub's own repo-collaborator list *is* the admin list), but it means
every new team needs its own DNS record, its own GitHub App, its own Pages setup. That's fine for
someone comfortable with that infrastructure, but the actual ask was to let a few other coaches
*try this out* without any technical setup of their own — the coach running this would host and
administer everything himself. Given that, per-team domains stopped being worth their setup cost:
GitHub Pages supports exactly one custom domain per repo/Pages site anyway, so "one repo, many
real vanity domains" was never on the table — the honest choice was between repo-per-team (real
domains, more setup per team) and path-based (one domain, `/teams/<slug>/`, zero incremental setup
per team). Path-based wins for "make it easy to try," at the cost of losing GitHub's repo
permissions as the admin boundary — which is why `teams.json` exists (see below). Onboarding a new
team is now purely `scripts/add-team.py` + a git commit; no GitHub Pages/DNS/Cloudflare changes.

## Why `teams.json` decides admin rights, not GitHub repo-collaborator status

Follows directly from the above: one shared repo means GitHub's repo-level permissions can't
scope "admin for team X" — a collaborator has push access to the whole repo, which would let one
team's admin (even by accident, not maliciously) edit another team's published data. `teams.json`
(slug → allowed usernames) is the app-level mapping that actually scopes this, enforced in the
Cloudflare Worker (the one place in the whole architecture that isn't just static/client-side, so
it's the only place a check like this can't be spoofed). A useful side effect: coaches no longer
need a GitHub repo invite at all — any GitHub account can log in, `teams.json` alone decides what
they can do. `teams.json` itself is only ever edited by the platform operator directly via git;
no code path in the app or Worker writes to it, only reads it.

## Why the Worker holds a secret now, when it didn't before

The device-flow relay never needed secrets — GitHub Apps' device flow doesn't require a client
secret. Publishing does need a write credential, though, and once the model became "any GitHub
account, checked against `teams.json`," the caller's *own* token can no longer be the one used to
write — someone authorized only for team A has a real GitHub token, but it shouldn't be trusted to
write team B's files, and more fundamentally many teams.json-listed admins won't be repo
collaborators at all, so their own token wouldn't have write access to begin with. The Worker
therefore holds one fine-grained PAT (scoped to just this repo) as a Cloudflare secret, and uses
it to make the actual commit only after checking the caller against `teams.json` — the caller's
token is used solely to identify who they are (`GET /user`), never to perform the write.

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

## Why player names are abbreviated to first name + last initial before anything public

Making the repo public (required for GitHub Pages on this org's free plan — see the private-repo
note in `docs/deployment.md`) means `seed_data.json` and published `reports/data/latest.json` are
both world-readable, and the roster is real middle-schoolers. `abbreviatedLastName`/
`publicDisplayName` (in `models.js`) reduce a last name to its initial, extending only far enough
to disambiguate two players who share both a first name and that initial — coaches still enter and
see full names in their own browser (roster data in `localStorage` never leaves the device unless
exported or published), but `github-publish.js` rewrites both the roster list and each match
entry's `displayName` through this helper before sending anything to the Worker. Seed data
(`src/teams/dempsey/seed_data.json`, `prompts/seed_data.json`) was scrubbed the same way, and its
player `id` fields — originally the player's full name lowercased, e.g. `grahambaker` — were
replaced with opaque `player_<random>` ids matching what `models.js`'s `makeId` generates at
runtime, since the id string itself was an unabbreviated-name leak independent of the `lastName`
field.

One gap that's a coach responsibility, not a code fix: match entries for a player with no roster
`playerId` (an opposing-team or extra player) store whatever free-text `displayName` the coach
typed, and that's published as-is — the Help page now tells coaches to abbreviate those by hand.

This only fixes file *contents* going forward. The original full-name seed data was already
committed and pushed to `origin/main` (commits `8802b3b`, `2633da0`) before this fix — those commits
remain in public git history once the repo goes public. Rewriting history to remove them is
possible but disruptive (force-push, every clone gets invalidated); left as a decision for the
coach rather than done unilaterally.

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
- **Safari/iPad testing.** Layout has been checked against iPad Air (landscape horizontal-scroll
  fix applied) and Pixel 10 (portrait/landscape) in Chrome. Safari itself hasn't been tested yet —
  coach is fine running Chrome on iPad for now, but wants to verify Safari behavior in a later
  iteration.
