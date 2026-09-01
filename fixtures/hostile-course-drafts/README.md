# Hostile course-draft fixtures

Manual verification checklist for the scorecard-import feature (`src/js/course-import.js`,
Courses tab's "Import a course from a scorecard" section). There's no automated test runner in
this repo (see `fixtures/hostile-imports/README.md`), so exercise each file by hand: open the
Courses tab as admin, expand "Import a course from a scorecard," paste the file's contents into
the JSON box, give it a name if one isn't picked up automatically, and click "Check scorecard
JSON." Each expected outcome below was also confirmed directly against `parseCourseDraft` /
`buildCourseFromDraft` / `checkDraftTotals` via Node (no browser DOM involved in that check, so
still confirm the on-screen preview/warnings by hand too).

| File | Expected outcome |
| --- | --- |
| `wrapped-in-fences.txt` | **Parses and previews successfully** — a \`\`\`json fence plus leading/trailing prose around the JSON, the way assistants add it despite being told not to. Preview shows "Fence Test Nine," 9 holes, one Gold tee, no warnings. |
| `truncated.txt` | **Rejected** with `Could not find a JSON object ({ ... }) in the pasted text.` — the array is cut off mid-value with no closing `}` anywhere in the text. |
| `mismatched-tee-length.json` | **Rejected** with `courses[0].teeSets[0]: holeYardages must be an array of 18 numbers` — the course is 18 holes but the Gold tee only lists 17 yardages. |
| `string-par.json` | **Rejected** with `courses[0]: holePars must be an array of 9 or 18 numbers` — the first hole's par is the string `"4"` instead of the number `4`. |
| `xss-name.json` | **Parses and previews successfully** — the course name and a tee name both carry markup/script payloads. Confirm the preview renders them as inert text (never live markup), then save and check the same on the Courses table row and the tee-sets panel underneath it. |
| `no-tee-sets.json` | **Parses and previews successfully** — a valid par-only course with no `teeSets` at all. Preview shows 9 holes, "No tee sets." |
| `mismatched-totals.json` | **Parses and previews successfully, with warnings** — every printed total (`printedParTotals` and the Gold tee's `printedTotals`) deliberately disagrees with what the arrays actually add up to, and `notes` is non-empty. Confirm all four mismatch lines appear under "Double-check before saving" along with the assistant's note, and that "Save course" still works after acknowledging them. |

## Conflict path (not file-driven)

Import any fixture above that succeeds twice in a row with the same course name (e.g.
`wrapped-in-fences.txt` twice). The second "Check" should show "A course named ... already exists"
with Replace/Add-as-new radios. Confirm Replace keeps the same course `id` (check via Export) and
Add-as-new creates a second course with a different `id`.
