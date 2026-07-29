# Hostile import fixtures

Manual verification checklist for issue #9 (escaping gaps, import validation, deleted-course
crash). There's no automated test runner in this repo, so exercise each file through the app's
real "Import data" button (Roster/Help view, admin mode) and confirm the outcome below. Each file
is a trimmed, single-record season based on `sample-2026-test-team-season.json` (safe/fake data —
never use a real exported season for this).

| File | Expected outcome |
| --- | --- |
| `xss-strings.json` | **Imports successfully** (all shapes are valid; only unconstrained free-text/id fields carry markup/quote payloads — `firstName`, course `name`, team `name`, `displayName`, and a player `id` containing a literal `"`). After importing, check Roster, Courses, Rounds, Rank, Charts, and Matches — every value must render as inert text, never live markup or a broken attribute/selector. If you publish this data, also check the public report page. |
| `bad-array-shape.json` | **Rejected** with `Invalid import file: missing "players" array.` — `players` is an object instead of an array. |
| `bad-hole-scores-length.json` | **Rejected** with `rounds[0]: holeScores must be an array of 9 numbers-or-null` — the round's `holeScores` has 8 elements instead of 9. |
| `bad-hole-pars-type.json` | **Rejected** with `courses[0]: holePars must be an array of 9 or 18 numbers` — the course's first hole par is the string `"4"` instead of the number `4`. Pre-fix, this would have silently produced `NaN`/string-concatenation through `roundTotalPar`'s untyped `.reduce`; post-fix it's rejected outright at import time. |
| `dangling-course-id.json` | **Imports successfully** — referential integrity is deliberately not enforced (an otherwise-valid historical record shouldn't become un-importable just because a referenced course was later deleted). The match's `courseId` doesn't match any course in the file. After importing, open the Matches view and confirm: the "Course unavailable" banner is shown instead of a crash, the "To Par" column shows `—`, and attempting to add a new score to that match shows an alert and does not throw (check the browser console). This is the C3 regression test. |

## Not reachable via Import at all

`init()`'s validation only runs on read; it can't be exercised through a file. To confirm it works,
seed `localStorage` directly via devtools **before loading the app**, then reload:

```js
localStorage.setItem('mstgt:data:<team-slug>', JSON.stringify({
  seasonName: '', players: [{ id: 'p1', firstName: 'X', lastName: 'Y', grade: '<b>9</b>', active: true }],
  courses: [], rounds: [], matches: [], tournaments: [],
}));
```

`grade` here is a string, not a number, so it fails `validateImportData`. After reloading, the app
should auto-recover to an empty season (not crash, not persist the corrupted blob) — check the
console for the `"Stored data failed validation — resetting to empty..."` message.
