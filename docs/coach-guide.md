# Coach Guide

For prospective and current coaches — how to get a team added to the platform, and how to use the
app once you have one. (For the technical/platform-operator docs, see [`README.md`](../README.md)
and the rest of [`docs/`](README.md).)

## Requesting a new team

Coach at another school and want your team added to this platform? There's no cost or technical
setup on your end — email **Kendal Montgomery** at **montgoke1@delawarecityschools.net** with:

1. **Team/school name** — e.g. "Riverside Middle School Golf." Used as the display name
   throughout the app.
2. **A GitHub username for every coach who needs admin access** (editing roster/rounds/matches and
   publishing reports). Admin access is tied to a GitHub account, not a separate password or
   login Kendal creates for you.
   - No GitHub account yet? It's free and takes a minute — go to
     [github.com/join](https://github.com/join), pick a username, verify your email. Any personal
     account works; you don't need to be added as a collaborator on this repository or have any
     prior GitHub experience beyond logging in when asked.
3. **(Optional) A logo image** — if you'd like your team's own logo in the header instead of the
   default golf-flag icon.
4. **(Optional) Team colors** — if you have specific school colors you'd like used for interface
   accents.

Once set up, your team gets its own page at
`middle-school-golf-tracker.mswd.us/teams/<your-team>/`, starting with an empty roster, and works
exactly like every other team on the platform — you (and any coaches you listed) use "Login with
GitHub" for edit access; anyone else can view scores/reports read-only. Scoring rules (double-par
cap, rolling-average window, team-score formula) are the same for every team — they're fixed
competition rules, not something set per team.

## Using the app

This is the same reference content available from the "Help" tab inside your team's page — handy
here too if you want to read it before requesting a team, or share it with another coach.

### What this is

The app replaces a spreadsheet for running a middle-school golf team: roster, practice/tryout
scores, match-day scoring, rolling averages, and trend charts. It runs entirely in your browser —
there's no server, so your data lives on whichever device and browser you're using unless you
export it or an admin publishes a report.

### Viewer vs. admin mode

Anyone visiting a team's page is a **viewer** by default — you can look around, but "Add player,"
"Log a round," and similar forms are hidden. Clicking **"Login with GitHub"** and signing in with a
GitHub account that's listed as an admin for that team unlocks editing and the "Publish report"
button. Any GitHub account can attempt to log in; whether it becomes an admin depends on whether
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

Click any row in the rounds table to expand it and see the hole-by-hole scores. In admin mode, the
expanded row has an **Edit** button that reloads the round into the form above for correction.

The rounds table can be filtered by player, type, course, and/or a date range (from/to) — filters
combine (all conditions must match) and are visible to everyone, not just admins. Filters reset on
page reload; they don't persist across visits.

### Rank

Sorted by rolling average — the best 4 of a player's last 6 valid rounds (adjusted scores),
tryouts counting as the earliest rounds. This is a **reference only** — the coach always sets the
actual lineup order by hand; nothing here gets auto-applied.

If a team turns on `extendedRankingStats` in its team config, the rank table (and the matching
published report) also shows each player's tryout average, personal best, rounds played so far,
and an estimated 9-hole handicap. The rounds-played cell is shaded red/yellow/green against
configurable thresholds so a coach can see at a glance who still needs more rounds in.

### Charts

Per-player scoring and putts trends over time, drawn from the same rounds used for rank.

### Matches

A match card can have 2 or 3 teams. Add each team's players with their hole-by-hole scores;
uncheck "Starter" for anyone who's just playing an extra round that day and shouldn't count toward
the team score. Team score is the sum of the 4 lowest scores among the 6 starters who posted a
valid score — if fewer than 4 have, it shows as "incomplete" rather than guessing a number. The
lowest-scoring team in a match is highlighted with a "Winner" badge once at least two teams have a
complete score. The player (or players, if tied) with the lowest individual score across every
team in the match gets a 🏆 medalist badge.

The "Season record" shown at the top counts a 3-team match as two separate results — one against
each opponent — since your team might beat one and lose to the other in the same match. A result
only counts once both teams being compared have a complete score.

### Export / Import (season data)

"Export season" downloads everything as a JSON file — do this regularly as a backup, since your
data lives only in this browser until it's exported or published. "Import season" replaces the
current data with a previously exported file, so it's a good habit to export first if you're about
to import over live data.

### Privacy — this data can become public

This app's code and published reports live in a public GitHub repository, so anything that gets
**published** is visible to anyone on the internet, not just people you share a link with. Roster
names are abbreviated automatically when you publish (first name + last initial, e.g. "Graham B" —
extended a letter or two only if two players would otherwise look identical), so full last names
never end up in a published report even though you can still enter full names in your own roster.

The one place this doesn't happen automatically: if you type a player's name in free-text on a
match card (for an extra player or an opposing-team player not in your roster), whatever you type
is published as-is. Use a first-name-and-initial format there too if that player is a minor.

### Publishing reports (admins only)

"Publish report" pushes the current roster/rounds/matches to a shared report page anyone can view
without logging in (linked from the reports viewer). It always reflects the latest publish, but
the report page has a "View as of" selector that can reconstruct standings as of any earlier date
from that same data — so you don't need to publish every single week to see week-by-week progress.

### Found a bug or have an idea?

Feedback and bug reports go through GitHub Issues:
[github.com/MSWD/dempsey-golf-tracker/issues](https://github.com/MSWD/dempsey-golf-tracker/issues)
