// localStorage persistence: seed-on-first-run, CRUD for each entity type, export/import.
// Namespaced by team slug — multiple teams share this one domain (path-based hosting), and
// browsers scope localStorage by origin, not path, so two teams' data would otherwise collide.
const STORAGE_KEY = `mstgt:data:${TEAM_CONFIG.teamSlug}`;
const SEED_DATA_PATH = 'seed_data.json';

function emptyData() {
  return { seasonName: '', homeCourseId: null, players: [], courses: [], rounds: [], matches: [], tournaments: [] };
}

// --- Import/stored-data validation ------------------------------------------------------------
// Structural/type checks only — deliberately does NOT enforce referential integrity (e.g. a
// round's courseId doesn't have to resolve to a course in the same file). The app already
// tolerates dangling ids gracefully everywhere (findTeeSet, resolveHolePars, the deleted-course
// guards in ui-matches.js) — rejecting an otherwise-valid historical record just because a
// referenced course/tee-set was since removed would be stricter than the app itself, and would
// make a legitimate exported season un-importable after any later deletion.

function fail(path, message) {
  throw new Error(`${path}: ${message}`);
}

function isPlainString(v) {
  return typeof v === 'string' && v.length > 0;
}

function isFiniteNumber(v) {
  return typeof v === 'number' && Number.isFinite(v);
}

function isNumberOrNull(v) {
  return v === null || isFiniteNumber(v);
}

function isNineOrEighteenNumberArray(v) {
  return Array.isArray(v) && (v.length === 9 || v.length === 18) && v.every(isFiniteNumber);
}

function isHoleScoresArray(v) {
  return Array.isArray(v) && v.length === 9 && v.every(isNumberOrNull);
}

const IMPORT_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
function isDateString(v) {
  return typeof v === 'string' && IMPORT_DATE_RE.test(v);
}

function validatePlayer(p, i) {
  const path = `players[${i}]`;
  if (typeof p !== 'object' || p === null) fail(path, 'must be an object');
  if (!isPlainString(p.id)) fail(path, 'id must be a non-empty string');
  if (!isPlainString(p.firstName)) fail(path, 'firstName must be a non-empty string');
  if (!isPlainString(p.lastName)) fail(path, 'lastName must be a non-empty string');
  if (!isFiniteNumber(p.grade)) fail(path, 'grade must be a number');
  if (typeof p.active !== 'boolean') fail(path, 'active must be a boolean');
}

function validateTeeSet(t, coursePath, ti, courseHoleCount) {
  const path = `${coursePath}.teeSets[${ti}]`;
  if (typeof t !== 'object' || t === null) fail(path, 'must be an object');
  if (!isPlainString(t.id)) fail(path, 'id must be a non-empty string');
  if (!isPlainString(t.name)) fail(path, 'name must be a non-empty string');
  if (!isNineOrEighteenNumberArray(t.holeYardages) || t.holeYardages.length !== courseHoleCount) {
    fail(path, `holeYardages must be an array of ${courseHoleCount} numbers`);
  }
  if (t.holeParsOverride != null && (!isNineOrEighteenNumberArray(t.holeParsOverride) || t.holeParsOverride.length !== courseHoleCount)) {
    fail(path, `holeParsOverride must be null or an array of ${courseHoleCount} numbers`);
  }
  if (t.slope != null && !isFiniteNumber(t.slope)) fail(path, 'slope must be null or a number');
  if (t.rating != null && !isFiniteNumber(t.rating)) fail(path, 'rating must be null or a number');
}

function validateCourse(c, i) {
  const path = `courses[${i}]`;
  if (typeof c !== 'object' || c === null) fail(path, 'must be an object');
  if (!isPlainString(c.id)) fail(path, 'id must be a non-empty string');
  if (!isPlainString(c.name)) fail(path, 'name must be a non-empty string');
  if (!isNineOrEighteenNumberArray(c.holePars)) fail(path, 'holePars must be an array of 9 or 18 numbers');
  const teeSets = c.teeSets ?? [];
  if (!Array.isArray(teeSets)) fail(path, 'teeSets must be an array');
  teeSets.forEach((t, ti) => validateTeeSet(t, path, ti, c.holePars.length));
  if (c.defaultTeeSetId != null && typeof c.defaultTeeSetId !== 'string') fail(path, 'defaultTeeSetId must be null or a string');
  if (typeof c.verified !== 'boolean') fail(path, 'verified must be a boolean');
}

function validateRound(r, i) {
  const path = `rounds[${i}]`;
  if (typeof r !== 'object' || r === null) fail(path, 'must be an object');
  if (!isPlainString(r.id)) fail(path, 'id must be a non-empty string');
  if (!isPlainString(r.playerId)) fail(path, 'playerId must be a non-empty string');
  if (!isDateString(r.date)) fail(path, 'date must be a "YYYY-MM-DD" string');
  if (!['tryout', 'practice', 'match'].includes(r.type)) fail(path, 'type must be "tryout", "practice", or "match"');
  if (r.courseId != null && !isPlainString(r.courseId)) fail(path, 'courseId must be null or a non-empty string');
  if (r.inlineHolePars != null && !isNineOrEighteenNumberArray(r.inlineHolePars)) fail(path, 'inlineHolePars must be null or an array of 9 or 18 numbers');
  if (!r.courseId && !r.inlineHolePars) fail(path, 'must have either a courseId or inlineHolePars');
  if (r.teeSetId != null && !isPlainString(r.teeSetId)) fail(path, 'teeSetId must be null or a string');
  if (r.side != null && !['front', 'back'].includes(r.side)) fail(path, 'side must be null, "front", or "back"');
  if (!isHoleScoresArray(r.holeScores)) fail(path, 'holeScores must be an array of 9 numbers-or-null');
  if (r.putts != null && !isFiniteNumber(r.putts)) fail(path, 'putts must be null or a number');
  if (r.matchId != null && !isPlainString(r.matchId)) fail(path, 'matchId must be null or a string');
}

function validateMatchPlayerEntry(entry, path) {
  if (typeof entry !== 'object' || entry === null) fail(path, 'must be an object');
  if (entry.playerId != null && !isPlainString(entry.playerId)) fail(path, 'playerId must be null or a string');
  if (!isPlainString(entry.displayName)) fail(path, 'displayName must be a non-empty string');
  if (!isHoleScoresArray(entry.holeScores)) fail(path, 'holeScores must be an array of 9 numbers-or-null');
  if (entry.putts != null && !isFiniteNumber(entry.putts)) fail(path, 'putts must be null or a number');
  if (typeof entry.isStarter !== 'boolean') fail(path, 'isStarter must be a boolean');
}

function validateMatchTeam(team, matchPath, ti) {
  const path = `${matchPath}.teams[${ti}]`;
  if (typeof team !== 'object' || team === null) fail(path, 'must be an object');
  if (!isPlainString(team.id)) fail(path, 'id must be a non-empty string');
  if (!isPlainString(team.name)) fail(path, 'name must be a non-empty string');
  if (typeof team.isOwnTeam !== 'boolean') fail(path, 'isOwnTeam must be a boolean');
  if (!Array.isArray(team.players)) fail(path, 'players must be an array');
  team.players.forEach((entry, pi) => validateMatchPlayerEntry(entry, `${path}.players[${pi}]`));
}

function validateMatch(m, i) {
  const path = `matches[${i}]`;
  if (typeof m !== 'object' || m === null) fail(path, 'must be an object');
  if (!isPlainString(m.id)) fail(path, 'id must be a non-empty string');
  if (!isDateString(m.date)) fail(path, 'date must be a "YYYY-MM-DD" string');
  if (!['Home', 'Away'].includes(m.location)) fail(path, 'location must be "Home" or "Away"');
  if (m.courseId != null && !isPlainString(m.courseId)) fail(path, 'courseId must be null or a non-empty string');
  if (m.inlineHolePars != null && !isNineOrEighteenNumberArray(m.inlineHolePars)) fail(path, 'inlineHolePars must be null or an array of 9 or 18 numbers');
  if (!m.courseId && !m.inlineHolePars) fail(path, 'must have either a courseId or inlineHolePars');
  if (m.teeSetId != null && !isPlainString(m.teeSetId)) fail(path, 'teeSetId must be null or a string');
  if (m.side != null && !['front', 'back'].includes(m.side)) fail(path, 'side must be null, "front", or "back"');
  if (!Array.isArray(m.teams) || m.teams.length < 2) fail(path, 'teams must be an array of at least 2 teams');
  m.teams.forEach((team, ti) => validateMatchTeam(team, path, ti));
}

function validateImportData(parsed) {
  if (typeof parsed !== 'object' || parsed === null) throw new Error('Invalid import file: not a JSON object.');
  if (parsed.seasonName != null && typeof parsed.seasonName !== 'string') {
    throw new Error('Invalid import file: seasonName must be a string.');
  }
  if (parsed.homeCourseId != null && typeof parsed.homeCourseId !== 'string') {
    throw new Error('Invalid import file: homeCourseId must be null or a string.');
  }
  for (const key of ['players', 'courses', 'rounds', 'matches', 'tournaments']) {
    if (!Array.isArray(parsed[key])) {
      throw new Error(`Invalid import file: missing "${key}" array.`);
    }
  }
  parsed.players.forEach(validatePlayer);
  parsed.courses.forEach(validateCourse);
  parsed.rounds.forEach(validateRound);
  parsed.matches.forEach(validateMatch);
  // tournaments: no feature built yet, nothing to check beyond the array-shape check above.
}

const DataStore = {
  _data: null,

  async init() {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      try {
        const candidate = JSON.parse(raw);
        validateImportData(candidate);
        this._data = {
          seasonName: typeof candidate.seasonName === 'string' ? candidate.seasonName : '',
          homeCourseId: typeof candidate.homeCourseId === 'string' ? candidate.homeCourseId : null,
          players: candidate.players,
          courses: candidate.courses,
          rounds: candidate.rounds,
          matches: candidate.matches,
          tournaments: candidate.tournaments,
        };
      } catch (err) {
        console.error('Stored data failed validation — resetting to empty. Re-import a backup, or use "Reset local data" on the Help page.', err);
        this._data = emptyData();
        this._save();
      }
      return this._data;
    }
    try {
      const res = await fetch(SEED_DATA_PATH);
      const seed = await res.json();
      this._data = {
        seasonName: seed.seasonName ?? '',
        homeCourseId: seed.homeCourseId ?? null,
        players: seed.players ?? [],
        courses: seed.courses ?? [],
        rounds: seed.rounds ?? [],
        matches: seed.matches ?? [],
        tournaments: seed.tournaments ?? [],
      };
    } catch (err) {
      console.warn('Could not load seed data, starting empty.', err);
      this._data = emptyData();
    }
    this._save();
    return this._data;
  },

  _save() {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(this._data));
  },

  getAll(entity) {
    return this._data[entity];
  },

  getSeasonName() {
    return this._data.seasonName || '';
  },

  setSeasonName(name) {
    this._data.seasonName = name;
    this._save();
  },

  getHomeCourseId() {
    return this._data.homeCourseId ?? null;
  },

  setHomeCourseId(courseId) {
    this._data.homeCourseId = courseId ?? null;
    this._save();
  },

  getById(entity, id) {
    return this._data[entity].find((item) => item.id === id) ?? null;
  },

  add(entity, item) {
    this._data[entity].push(item);
    this._save();
    return item;
  },

  update(entity, id, patch) {
    const item = this.getById(entity, id);
    if (!item) return null;
    Object.assign(item, patch);
    this._save();
    return item;
  },

  remove(entity, id) {
    this._data[entity] = this._data[entity].filter((item) => item.id !== id);
    this._save();
  },

  exportJSON() {
    const blob = new Blob([JSON.stringify(this._data, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    const date = new Date().toISOString().slice(0, 10);
    const seasonSlug = this._data.seasonName.trim()
      ? this._data.seasonName.trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '')
      : 'season';
    a.href = url;
    a.download = `${seasonSlug}-${date}.json`;
    a.click();
    URL.revokeObjectURL(url);
  },

  // Full replace, not a merge — whatever's in the file becomes the entirety of local state.
  // Callers should confirm with the coach before invoking this (see app.js's import handler).
  async importJSON(file) {
    const text = await file.text();
    let parsed;
    try {
      parsed = JSON.parse(text);
    } catch {
      throw new Error('Invalid import file: not valid JSON.');
    }
    validateImportData(parsed);
    this._data = {
      seasonName: typeof parsed.seasonName === 'string' ? parsed.seasonName : '',
      homeCourseId: typeof parsed.homeCourseId === 'string' ? parsed.homeCourseId : null,
      players: parsed.players,
      courses: parsed.courses,
      rounds: parsed.rounds,
      matches: parsed.matches,
      tournaments: parsed.tournaments,
    };
    this._save();
    return this._data;
  },

  // Clears all local season data back to a blank state. Deliberately does NOT reseed from
  // seed_data.json — unlike first-run init(), a manually-triggered reset happens on a browser
  // whose data may have long since diverged from the team's original seed file (players
  // graduated, courses corrected, rosters edited), so silently resurrecting that stale starter
  // data would itself look like an unexpected data change, not a clean recovery. Clearing to
  // empty mirrors init()'s own fallback when no usable data exists at all.
  reset() {
    this._data = emptyData();
    this._save();
    return this._data;
  },
};
