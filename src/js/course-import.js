// Turns a "course draft" — JSON an LLM produced by reading a scorecard photo, pasted in by a coach
// on the Courses tab — into a real course object using the exact shapes/validation the rest of the
// app already trusts (models.js's newCourse/newTeeSet, data-store.js's validateCourse). No network
// calls happen here or anywhere in this feature: every team page's CSP restricts connect-src to
// itself plus the auth worker, so the coach runs the prompt in whatever chat assistant they already
// have (Gemini, Claude, ChatGPT, Copilot, Grok, ...) and pastes the JSON result back in.
//
// The prompt text below and prompts/scorecard-to-course.md are meant to say the same thing — this
// is the version a coach actually copies (via the button in ui-courses.js); keep the markdown copy
// in sync by hand if this changes, since there's no build step to generate one from the other.
const SCORECARD_TO_COURSE_PROMPT = `You are transcribing a golf scorecard photo into JSON so it can be imported into a golf-team tracking app. Read the attached scorecard image carefully and respond with raw JSON only — no markdown code fences, no explanation before or after, just the JSON object itself.

Produce exactly this shape:

{
  "name": "<course name as printed on the card>",
  "holePars": [<9 or 18 numbers - par for each hole, in order>],
  "printedParTotals": { "out": <number|null>, "in": <number|null>, "total": <number|null> },
  "teeSets": [
    {
      "name": "<tee name/color as printed, e.g. \\"Black\\", \\"Gold\\">",
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
- Output nothing but the JSON object - no \`\`\`json fences, no "Here is the JSON:", no trailing remarks.

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
}`;

// Strips a \`\`\`json fence or any stray prose an assistant added despite the prompt's instructions,
// by taking the outermost {...} in the pasted text, then parses that. LLMs add commentary around
// their JSON often enough that requiring an exact match would just bounce the coach back to their
// chat to ask again.
function parseCourseDraft(text) {
  const trimmed = (text || '').trim();
  if (!trimmed) throw new Error('Paste the JSON your assistant gave you first.');
  const first = trimmed.indexOf('{');
  const last = trimmed.lastIndexOf('}');
  if (first === -1 || last === -1 || last < first) {
    throw new Error('Could not find a JSON object ({ ... }) in the pasted text.');
  }
  try {
    return JSON.parse(trimmed.slice(first, last + 1));
  } catch (err) {
    throw new Error(`That doesn't parse as JSON: ${err.message}`);
  }
}

function sum(arr) {
  return arr.reduce((a, b) => a + b, 0);
}

// { front, back, total } — back is null for a 9-hole array, matching how the rest of the app
// treats side (ui-courses.js's isEighteenHoleCourse / sideTotal).
function frontBackTotal(arr) {
  if (arr.length <= 9) return { front: sum(arr), back: null, total: sum(arr) };
  return { front: sum(arr.slice(0, 9)), back: sum(arr.slice(9)), total: sum(arr) };
}

// Compares what the draft's own arrays add up to against the printed totals it was asked to copy
// verbatim (printedParTotals / teeSets[].printedTotals) — catches a single misread yardage that
// would otherwise sail through structural validation untouched. Verification-only: returns
// human-readable warning strings, never throws, and every printed* field is dropped before the
// draft becomes a real course (see buildCourseFromDraft) — these fields never end up stored.
function checkDraftTotals(draft) {
  const warnings = [];

  if (Array.isArray(draft.holePars) && draft.printedParTotals) {
    const { front, back, total } = frontBackTotal(draft.holePars);
    const p = draft.printedParTotals;
    if (p.out != null && p.out !== front) warnings.push(`Par: front nine adds to ${front}, but the card shows ${p.out}.`);
    if (back != null && p.in != null && p.in !== back) warnings.push(`Par: back nine adds to ${back}, but the card shows ${p.in}.`);
    if (p.total != null && p.total !== total) warnings.push(`Par: total adds to ${total}, but the card shows ${p.total}.`);
  }

  (draft.teeSets || []).forEach((t) => {
    if (!Array.isArray(t.holeYardages) || !t.printedTotals) return;
    const { front, back, total } = frontBackTotal(t.holeYardages);
    const p = t.printedTotals;
    const label = t.name || 'Unnamed tee';
    if (p.out != null && p.out !== front) warnings.push(`${label} tee: front nine yardages add to ${front}, but the card shows ${p.out}.`);
    if (back != null && p.in != null && p.in !== back) warnings.push(`${label} tee: back nine yardages add to ${back}, but the card shows ${p.in}.`);
    if (p.total != null && p.total !== total) warnings.push(`${label} tee: total adds to ${total}, but the card shows ${p.total}.`);
  });

  return warnings;
}

// Builds a real course object from a draft, in the exact shape newCourse/newTeeSet produce, then
// validates it with the same validateCourse (data-store.js) every import already goes through — no
// separate validation rules for this path. `name` is caller-supplied (the Course name field on the
// import panel wins over whatever the draft said); pass `existingId` to replace a course in place
// (keeping its id, so any rounds/matches already pointing at it stay linked) rather than adding a
// new one. Throws on any structural problem, with the same path-prefixed messages importJSON uses.
function buildCourseFromDraft(draft, { name, existingId = null } = {}) {
  if (!name || !name.trim()) throw new Error('Course name is required.');
  if (!Array.isArray(draft.holePars)) throw new Error('Draft is missing "holePars".');

  const teeSets = (draft.teeSets || []).map((t) => newTeeSet({
    name: t.name,
    holeYardages: t.holeYardages,
    holeParsOverride: t.holeParsOverride ?? null,
    slope: t.slope ?? null,
    rating: t.rating ?? null,
  }));

  let defaultTeeSetId = null;
  if (draft.defaultTeeSetName) {
    const match = teeSets.find((t) => t.name === draft.defaultTeeSetName);
    if (match) defaultTeeSetId = match.id;
  }

  const course = newCourse({
    name: name.trim(),
    holePars: draft.holePars,
    teeSets,
    defaultTeeSetId,
    verified: false,
  });
  if (existingId) course.id = existingId;

  validateCourse(course, 0);
  return course;
}
