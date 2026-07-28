# Dempsey Boys Golf Tracker — Project Brief

## What this is
A single-page web app that replaces/extends an Excel-based system for running a middle-school
boys golf team: roster, practice/tryout scores, match-day scoring, and (eventually) a season-ending
multi-team tournament, plus player trend charts. No backend — everything lives in the browser via
`localStorage`, with JSON export/import for backup. Deploys as a static site (GitHub Pages).

## Tech stack
- Plain HTML/CSS/JS, no build step required (match whatever tooling pattern the coach's existing
  golf-card-game repo uses, if he shares it — otherwise default to this).
- Chart.js via CDN for trend charts.
- `localStorage` for persistence; an explicit "Export data" / "Import data" (JSON file) pair so the
  season isn't one browser-cache-clear away from gone.
- Deployment target: GitHub Pages.

## Core domain rules (implement these exactly — they come from the coach's real spreadsheets)

1. **Normalization.** Every round has its own hole-by-hole par card (executive/short courses are
   common). `adjusted_score = raw_score + (36 − round_total_par)`. Rolling average and rank are
   always computed on adjusted scores, never raw.

2. **Double-par pickup** (this is stroke play, not match play): a recorded hole score can never
   exceed 2× that hole's par (par 5 → max 10, par 4 → max 8, par 3 → max 6). Enforce/warn on entry.
   This is the only "cap" rule — there is no separate whole-round default score.

   Note: the coach's old spreadsheet gave a player with zero holes entered a fake round score of
   `2 × round_total_par`. That was purely a formula workaround so `SMALL()` could still pick a
   team's top 4 scores without erroring on a blank cell — it was never a real scoring rule and
   should **not** be carried into the app. A player with no holes recorded for a given round simply
   has no score for that round; team-score selection (rule 5 below) should pick the best 4 among
   whichever starters actually posted a score, not pad missing players with a placeholder.

3. **Rolling average** = best 4 of the player's **last 6** rounds, chronologically, using adjusted
   scores. Tryout scores count as the first two entries in that chronological window. If a player
   has fewer than 6 rounds recorded, average whatever they have (no drops yet).

4. **Rank** = ascending sort on rolling average (lower is better). Top 3 by rank always play
   matches. The coach **manually sets the full lineup order** for every match — rank is a
   reference/suggestion only, never auto-applied.

5. **Team score (match)** = sum of the **4 lowest** scores among the 6 starters who actually
   completed and posted a score that day (raw scores, not normalized — the actual competition
   score is what counts here). If fewer than 4 of the 6 starters have a score, the team score is
   incomplete — surface that in the UI rather than silently computing a number from fewer players.

6. **Matches** can have **2 or 3 team blocks on one card** (tri-matches are common in the regular
   season; tournaments are separate, see below). Each team: 6 starters + a handful of alternates.
   Entry is hole-by-hole (9 holes); derive Score, Putts, front-3/mid-3/back-3 splits, To Par, and
   Team Score per team automatically.

7. **18-hole events** are recorded as two separate 9-hole "matches" (front 9, back 9), each scored
   independently under the same rules above.

8. **Tournaments**: up to ~20 teams, separate boys (18 holes) and girls (9 holes) flights, team
   rankings, individual rankings, and flight medalists. Coach will supply the exact rules later —
   design the schema to be extensible rather than guessing further detail now.

## Data model (starting point — adjust as needed)
```
Player    { id, firstName, lastName, grade, active }
Course    { id, name, holePars[9], holeYardages[9]?, slope?, rating?, totalPar (derived) }
Round     { id, playerId, date, type: 'tryout' | 'practice' | 'match',
            courseId | inlineHolePars, holeScores[9], putts, matchId? }
Match     { id, date, location, courseId | inlineHolePars,
            teams: [{ id, name, isOwnTeam, players: [{ playerId?, displayName, holeScores[9], putts }] }] }
Tournament { id, name, date, flights: [{ name: 'boys'|'girls', holes: 18|9, teams: [...], individualResults: [...] }] }
```

## Feature phases
Build Phase 1 and Phase 2 together in one continuous session — they share the same data model and
scoring engine, so splitting them adds overhead without real isolation benefit.

- **Phase 1**: Roster CRUD, round logging (practice/tryout), course library (manual entry for now),
  rolling-average/rank engine, per-player trend charts (scoring average, putts).
- **Phase 2**: Match-day scoring — 2-3 team blocks, hole-by-hole entry, auto team scoring, double-par
  and no-card rules enforced.
- **Phase 3**: Tournament mode — many teams, flights, medalists (spec TBD, keep it extensible). Build
  this as a separate follow-up session once the coach supplies exact rules.

## Seed data
`seed_data.json` (in this repo) has real starter data pulled from the coach's actual spreadsheets:
13 current roster players, and 8 courses with real hole-by-hole par cards extracted from past match
sheets — including one true executive course (Hidden Valley, par 28), which is a good test case for
the normalization rule above. Load this on first run instead of starting from an empty state.

Two caveats worth knowing before trusting it blindly:
- Course pars were auto-extracted from historical match cards, not manually verified — one course
  (Oakhaven) had inconsistent pars across different sheets, so the most common pattern was used.
  Each course record has a `verified: false` flag; surface this in the UI (e.g. a small "unverified"
  badge) so the coach knows to double check before relying on it for real scoring.
- `rounds`, `matches`, and `tournaments` start empty — only roster and course reference data are
  seeded.
- **Stretch**: scorecard photo scan to auto-fill a Course's hole pars/yardages/slope/rating, calling
  Claude's vision API directly from the browser. Since this is a static/no-backend site, the coach
  supplies **his own Anthropic API key**, stored only in his browser's localStorage — never bundled
  into the deployed site. Flag this clearly in the UI as "bring your own key."

## Non-goals for now
- No server, no database, no multi-user login — this is a single coach's tool.
- Don't build the Tournament flight/medalist logic beyond a basic extensible shape until the coach
  provides his exact rules.
