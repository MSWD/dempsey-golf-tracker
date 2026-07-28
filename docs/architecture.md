# Architecture

## File layout

```
src/
  index.html              # main app shell (roster / courses / rounds / rank / charts / matches)
  reports/
    index.html            # standalone report viewer (reads the published data file)
    report-viewer.js
    data/latest.json      # single always-current published dataset (full rounds/matches history)
  css/styles.css
  js/
    team-config.js        # team name, logo, colors, GitHub repo target, custom domain
    data-store.js          # localStorage read/write, seed-load-on-first-run, export/import
    scoring-engine.js       # adjusted score, double-par cap, rolling avg, rank, team score
    models.js               # constructors for Player/Course/Round/Match
    ui-roster.js / ui-courses.js / ui-rounds.js / ui-matches.js / ui-charts.js
    github-auth.js           # device-flow login, admin/viewer gating
    github-publish.js        # Contents API calls to commit report snapshots
    app.js                   # bootstrap, nav, auth wiring
  assets/
    icons.svg                # <symbol id="icon-golf-green"> golf icon, reused via <use>
    favicon.svg               # standalone copy of the same icon for the browser tab
    branding/delaware-pacers-golf-logo.png
  data/seed_data.json      # runtime copy of prompts/seed_data.json (Pages needs it under src/)
  CNAME                     # "dempsey-golf-tracker.mswd.us"
worker/
  cloudflare-device-flow-relay.js
```

`scoring-engine.js` is the single source of truth for all scoring math. It's pure functions only —
no localStorage, no DOM — so both the live app and `reports/report-viewer.js` run the exact same
logic against different data sources (live localStorage vs. a fetched snapshot JSON). A published
report can never drift from the app's own math.

## Data model

```
Player  { id, firstName, lastName, grade, active }
Course  { id, name, holePars[9], holeYardages[9]?, slope?, rating?, totalPar, verified }
Round   { id, playerId, date, type: 'tryout'|'practice'|'match', courseId|inlineHolePars,
          holeScores[9], putts, matchId? }
Match   { id, date, location, courseId|inlineHolePars,
          teams: [{ id, name, isOwnTeam, players: [{ playerId?, displayName, holeScores[9],
                                                       putts, isStarter }] }] }
```

`isStarter` on a match team's player entry is an extension beyond the original brief's model — it
distinguishes the 6 official starters from alternates/extra players who tee off and post a score
just to play, but never count toward team score (see rule 5 below).

## Scoring rules (fixed, not configurable — see decisions.md)

- **Adjusted score** = `rawScore + (36 - roundTotalPar)`. Normalizes any 9-hole par card to a
  par-36 baseline. Rolling average and rank always use adjusted scores, never raw.
- **Double-par cap**: a hole score can never exceed 2x that hole's par. Capped at entry time; the
  UI warns when this happens. This is the only score cap — there's no whole-round default/filler
  score for a player with no holes entered (that player simply has no score for that round).
- **Minimum holes for a valid round**: a round/match score needs at least `MIN_HOLES_FOR_VALID_ROUND`
  holes actually completed (currently `5`, in `scoring-engine.js` — coach is confirming the exact
  OHSAA number, may become 6) to count toward rolling average or team score at all. Distinct from
  the double-par cap, which caps one hole's value without invalidating the round.
- **Rolling average** = best 4 of the player's last 6 valid rounds (chronologically; tryouts count
  as the earliest entries), using adjusted scores. Fewer than 6 → average whatever exists, no drops.
- **Rank** = ascending sort on rolling average. Reference/suggestion only — the coach always
  manually sets the full lineup order; rank is never auto-applied.
- **Team score** = sum of the 4 lowest raw scores among the 6 starters (not alternates) who posted
  a valid score that day. Fewer than 4 valid starter scores → explicitly "incomplete", never a
  padded/partial number.
- **18-hole events** are recorded as two independent 9-hole Match records (front nine, back nine),
  each scored under the same rules — no special-cased 18-hole path.
