# Architecture

## Multi-team, path-based hosting

One repo, one custom domain (`middle-school-golf-tracker.mswd.us`), one GitHub Pages deployment,
one Cloudflare Worker — every team lives at its own path (`/teams/<slug>/`) rather than its own
domain. This was a deliberate choice over "one repo per team, each with its own vanity domain":
GitHub Pages supports exactly one custom domain per repo/Pages site, so real per-team domains would
mean real per-team DNS/GitHub-App setup work, which defeats the goal of letting other coaches try
this with zero technical setup of their own. See `docs/decisions.md` for the full reasoning.

Admin rights are decided by `src/teams.json` (slug → allowed GitHub usernames) — **not** by GitHub
repo-collaborator status, which is too coarse once one repo serves many teams' data. Any GitHub
account can complete the device-flow login; whether they're an admin for the team they're viewing
or just a read-only visitor is checked against `teams.json` via the Cloudflare Worker's `/whoami`
and `/publish` endpoints. `teams.json` is only ever edited directly by the platform operator via a
normal git commit — no code path in the app writes to it.

## File layout

```
.github/workflows/
  deploy-pages.yml            # Actions-based Pages deploy (see below), triggered on a Release
src/
  index.html                 # root landing page: lists active teams from teams.json
  teams.json                 # slug -> { name, adminUsernames: [...] } — operator-edited only
  version.js                 # APP_VERSION constant, bumped per release/tag
  CNAME                      # "middle-school-golf-tracker.mswd.us"
  teams/
    dempsey/
      index.html              # thin entry point; team-config.js is co-located
      team-config.js           # this team's branding (logoPath optional)
      seed_data.json           # this team's starter roster/courses (new teams start empty)
      reports/
        index.html
        report-viewer.js
        data/latest.json       # single always-current published dataset
  css/, js/, assets/           # shared across every team
worker/
  cloudflare-device-flow-relay.js   # device-flow relay + /whoami + /publish (teams.json gatekeeping)
  wrangler.toml
scripts/
  add-team.py                  # scaffolds a new src/teams/<slug>/ + teams.json entry
  bootstrap-platform.sh         # one-time: Cloudflare DNS/Worker + GitHub Pages config
```

GitHub Pages' branch-based source only allows a path of `/` or `/docs` (and `/docs` is already
this repo's markdown docs folder), so the site deploys via `.github/workflows/deploy-pages.yml`
instead — it uploads `src/` as the Pages artifact directly, sidestepping that restriction. It
triggers on a published GitHub Release rather than every push, matching the "bump `version.js` +
cut a release" pattern — see `docs/deployment.md`.

`scoring-engine.js` is the single source of truth for all scoring math — pure functions, no
localStorage, no DOM — so both the live app and `report-viewer.js` run the exact same logic
against different data sources (live localStorage vs. a fetched snapshot JSON).

`localStorage` is namespaced per team: `STORAGE_KEY = mstgt:data:${TEAM_CONFIG.teamSlug}` in
`data-store.js`. This matters because browsers scope storage by *origin*, not path — without the
namespace, two teams sharing this one domain would collide on the same key in the same browser.
The GitHub auth token (`mstgt:github-token`) is deliberately **not** namespaced the same way — one
login covers every team an account happens to administer, since a token identifies the account,
not a team.

## Data model

```
Player  { id, firstName, lastName, grade, active }
Course  { id, name, holePars[9|18], totalPar, verified, defaultTeeSetId?,
          teeSets: [{ id, name, holeYardages[9|18], holeParsOverride[9|18]?, slope?, rating? }] }
Round   { id, playerId, date, type: 'tryout'|'practice'|'match', courseId|inlineHolePars, teeSetId?,
          side?: 'front'|'back', holeScores[9], putts, matchId? }
Match   { id, date, location: 'Home'|'Away', courseId|inlineHolePars, teeSetId?,
          side?: 'front'|'back', teams: [{ id, name, isOwnTeam,
                                           players: [{ playerId?, displayName, holeScores[9],
                                                       putts, isStarter }] }] }
```

`isStarter` on a match team's player entry distinguishes the 6 official starters from
alternates/extra players who tee off and post a score just to play, but never count toward team
score (rule below).

Courses may store either a 9-hole card or a full 18-hole card. Rounds and matches are still
9-hole scoring records; for an 18-hole course, `side` selects whether holes 1-9 (`front`) or
10-18 (`back`) supply the pars and tee yardages. Existing data without `side` remains valid and
defaults to the current 9-hole/front behavior.

## Scoring rules (fixed, not per-team configurable — see decisions.md)

- **Adjusted score** = `rawScore + (36 - roundTotalPar)`. Normalizes any 9-hole par card to a
  par-36 baseline. Rolling average and rank always use adjusted scores, never raw.
- **Double-par cap**: a hole score can never exceed 2x that hole's par. Capped at entry time; the
  UI warns when this happens.
- **Minimum holes for a valid round**: a round/match score needs at least `MIN_HOLES_FOR_VALID_ROUND`
  holes actually completed (currently `5`, in `scoring-engine.js`) to count toward rolling average
  or team score at all.
- **Rolling average** = best 4 of the player's last 6 valid rounds (chronologically; tryouts count
  as the earliest entries), using adjusted scores. Fewer than 6 → average whatever exists.
- **Rank** = ascending sort on rolling average. Reference/suggestion only — the coach always
  manually sets the full lineup order.
- **Team score** = sum of the 4 lowest raw scores among the 6 starters (not alternates) who posted
  a valid score that day. Fewer than 4 → explicitly "incomplete."
- **18-hole events** are two independent 9-hole Match records, one with `side: 'front'` and one
  with `side: 'back'`.

## Report publishing

There's one always-current file per team (`reports/data/latest.json`), not a snapshot per publish.
Every round/match already carries a date, so `report-viewer.js` reconstructs "standings as of any
past date" dynamically from the full history using the same `scoring-engine.js` the live app uses,
via a "View as of" date selector — see `docs/decisions.md` for why this replaced the earlier
dated-snapshot-per-publish design.

## Onboarding a new team

Run `scripts/add-team.py` locally (prompts for slug/name/admin usernames, scaffolds the team
folder, appends to `teams.json`), review what it generated, then commit and push yourself — the
script never runs git for you. No GitHub Pages, DNS, or Cloudflare changes are needed per team;
all of that is one-time platform setup (`scripts/bootstrap-platform.sh`,
`docs/deployment.md`/`docs/auth-and-publishing.md`).
