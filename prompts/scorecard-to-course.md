# Scorecard-to-course prompt

The prompt a coach copies (via the "Copy prompt" button on the Courses tab's "Import a course from
a scorecard" section) to transcribe a scorecard photo into JSON, in whatever chat assistant they
already have — Gemini, Claude, ChatGPT, Copilot, Grok, or similar. No API key or in-app network
call is involved; the coach pastes the resulting JSON back into the app, which validates, previews,
and saves it.

This file and the `SCORECARD_TO_COURSE_PROMPT` constant in `src/js/course-import.js` are meant to
say the same thing. There's no build step to generate one from the other, so keep them in sync by
hand if either changes.

## The prompt

```
You are transcribing a golf scorecard photo into JSON so it can be imported into a golf-team tracking app. Read the attached scorecard image carefully and respond with raw JSON only — no markdown code fences, no explanation before or after, just the JSON object itself.

Produce exactly this shape:

{
  "name": "<course name as printed on the card>",
  "holePars": [<9 or 18 numbers - par for each hole, in order>],
  "printedParTotals": { "out": <number|null>, "in": <number|null>, "total": <number|null> },
  "teeSets": [
    {
      "name": "<tee name/color as printed, e.g. \"Black\", \"Gold\">",
      "holeYardages": [<same length as holePars - yardage for each hole, in order>],
      "rating": <course rating number, e.g. 73.2, or null if not printed>,
      "slope": <slope number, e.g. 133, or null if not printed>,
      "printedTotals": { "out": <number|null>, "in": <number|null>, "total": <number|null> }
    }
  ],
  "defaultTeeSetName": null,
  "notes": "<anything you couldn't read clearly, or leave as an empty string>"
}

Rules:
- holePars must have exactly 9 or 18 numbers. If the card shows only a front nine, use 9.
- Every teeSets[].holeYardages array must be the SAME LENGTH as holePars.
- One teeSets entry per tee/color that has its own yardage row on the card. Use the tee's printed name (e.g. "Black", "Gold", "White"); if it's only labeled by a color swatch, use the color word.
- Tee ratings are usually printed as a "rating/slope" pair like "73.2/133" - rating is the first (smaller, decimal) number, slope is the second (larger, whole number, usually 55-155). Use null for either if the card doesn't print it - never estimate or guess a value.
- Copy the card's own printed Out/In/Tot numbers into printedParTotals and each tee's printedTotals EXACTLY as printed, even if you think they look wrong. Do not recompute them yourself - they're only used to double-check your transcription afterward.
- Completely ignore any "Handicap" or "Hcp" row (the per-hole stroke-index numbers) - this app doesn't use it.
- Ignore player score rows, initials columns, local rules text, and any advertising on the card.
- If a number is smudged, cut off, or otherwise unreadable, do not guess - write a plain-English note about it in "notes" instead (e.g. "Blue tee hole 14 yardage unreadable").
- defaultTeeSetName should be null unless the card visibly marks one tee as the default/standard tee.
- Output nothing but the JSON object - no ```json fences, no "Here is the JSON:", no trailing remarks.

Example, for a 9-hole card with two tees (values invented, just to show the shape):

{
  "name": "Sample Nine",
  "holePars": [4, 4, 3, 5, 4, 3, 4, 5, 4],
  "printedParTotals": { "out": 36, "in": null, "total": 36 },
  "teeSets": [
    { "name": "Gold", "holeYardages": [350, 310, 140, 480, 360, 150, 320, 470, 340],
      "rating": 34.2, "slope": 118, "printedTotals": { "out": 2920, "in": null, "total": 2920 } },
    { "name": "White", "holeYardages": [320, 280, 120, 440, 330, 130, 290, 430, 310],
      "rating": 32.8, "slope": 112, "printedTotals": { "out": 2650, "in": null, "total": 2650 } }
  ],
  "defaultTeeSetName": null,
  "notes": ""
}
```

## What the app does with the result

`src/js/course-import.js` parses the pasted JSON (tolerating stray fences/prose around it), builds
a course through the same `newCourse`/`newTeeSet` constructors (`src/js/models.js`) every other
course-creation path uses, and validates it with the same `validateCourse`
(`src/js/data-store.js`) a season import runs. `checkDraftTotals` re-adds the per-hole numbers and
compares them against `printedParTotals`/`teeSets[].printedTotals`, surfacing any mismatch as a
warning — the import is never blocked on it, but the coach should treat a mismatch as a reason to
double-check that hole before saving. If the course name matches an existing course, the coach
chooses whether to replace it in place (same id, so any rounds/matches already pointing at it stay
linked) or add it as a separate course.

This is also the exact draft contract `scripts/add-course.py` accepts (drop
`printedParTotals`/`printedTotals`/`notes`, which are in-app-only) — a coach without browser access
can hand that script the same JSON to merge into an exported season file from the command line.

## Related

- `docs/decisions.md` — "Why scorecard import is copy-paste, not an API call".
- `docs/coach-guide.md` — the Courses section walks through using this from the app.
