# Coach Guide

For prospective and current coaches — how to get a team added to the platform, and how to use the
app once you have one. (For the technical/platform-operator docs, see [`README.md`](../README.md)
and the rest of [`docs/`](README.md).)

## Requesting a new team

Coach at another school and want your team added to this platform? There's no cost or technical
setup on your end — email **Kendal Montgomery** at **montgoke1@delawarecityschools.net** with:

1. **Team/school name** — e.g. "Riverside Middle School Golf." Used as the display name
   throughout the app.
2. **A Google account email for every coach who needs admin access** (editing roster/rounds/matches
   and publishing reports). Admin access is tied to a Google account, not a separate password or
   login Kendal creates for you — any Google account works, personal or school-issued, no signup
   needed if you already have one.
3. **(Optional) A logo image** — if you'd like your team's own logo in the header instead of the
   default golf-flag icon.
4. **(Optional) Team colors** — if you have specific school colors you'd like used for interface
   accents.

Once set up, your team gets its own page at
`middle-school-golf-tracker.mswd.us/teams/<your-team>/`, starting with an empty roster, and works
exactly like every other team on the platform — you (and any coaches you listed) use "Login with
Google" for edit access; anyone else can view scores/reports read-only. Scoring rules (double-par
cap, rolling-average window, team-score formula) are the same for every team — they're fixed
competition rules, not something set per team.

## Using the app

This is the same reference content available from the "Help" tab inside your team's page — handy
here too if you want to read it before requesting a team, or share it with another coach.

> ### ⚠️ Your data lives only in this browser, on this device — read this first
>
> Everything you type into this app — roster, courses, rounds, matches — is saved **only in the
> local storage of the specific browser and device you typed it into.** Nothing is sent to a
> server or synced automatically, anywhere, ever. Concretely, that means:
>
> - **A different browser on the same computer** (Chrome vs. Safari, or a private/incognito
>   window) has its **own, separate, empty copy** — it will not show what you entered elsewhere.
> - **A different computer, tablet, or phone** — same thing: its own separate, empty copy.
> - **Clearing your browser's data, reinstalling the browser, or getting a new device** will
>   **permanently delete** everything you've entered, with no way to recover it.
> - Another coach on your team logging in on *their* computer does **not** see the data you
>   entered on yours — you're each looking at your own browser's local copy.
>
> The **only** ways data leaves your browser are the two covered below: **exporting** a backup
> file yourself (["Export / Import"](#export--import-season-data)), or an admin clicking
> **["Publish report"](#publishing-reports-admins-only)**, which pushes a snapshot to a shared page
> everyone can see. If you do neither, and something happens to this browser/device, that data is
> gone. **Export a backup regularly** — treat it like saving a document.

### What this is

The app replaces a spreadsheet for running a middle-school golf team: roster, practice/tryout
scores, match-day scoring, rolling averages, and trend charts. It runs entirely in your browser —
there's no server, so your data lives on whichever device and browser you're using unless you
export it or an admin publishes a report (see the warning above).

### Viewer vs. admin mode

Anyone visiting a team's page is a **viewer** by default — you can look around, but "Add player,"
"Log a round," and similar forms are hidden. Clicking **"Login with Google"** and signing in with a
Google account that's listed as an admin for that team unlocks editing and the "Publish report"
button. Any Google account can attempt to log in; whether it becomes an admin depends on whether
it's on that team's admin list, not on anything you can change yourself.

### Roster

Add players with first name, last name, and grade. Use the "Active" checkbox to hide a player from
rank/rounds without deleting their history — inactive players keep their past rounds but drop off
the rank table and round-entry player list.

In admin mode, click a player's row to load them into the form above for editing (typo fixes,
grade changes as they move up a grade) — the form becomes "Edit player" with Update/Cancel buttons,
same pattern as editing a round.

### Courses

Enter each course's hole pars as either a 9-hole card or a full 18-hole card. For an 18-hole
course, rounds and matches ask whether you're playing the front side (holes 1-9) or back side
(holes 10-18). A course marked "unverified" means its pars haven't been double-checked against an
official source yet — treat scores from it with a little caution until someone confirms the card.

Open "Tee sets" under a course to add named tees (e.g. "Gold," "Forward") with their own
yardages — name them whatever you like. On an 18-hole course, enter yardages for both the front
and back sides. Par is normally the same on every tee, so you don't need to enter it again; only
check "different par on this tee" if that specific tee actually changes par on a hole or two
(rare). Selecting a tee set when logging a round or match shows the resulting par and yardage for
the selected side.

In admin mode, click a course's name to load it into the top form for editing (name and pars —
the 9/18-hole layout itself can't be changed once a course exists, since existing tee sets and
rounds are sized to it). Click a tee set's name the same way to edit its yardages, par override,
slope, or rating. Both follow the same Update/Cancel pattern as editing a round or player.

Mark one tee set as the default (radio button in the tee sets table) if your team usually plays a
particular color at that course — it'll be pre-selected next time you log a round or match there.
Different courses can have different defaults.

Mark one course as your "Home" course (radio button in the courses table, admin-only) if your team
practices at the same course most of the time — it'll be pre-selected (along with its default tee,
if it has one) whenever you log a new round, saving you a couple of clicks. Use "Clear home course"
to go back to requiring an explicit choice every time. This is season data, so it travels with
export/import, not something you set once in code.

### Rounds

Log tryout or practice rounds hole-by-hole. A couple of rules apply automatically:

- **Double-par cap** — a hole score can never count as more than 2x that hole's par (a par 4 tops
  out at 8, etc.), even if you enter a higher number. You'll see a note if a score was capped.
- **Minimum holes** — a round needs enough holes actually completed to count toward rank or team
  score. Rounds with too few holes show an "incomplete" badge and are excluded from the numbers
  below.
- **Adjusted score** — scores are normalized to a par-36 baseline so a round on an executive/short
  course compares fairly with a full 9-hole round. Rank and rolling average always use this
  adjusted number, never the raw score.
- **Course selection** — the course field starts blank and must be explicitly chosen, unless a
  home course is set (see Courses above), in which case that course is pre-selected but still
  changeable.
- **Holes default to par** — once a course (and side/tee, if applicable) is picked, each hole
  score starts at that hole's par so you can just nudge the number up/down for a bogey or birdie
  instead of typing every score from scratch. If you change the course, side, or tee set again
  after one's already selected, you'll get a warning first ("resets all 9 hole scores to the new
  selection's par") since it wipes out anything entered so far — choosing to cancel puts the
  course/side/tee selection back exactly as it was, with your scores untouched.

Click any row in the rounds table to expand it and see the hole-by-hole scores. In admin mode, the
expanded row has an **Edit** button that reloads the round into the form above for correction.

Match rounds also show up in this table (type "Match") — every own-roster player's score in a
match is automatically mirrored here as a round, so it counts toward rank and rolling average the
same as a tryout or practice round, weighted no differently. These rows have no Edit button, since
the match itself is the source of truth for that score — correct it from the Matches page instead.

The rounds table can be filtered by player, type (including Match), course, and/or a date range
(from/to) — filters combine (all conditions must match) and are visible to everyone, not just
admins. Filters reset on page reload; they don't persist across visits.

### Rank

Sorted by rolling average — the best 4 of a player's last 6 valid rounds (adjusted scores),
tryouts counting as the earliest rounds. This is a **reference only** — the coach always sets the
actual lineup order by hand; nothing here gets auto-applied.

This tab is where the local-vs-published distinction shows up most directly:

- **Admins** see a *live* table computed from this browser's local data, plus a link to the
  currently published report so you can compare the two before publishing.
- **Viewers** (anyone not logged in as an admin on that device) don't get the live table at all —
  they're shown a link straight to the published report instead. That's deliberate: a viewer's own
  browser almost never has the coach's actual data in it, so showing a "rank table" computed from
  it would just be showing empty or stale numbers.

If a team turns on `extendedRankingStats` in its team config, the rank table (and the matching
published report) also shows each player's tryout average, personal best, rounds played so far,
and an estimated 9-hole handicap. The rounds-played cell is shaded red/yellow/green against
configurable thresholds so a coach can see at a glance who still needs more rounds in. Match scores
count toward rolling average, personal best, and rounds played, but are excluded from the tryout
average, since that's specifically about tryout performance.

Players tied on the displayed rolling average (to one decimal place) share a rank, shown as e.g.
"T2" — the next distinct rank then skips ahead by however many players were tied (two players
tied at rank 2 push the next player to rank 4, not 3), same convention as competition golf
leaderboards.

### Charts

Per-player scoring and putts trends over time, drawn from the same rounds used for rank.

### Matches

A match card can have 2 or 3 teams. Add each team's players with their hole-by-hole scores.
Unlike the Rounds page, a new entry's holes start at **double par**, not par — a real score would
look plausible sitting there unedited, so the default is deliberately an obvious placeholder you
have to overwrite as you enter real scores, rather than something that could quietly pass for a
result you forgot to enter. Editing an existing entry always shows what was actually recorded, of
course. Changing a match's course/side/tee happens through "Edit match" (see below), not inline in
the score-entry row, so there's no reset-to-default warning here — editing the match header never
touches scores you've already entered, only where new entries default to. Uncheck "Starter" for
anyone who's just playing an extra round that day and shouldn't count toward the team score. Team score is the sum of the 4 lowest scores among the 6 starters who
posted a valid score — if fewer than 4 have, it shows as "incomplete" rather than guessing a
number. The
lowest-scoring team in a match is highlighted with a "Winner" badge once at least two teams have a
complete score. The player (or players, if tied) with the lowest individual score across every
team in the match gets a 🏆 medalist badge.

The "Season record" shown at the top counts a 3-team match as two separate results — one against
each opponent — since your team might beat one and lose to the other in the same match. A result
only counts once both teams being compared have a complete score.

Each own-roster player's score is automatically mirrored to the Rounds page as it's entered (see
Rounds above) — opposing-team players and free-text guests aren't on your roster, so they're never
mirrored. "Remove match" deletes the match; if it has any mirrored rounds, you'll be asked whether
to delete those too, or leave them in place on the Rounds page (you can always delete them
separately from there afterward).

**Fixing a mistake after the fact:**

- **A score entry** — every row in a team's table has **Edit** and **Remove** buttons. Edit reloads
  that player, starter flag, hole scores, and putts into the entry form above (button becomes
  "Update score") so you can correct any of it, including re-designating who's a starter after the
  fact — say you sent your last two players off first and only want your top 6 scores to count.
  Updating an entry updates its mirrored round in place rather than creating a second one. Remove
  deletes just that one row; if it has a mirrored round, you'll get the same keep-or-delete choice
  as removing a whole match.
- **The match itself** — "Edit match" lets you correct the date, home/away, course, side, or tee
  set after creation. Team count can't be changed once the match is created. Since every entry's
  mirrored round shares the match's course/date/side/tee, editing any of those cascades to every
  round tied to this match, not just the one you're looking at.
- **A team's name** — "Rename" next to either team's name (including your own) lets you replace
  the default "Opponent 1"/"Opponent 2" placeholder with the actual school name, any time after
  creation — useful since matches get published and "Opponent 1" isn't a great look in a public
  report.

**Unlike the Rank tab, the Matches tab always shows this browser's local data, to viewers and
admins alike** — it does not currently redirect viewers to the published report or link out to it.
So if you're a viewer checking match results from a device that isn't the coach's, what you see
here (likely blank, or an out-of-date local copy) is **not** the team's real results. To see the
team's actual published match history, go to the published report directly — reached from the link
on the Rank tab, or at `reports/index.html` under the team's page — not this tab.

**Sharing a single match with an opposing coach:** every match card has a "Copy report link"
button that copies a link to just that match's published result (not the whole season report) —
handy for texting or emailing the other team's coach after a match. It copies the link right away,
before you've published, so it's the URL the match *will* live at — the other coach won't see
anything until you actually hit "Publish report" (see below). If you edit the match afterward,
re-publish so the link reflects the latest scores; the link itself doesn't change.

### Export / Import (season data)

Found on the admin-only **Data Maintenance** tab. "Export season" downloads everything as a JSON
file — do this regularly as a backup, since your data lives only in this browser until it's
exported or published. "Import season" replaces the current data with a previously exported file.
The data being replaced is automatically saved as a snapshot on that same page first, so a
mistaken import can be undone — see the "Restore" button next to each snapshot in the list there.

### Privacy — this data can become public

*This is about published **season data** — roster, scores, match results. For what's collected
when you **sign in with Google**, see the ["Privacy Policy"](#privacy-policy) section at the end of
this guide instead — the two are separate concerns.*

This app's code and published reports live in a public GitHub repository, so anything that gets
**published** is visible to anyone on the internet, not just people you share a link with. Roster
names are abbreviated automatically when you publish (first name + last initial, e.g. "Graham B" —
extended a letter or two only if two players would otherwise look identical), so full last names
never end up in a published report even though you can still enter full names in your own roster.

The one place this doesn't happen automatically: if you type a player's name in free-text on a
match card (for an extra player or an opposing-team player not in your roster), whatever you type
is published as-is. Use a first-name-and-initial format there too if that player is a minor.

### Publishing reports (admins only)

There's one "Publish report" button (in the header, admin-only) — it is not a per-tab or
per-feature action. Clicking it takes **everything** currently in this browser's local
data — the full roster, every round, every match — and pushes it as one combined snapshot to a
shared report page that anyone can view without logging in, no Google account needed (linked from
the reports viewer, and from the Rank tab). There's no way to publish just the roster, or just
matches, on their own.

Each publish **replaces** the previously published snapshot — the report page always shows the
latest one. But the report page has a "View as of" selector that can reconstruct standings as of
any earlier date using that same published data, so you don't need to publish every single week to
see week-by-week progress — publishing periodically (e.g. after each match) is enough.

The published report has one stable link (`<your-team-domain>/reports/index.html` — shown after
you publish, and also linked from the Rank tab) that's meant to be **handed out**: share it with
players' families, the athletic office, local press, whoever wants to follow along. Anyone with the
link can view current rankings and match results without logging in or needing a Google account of
their own. You only need to share the link once — it's not a snapshot of today's data, it's a page
that always shows whichever data you *most recently* published, so the same link keeps working as
the season goes on. Just click "Publish report" again (in the header) whenever you want that link
to reflect newer results; nothing needs to be re-shared.

Because publishing reads from *this browser's* local data, publish from whichever
device/browser actually has the up-to-date season on it (see the warning at the top of this
guide) — publishing from a different, out-of-sync browser will overwrite the shared report with
stale or incomplete data.

### Found a bug or have an idea?

Feedback and bug reports go through GitHub Issues:
[github.com/MSWD/dempsey-golf-tracker/issues](https://github.com/MSWD/dempsey-golf-tracker/issues)

## Privacy Policy

*Last updated: 2026-08-18.*

This section is specifically about signing in with **Google** — for how **published report data**
(roster, scores, match results) becomes public once a coach publishes it, see "Privacy — this data
can become public" earlier in this guide instead. The two are separate concerns: one is about your
Google identity, the other is about season data you choose to make public.

### What's collected, and why

When you click **"Login with Google"** and sign in, this app receives your **verified Google
account email address** — nothing else. That email is checked, on every page load, against the
specific team's admin list in [`src/teams.json`](../src/teams.json) to decide whether you get
**admin** access (editing roster/rounds/matches, publishing reports) or stay in read-only **viewer**
mode for the team you're currently viewing. That's the only reason this app asks for anything at
all: to answer one question — "is this Google account an admin for this team?"

### What's NOT collected or accessed

- **No access to Google Drive, Calendar, Contacts, or any Workspace directory.** Signing in only
  requests your basic identity (`openid`, `email`, `profile` — Google's own "non-sensitive" scope
  category), never access to your actual Google data.
- **No roster, round, or match data is sent anywhere by signing in.** That data lives only in your
  browser's local storage, exactly as described in the "Your data lives only in this browser" note
  near the top of this guide, whether or not you're signed in. Signing in only unlocks the
  *ability* to edit and publish — it doesn't change where your data lives or send anything extra to
  a server.
- **No password is ever seen or stored by this app.** Sign-in happens entirely on Google's own
  login screen; this app never sees your Google password.

### Where the admin list lives

The list of which Google account emails are admins for which team
([`src/teams.json`](../src/teams.json)) is a plain-text file in this project's public GitHub
repository, editable only by the platform operator directly via git — no code in this app or its
Cloudflare Worker relay ever writes to it. Your email stays on that list for as long as you're an
active admin for your team; sign-ins themselves aren't separately logged or stored anywhere beyond
that.

### Requesting removal

Email **Kendal Montgomery** at **montgoke1@delawarecityschools.net** to be removed from a team's
admin list at any time — for example, if you're no longer coaching. Once removed, that Google
account reverts to ordinary read-only viewer access, same as anyone else.

### Contact

Questions about this policy or how sign-in works: **Kendal Montgomery**,
**montgoke1@delawarecityschools.net** — same contact as [requesting a new
team](#requesting-a-new-team).
