// Single source of truth for all scoring math. Pure functions only — no localStorage, no DOM —
// so both the live app and the static report viewer can run the exact same logic against
// different data sources (live localStorage vs. a fetched snapshot JSON).

// Minimum holes a player must actually complete for a round/match score to count at all — per
// local OHSAA rule. Coach is confirming the exact number (5 vs 6); change this one constant once
// confirmed rather than hunting for the number elsewhere.
const MIN_HOLES_FOR_VALID_ROUND = 5;

function holesPlayedCount(holeScores) {
  return holeScores.filter((s) => s != null).length;
}

// A round/match score with fewer holes played than the minimum doesn't count toward rolling
// average or team score — distinct from the double-par cap, which caps a single hole's value but
// doesn't invalidate the round.
function isValidRound(holeScores) {
  return holesPlayedCount(holeScores) >= MIN_HOLES_FOR_VALID_ROUND;
}

function roundTotalPar(holePars) {
  return holePars.reduce((sum, par) => sum + par, 0);
}

function sideStartIndex(side) {
  return side === 'back' ? 9 : 0;
}

function sideLabel(side) {
  return side === 'back' ? 'Back 9' : 'Front 9';
}

function sideHoleNumber(index, side) {
  return sideStartIndex(side) + index + 1;
}

function courseHoleCount(course) {
  return course && Array.isArray(course.holePars) ? course.holePars.length : 0;
}

function isEighteenHoleCourse(course) {
  return courseHoleCount(course) >= 18;
}

function courseSides(course) {
  return isEighteenHoleCourse(course) ? ['front', 'back'] : ['front'];
}

function normalizeSide(course, side) {
  return isEighteenHoleCourse(course) && side === 'back' ? 'back' : 'front';
}

function sideValues(values, side) {
  if (!Array.isArray(values)) return null;
  if (values.length <= 9) return values;
  return values.slice(sideStartIndex(side), sideStartIndex(side) + 9);
}

function sideTotal(values, side) {
  const sliced = sideValues(values, side);
  if (!sliced) return null;
  return sliced.reduce((sum, value) => sum + (value ?? 0), 0);
}

// Finds a course's tee set by id; null if the course has none, teeSetId is unset, or the tee set
// has since been removed (rounds/matches keep a dangling id in that case — this is the graceful
// fallback path, matching the app's general lack of referential-integrity checks on removal).
function findTeeSet(course, teeSetId) {
  if (!course || !teeSetId) return null;
  return (course.teeSets || []).find((t) => t.id === teeSetId) ?? null;
}

// The hole pars that actually apply for a given tee set: its own override for the rare
// different-par-on-this-tee case, else the course's base pars. teeSet may be null (no tee set
// selected, or the course has none) — falls back to the course's base pars either way.
function teeSetEffectiveHolePars(course, teeSet, side = 'front') {
  if (!course) return null;
  const normalizedSide = normalizeSide(course, side);
  const pars = (teeSet && teeSet.holeParsOverride) ? teeSet.holeParsOverride : course.holePars;
  return sideValues(pars, normalizedSide);
}

// Computed on read rather than precomputed like Course.totalPar — a tee set's effective par
// depends on an override that feeds directly into the double-par cap / adjusted-score math, so it
// stays a single live source of truth instead of a cached value that could drift.
function teeSetTotalPar(course, teeSet, side = 'front') {
  const pars = teeSetEffectiveHolePars(course, teeSet, side);
  return pars ? roundTotalPar(pars) : null;
}

function teeSetTotalYardage(teeSet, side = 'front') {
  if (!teeSet || !teeSet.holeYardages) return null;
  return sideTotal(teeSet.holeYardages, side);
}

// A hole score can never exceed 2x that hole's par. Returns the capped value and whether capping
// actually changed anything, so callers can warn on entry without silently losing the raw input.
function capHoleScore(score, par) {
  const max = par * 2;
  return {
    value: Math.min(score, max),
    wasCapped: score > max,
  };
}

function capAllHoleScores(holeScores, holePars) {
  return holeScores.map((score, i) =>
    score == null ? { value: null, wasCapped: false } : capHoleScore(score, holePars[i])
  );
}

function hasAnyHoleScore(holeScores) {
  return holeScores.some((score) => score != null);
}

// Raw score = sum of entered hole scores. Holes with no score recorded are excluded, not treated
// as zero — a round with zero holes entered has no raw score at all (see rawScoreOrNull).
function rawScoreOrNull(holeScores) {
  if (!hasAnyHoleScore(holeScores)) return null;
  return holeScores.reduce((sum, score) => sum + (score ?? 0), 0);
}

// adjusted_score = raw_score + (36 - round_total_par). Normalizes any 9-hole par card to a
// par-36 baseline so rounds on different courses (e.g. a par-28 executive course) compare fairly.
function adjustedScore(holeScores, holePars) {
  const raw = rawScoreOrNull(holeScores);
  if (raw == null) return null;
  return raw + (36 - roundTotalPar(holePars));
}

// Resolves the 9 hole pars that apply to a round or match, given a course lookup function.
// inlineHolePars (an escape hatch on both models) wins outright; otherwise falls back through the
// entity's selected tee set (if any), selected side, and then to the course's base pars.
function resolveHolePars(entity, getCourseById) {
  if (entity.inlineHolePars) return sideValues(entity.inlineHolePars, entity.side);
  const course = getCourseById(entity.courseId);
  if (!course) return null;
  return teeSetEffectiveHolePars(course, findTeeSet(course, entity.teeSetId), entity.side);
}

// Best 4 of the player's last 6 rounds (chronologically, tryouts count as the earliest entries),
// using adjusted scores. Fewer than 6 rounds → average whatever exists, no drops.
function rollingAverage(chronologicalAdjustedScores) {
  const scored = chronologicalAdjustedScores.filter((s) => s != null);
  if (scored.length === 0) return null;

  const lastSix = scored.slice(-6);
  if (lastSix.length < 6) {
    return lastSix.reduce((sum, s) => sum + s, 0) / lastSix.length;
  }

  const best4 = [...lastSix].sort((a, b) => a - b).slice(0, 4);
  return best4.reduce((sum, s) => sum + s, 0) / best4.length;
}

// Ascending sort on rolling average (lower is better). Reference/suggestion only — the coach
// always manually sets the lineup order for a match; this is never auto-applied.
function rankPlayers(playersWithAverage) {
  const ranked = [...playersWithAverage].filter((p) => p.rollingAverage != null);
  const unranked = [...playersWithAverage].filter((p) => p.rollingAverage == null);
  ranked.sort((a, b) => a.rollingAverage - b.rollingAverage);
  return [
    ...ranked.map((p, i) => ({ ...p, rank: i + 1 })),
    ...unranked.map((p) => ({ ...p, rank: null })),
  ];
}

// Team score = sum of the 4 lowest raw scores among the 6 starters who actually posted a score
// that day. Fewer than 4 posted → explicitly incomplete, never a partial/padded sum.
function teamScore(starterRawScores) {
  const posted = starterRawScores.filter((s) => s != null);
  if (posted.length < 4) {
    return { complete: false, total: null, scoresUsed: posted.length };
  }
  const lowest4 = [...posted].sort((a, b) => a - b).slice(0, 4);
  return { complete: true, total: lowest4.reduce((sum, s) => sum + s, 0), scoresUsed: 4 };
}

// Front-3 / mid-3 / back-3 splits for a 9-hole round.
function holeSplits(holeScores) {
  const sum = (slice) => (slice.some((s) => s != null) ? slice.reduce((s, v) => s + (v ?? 0), 0) : null);
  return {
    front3: sum(holeScores.slice(0, 3)),
    mid3: sum(holeScores.slice(3, 6)),
    back3: sum(holeScores.slice(6, 9)),
  };
}

function toPar(rawScore, totalPar) {
  if (rawScore == null) return null;
  return rawScore - totalPar;
}
