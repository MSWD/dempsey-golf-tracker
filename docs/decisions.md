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

**Update (issue #7):** the release-only trigger didn't account for the "Publish report" flow added
later — `/publish` commits `latest.json` straight to `main`, but nothing deployed it until someone
separately cut a release, so publishing was silently a no-op in production. Fixed by adding a
`push` trigger scoped to `src/teams/*/reports/data/**` only — the *one* path
`handlePublish` (`worker/cloudflare-device-flow-relay.js`) is allowed to write to (an exact-path
allowlist, not a prefix check — see the next entry). That pairing is deliberate: a push-triggered
deploy would otherwise mean "any push to main deploys unreviewed code," but since `/publish` can
only ever touch that one data path, scoping the trigger to it can't be turned into a code-deploy
hole. **If you ever widen what `/publish` is allowed to write, widen this trigger's `paths` to
match — don't revert to a release-only trigger without re-checking whether publishing still needs
this.**

## Why `/publish`'s path check is an exact allowlist, not a prefix check

The original prefix check (`path.startsWith('src/teams/<slug>/')` + a check for `.`/`..` path
segments) only ruled out directory traversal — it didn't constrain the filename or extension, so
an authorized admin for team A could write *any* file (any name, any extension) into team A's own
directory. That's more than it looks like: a JSON-stringified body is still valid content for an
`.html` file, and HTML written to this repo's Pages site executes on the same shared origin that
holds `AUTH_STORAGE_KEY` (see the auth-session-lifecycle entry above) — unnamespaced by team, by
design, so one team's admin writing HTML into their own team's directory can still reach another
coach's token. `src/js/github-publish.js` only ever writes one exact path
(`src/teams/<slug>/reports/data/latest.json`), so there's no legitimate case that needs more than
an exact match — `handlePublish` now rejects anything else outright, which removes the filename/
extension question and the "does GitHub's contents API decode an encoded traversal segment"
question (both raised in issue #7) in one line, rather than trying to enumerate every string a
prefix check would still need to reject.

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
stateless Worker relays those two requests. The device-code exchange itself needs no secret —
GitHub Apps' device flow is a public-client flow, gated only by the public Client ID. (The Worker
did later pick up a client secret for two narrower flows — token refresh and logout revocation —
see the session-lifecycle entry below; that's unrelated to the device-code exchange itself.)

This device-flow *shape* (short code, verify on a separate page, poll for a token) was later kept
when the identity provider itself was swapped — see the next entry.

## Why Google device-flow login replaced GitHub's, and why Testing mode (issue #26)

GitHub's device-flow login worked, but asked a non-technical coach to understand what a GitHub
account is — a real barrier before rolling this out to coaches who aren't developers. Google
supports the same category of flow ("OAuth 2.0 for TV and Limited-Input Device Applications" in
their terms, same underlying RFC 8628 device-flow shape as GitHub's), so the swap kept
`google-auth.js`'s session-lifecycle shape (read/write/clear session, transparent refresh, revoke on
logout) essentially unchanged from `github-auth.js`'s — only the provider endpoints, and how caller
identity is resolved, actually changed:

- **Identity resolution changed from an API call to local verification.** GitHub resolved a caller's
  identity with a live `GET /user` call using their access token. Google instead issues a signed
  **ID token** (a JWT) alongside the access token; the Worker verifies its signature locally against
  Google's public keys (JWKS) rather than making an outbound identity API call on every admin check
  — faster, and one less external dependency in the hot path. `teams.json`'s `adminUsernames`
  (GitHub logins) became `adminEmails` (Google account emails, from the ID token's verified `email`
  claim) accordingly.
- **Google requires its client secret on every `/token` call**, not just the refresh grant the way
  GitHub's App did — a real behavioral difference in the Worker's `handleToken`, not just a
  find-and-replace of provider names.
- **Testing mode, not full app verification.** Google's OAuth apps default to a "Testing" publishing
  status: capped at 100 explicitly-added test users, with an "unverified app" warning shown on the
  consent screen, but skipping Google's full verification review (a process built for public
  consumer apps requesting broad data access). For a small, single-operator admin allowlist —
  structurally the same shape as `teams.json` itself — Testing mode's cap and warning are an
  accepted tradeoff, not a gap to fix; pursuing full verification for ~2 admins would trade a
  days-to-weeks review process for a benefit that doesn't apply here.
- **Any Google account works, including school-district Workspace accounts the operator doesn't
  administer.** Trust is still purely an email-allowlist decision in `teams.json` — no Google
  Workspace directory access, no domain-wide delegation, no coordination with a school's IT
  department needed on this app's side. (A school's own Workspace "App access control" policy could
  independently block its users from authorizing any third-party OAuth app at all — outside this
  app's control either way, not something Google account trust here can route around.)

## Why admin/viewer mode is gated on a live check, not just "a token exists"

A stale or revoked token sitting in localStorage should silently fall back to viewer mode, not
throw errors in the coach's face. `GoogleAuth.isAdmin()` re-checks live every time, rather than
trusting a cached "logged in" flag. What it checks against changed with the move to path-based
hosting — see the next entry.

## Auth session lifecycle: expiry, revocation, and why `AUTH_STORAGE_KEY` isn't namespaced

Three related gaps in the original device-flow login, all reaching a coach as "the login did
something weird" (GitHub issue #11):

- The client stored the bare access token and ignored `expires_in`/`refresh_token`. The GitHub
  App has "User-to-server token expiration" enabled (access tokens expire after 8h), so this was a
  live bug, not a hypothetical one — admin mode was silently falling back to viewer mode mid-session
  with no explanation. Fixed by storing the token alongside its expiry and refresh token, and
  transparently refreshing via the Worker before falling back to an explicit "please log in again."
- `logout()` only cleared `localStorage`; the token stayed valid on GitHub's side. Fixed with a
  best-effort server-side revoke (`DELETE /applications/{client_id}/token` — the single-token
  revoke, deliberately not `/applications/{client_id}/grant`, which would deauthorize the coach's
  entire app access across every device at once).
- Both the refresh grant and the revoke call need the GitHub App's client secret, unlike the
  device-code exchange — see the previous entry. The Worker now holds a second secret,
  `GITHUB_APP_CLIENT_SECRET`, alongside `GITHUB_PAT`.

Unlike `DataStore`'s `STORAGE_KEY`, `google-auth.js`'s `AUTH_STORAGE_KEY` is deliberately the same
key regardless of which team path the coach is currently on — a login session identifies the same
account no matter which team's page it was obtained on, so one login covers every team that
account happens to administer. Namespacing it per team would just force the same coach to log in
again on every team path, for no benefit.

To be explicit about what this is *not*: this is not the fix for the cross-tenant token-theft
chain described in issues #1 and #7 (any team's page, being same-origin under path-based hosting,
can read a token stored by any other team's page). Namespacing this key wouldn't close that gap
either — a same-origin script can already read every localStorage key regardless of its name. That
chain is addressed at the origin/CSP layer (locking down what scripts can run on each team's page
at all — see the Chart.js/CSP entry below), not by how this one key is named.

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

## Why match teams got a `scoringMode` toggle instead of a global "entry style" setting

Coaches don't always have an opponent's hole-by-hole card — sometimes the only number they get
after a match is a final total. Forcing hole-by-hole entry in that case meant either inventing 9
numbers that summed to the real total (misleading Front3/Mid3/Back3 splits) or not recording the
opponent's score at all. `scoringMode: 'byHole' | 'scoreOnly'` lives on the match *team*, not the
match or a global setting, because the need is per-opponent: a 3-team match could have one
opponent whose card the coach filled in hole-by-hole and another they only got a final score from.
It's set at the team level rather than per-entry so the add-score form only asks for what the
coach can actually supply, without a mode selector cluttering every single player row.

`entryRawScore`/`entryIsValid` (`scoring-engine.js`) read whichever shape (`holeScores` or
`totalScore`) an entry actually has, so team score, medalist, and to-par all work identically
regardless of which mode produced a given score — the fixed scoring rules (see "Why scoring rules
aren't part of the white-label team-config" above) are untouched, this only changes what a coach
has to type in to invoke them. This is deliberately opt-in per opponent and never available for
the own team: own-roster entries feed player rankings through `syncMatchRounds`' mirrored `Round`
records, which need real hole-level data (`isValidRound`'s minimum-holes check, `Charts`), so
allowing Score Only there would silently break rank/charts for anyone the coach entered that way.

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

## Why Chart.js is vendored and every page carries a CSP

The app holds a GitHub token in `localStorage` (see the device-flow entry above), on the same
origin every team's page shares. That makes "what can third-party JS do on this page" a real
question, not a theoretical one — Chart.js was previously loaded unpinned from a CDN
(`chart.js@4`, floating major version, no integrity check), which meant any 4.x release, or a
compromise of that CDN path, was arbitrary JS with access to that token. It's now vendored at
`src/assets/vendor/chart.min.js` and every page ships a `script-src 'self'` CSP meta tag (GitHub
Pages can't set response headers, so `<meta http-equiv>` is the only option) — the CSP is real
defense in depth only once nothing on the page needs a script-src exception, which is why the CDN
tag had to go first.

The stricter `style-src 'self'` (no `'unsafe-inline'`) turned out to have a second cost: every
inline `style="..."` attribute and every `element.style.x = ...` mutation is blocked under it too,
not just inline `<script>` blocks. Rather than carve out an `'unsafe-inline'` exception for
style-src, the handful of call sites that used inline styles were converted to utility classes
(`.hidden`, `.input-narrow`, etc. in `styles.css`) so the policy could ship with no exceptions at
all.

`add-team.py`'s templates carry the vendored script tag and the CSP tag too, so newly scaffolded
teams get them by default — `scripts/check-team-templates.py` (run in CI) catches the case where a
template change like this lands but an already-onboarded team's files don't get it.

## Named tee sets per course

Courses can now have multiple named tee sets (`Course.teeSets[]`), each with its own yardages and,
rarely, its own par override (`holeParsOverride`) for the small number of courses where a
forward/back tee actually changes par on a hole or two — confirmed by the coach as a real but
uncommon case, so the common case (yardage-only tee sets) stays simple while still supporting it.
Rounds and matches can each select which tee set was played (`teeSetId`); `Course.holePars` stays
the base/default pars, used whenever no tee set (or a tee set with no override) is selected.

Tee-set totals (`teeSetTotalPar`/`teeSetTotalYardage` in `scoring-engine.js`) are computed on read
rather than precomputed and stored like `Course.totalPar` — a tee set's effective par depends on
its override and feeds directly into the double-par cap / adjusted-score math, so it stays a
single live source of truth instead of a cached value that could drift out of sync.

Slope/rating moved from the course to each tee set, matching how real courses rate them (per tee,
not per course) — previously unused fields on `Course` regardless, so no scoring impact.

## Optional 18-hole course cards, still 9-hole scoring records

Courses can now store either 9 or 18 hole pars, and tee sets can store matching 9 or 18 hole
yardages/par overrides. Rounds and matches remain 9-hole scoring records (`holeScores[9]`) because
the ranking, double-par cap, team-score rules, and existing exports all operate on a 9-hole card.
For 18-hole courses, the round/match stores a small additive `side` field (`front` or `back`) so
`scoring-engine.js` resolves the selected side down to the 9 pars that actually apply. Existing
exports do not need migration: a missing `side` defaults to the historical 9-hole/front behavior,
and existing 9-value course/tee arrays continue to resolve as-is.

## iPad and Pixel 10 layout pass

Landscape/portrait layouts were measured and tuned against an actual iPad (Air/Pro-class, 1180px+
landscape) and a Pixel 10 (portrait and landscape), not just breakpoint guesses — see the
`#round-holes`/`.hole-scores`/`.add-player-row` comments in `styles.css` for the specific widths
and why Rounds and Matches need slightly different hole-input widths (Matches' row shares its
card's width budget with a longer preceding name+Starter row, Rounds' doesn't). Below ~1100px
(every phone in either orientation, and any tablet in portrait) the 9 hole-score fields switch from
a single scrollable line to a fixed 3-per-row grid instead, since a horizontal scrollbar there is
worse than wrapping; landscape tablets above that width keep the single-line layout. Safari itself
still hasn't been tested — coach is fine running Chrome on iPad for now, but wants to verify Safari
behavior in a later iteration.

## Highlighting the winning team on match cards

`renderMatchCard` (`ui-matches.js`) now adds a `winning-team` class to whichever team block has the
lowest *complete* team score (`scoring-engine.js`'s `teamScore()`). A winner is only ever declared
once at least 2 teams have posted a complete score — with fewer than that there's nothing to
compare, so no highlight rather than a premature or misleading one. This is separate from the
existing medalist badge, which is an individual (not team) stroke-play award computed across every
player in the match regardless of team or starter status.

## Why scorecard import is copy-paste, not an API call

Adding a course by hand means typing every hole's par and yardage for every tee — for a full
18-hole, 4-tee scorecard that's roughly 90 numbers off a photo, the most tedious and error-prone
data entry in the app. Chat assistants read scorecard photos well, so the Courses tab now has an
"Import a course from a scorecard" section: a copy-pasteable prompt (`course-import.js`'s
`SCORECARD_TO_COURSE_PROMPT`, mirrored in `prompts/scorecard-to-course.md`) that a coach runs
against their scorecard photo in whatever assistant they already have, pasting the resulting JSON
back in. The app then builds the course through the same `newCourse`/`newTeeSet` constructors and
`validateCourse` validation every other course-creation path uses (`course-import.js`), previews it,
cross-checks the transcribed yardages against the totals printed on the card itself, and asks about
conflicts before saving — see `docs/coach-guide.md`'s Courses section for the full workflow.

Deliberately not a direct API call to a vision model. Every team page ships a strict CSP
(`connect-src 'self' <auth worker>` — see "Why Chart.js is vendored and every page carries a CSP"
above); calling an LLM API from the browser would mean loosening that CSP and asking each coach to
supply and store their own API key. The copy-paste design needs neither, and it works with whatever
assistant a coach already has an account for rather than locking the feature to one vendor — Gemini
is the first one actually verified end-to-end, since the app already targets Google-account users
for login, but the prompt is written to be vendor-neutral. This replaces the older "Scorecard photo
scan (stretch)" backlog item below, which had assumed the API-call approach.

## Backlog / deliberately deferred

- **Exact minimum-holes-for-valid-round number.** Currently `5` in `scoring-engine.js`
  (`MIN_HOLES_FOR_VALID_ROUND`) — coach is confirming the OHSAA rule, may be `6`. Change that one
  constant once confirmed.
- **Tournament mode (Phase 3).** Up to ~20 teams, boys/girls flights, team + individual rankings,
  flight medalists. Explicitly deferred until the coach supplies exact rules — see
  `prompts/PROJECT_BRIEF.md`.
- **Scorecard photo scan.** Done, but as a copy-paste-to-external-assistant flow rather than a
  direct in-browser API call — see "Why scorecard import is copy-paste, not an API call" above.
- **Putts stat skewed by picked-up holes — needs design.** `Round.putts` is a single total for the
  whole round (see `models.js`/`ui-rounds.js`), not per-hole. Once a player hits the double-par cap
  on a hole they often pick up rather than finish holing out, so the true putt count for that hole
  is unknown — right now there's no way to flag that a hole wasn't completed for putting purposes,
  so a coach either has to guess/estimate or the round's putts total silently under- or
  over-represents actual putting. Coach wants putts tracked well enough to show real improvement
  over time, but not skewed by picked-up holes. Even strong players have pick-up holes sometimes,
  so this isn't a rare edge case. Coach's leaning: a simple round-level "incomplete / picked up"
  marker (not necessarily per-hole) to at least flag that a round had pickup holes, rather than a
  full per-hole putts breakdown — but what that marker should *do* to the rank/rolling-average
  putts math isn't decided yet (exclude the round's putts from stats entirely? show it but flag it
  in the UI? something else?). Needs a real design pass before building — bundle with
  `MIN_HOLES_FOR_VALID_ROUND` / incomplete-round logic since it's the same "how much of this round
  actually counts" problem.
