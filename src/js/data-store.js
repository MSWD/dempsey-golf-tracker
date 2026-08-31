// localStorage persistence: seed-on-first-run, CRUD for each entity type, export/import.
// Namespaced by team slug — multiple teams share this one domain (path-based hosting), and
// browsers scope localStorage by origin, not path, so two teams' data would otherwise collide.
const STORAGE_KEY = `mstgt:data:${TEAM_CONFIG.teamSlug}`;
const SEED_DATA_PATH = 'seed_data.json';
// Separate key from STORAGE_KEY so a corrupt/missing snapshot history never affects loading the
// live season document, and vice versa. See issue #30.
const SNAPSHOTS_KEY = `mstgt:snapshots:${TEAM_CONFIG.teamSlug}`;
const SNAPSHOT_CAP = 20;

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
  // Score Only entries (MatchTeam.scoringMode) carry a single totalScore instead of 9 holeScores —
  // exactly one of the two is present, never both, never neither.
  if (entry.holeScores != null) {
    if (!isHoleScoresArray(entry.holeScores)) fail(path, 'holeScores must be an array of 9 numbers-or-null');
    if (entry.totalScore != null) fail(path, 'totalScore must be null when holeScores is set');
  } else if (!isFiniteNumber(entry.totalScore)) {
    fail(path, 'must have either holeScores (array of 9 numbers-or-null) or a numeric totalScore');
  }
  if (entry.putts != null && !isFiniteNumber(entry.putts)) fail(path, 'putts must be null or a number');
  if (typeof entry.isStarter !== 'boolean') fail(path, 'isStarter must be a boolean');
}

function validateMatchTeam(team, matchPath, ti) {
  const path = `${matchPath}.teams[${ti}]`;
  if (typeof team !== 'object' || team === null) fail(path, 'must be an object');
  if (!isPlainString(team.id)) fail(path, 'id must be a non-empty string');
  if (!isPlainString(team.name)) fail(path, 'name must be a non-empty string');
  if (typeof team.isOwnTeam !== 'boolean') fail(path, 'isOwnTeam must be a boolean');
  // Older exports predate scoringMode entirely — treated as "byHole" at read time (see
  // renderTeamBlock), so it's optional here rather than required.
  if (team.scoringMode != null && !['byHole', 'scoreOnly'].includes(team.scoringMode)) {
    fail(path, 'scoringMode must be null, "byHole", or "scoreOnly"');
  }
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
        // Preserve the rejected data as a snapshot before discarding it. Without this, a
        // validation failure here — even a transient one, like briefly loading a stale cached
        // bundle whose older validator rejects newer-but-valid data — permanently destroys the
        // only copy, with no snapshot to restore from (see issue where exactly this happened).
        // The snapshot itself skips validation (unlike _snapshot(), which assumes this._data
        // already passed it): raw is whatever was in storage, invalid by definition here.
        try {
          this._data = JSON.parse(raw);
          this._snapshot('load-validation-failed');
        } catch {
          // raw wasn't even valid JSON — nothing structured to snapshot.
        }
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

  // --- Local snapshot history (issue #30) -----------------------------------------------------
  // A rolling, local-browser-only safety net: right before importJSON()/reset()/restoreSnapshot()
  // replace the whole document, the outgoing state is pushed here first, so a bad import or a
  // fat-fingered restore can be undone from the Data Maintenance page.

  _loadSnapshots() {
    try {
      const raw = localStorage.getItem(SNAPSHOTS_KEY);
      if (!raw) return [];
      const parsed = JSON.parse(raw);
      return Array.isArray(parsed) ? parsed : [];
    } catch (err) {
      console.error('Stored snapshot history is corrupt — ignoring it.', err);
      return [];
    }
  },

  // The one localStorage write in this file that can plausibly fail (e.g. QuotaExceededError) —
  // wrapped so a storage hiccup here never breaks the import/reset/restore it's piggybacking on.
  _saveSnapshots(list) {
    try {
      localStorage.setItem(SNAPSHOTS_KEY, JSON.stringify(list));
    } catch (err) {
      console.error('Could not save snapshot history (storage may be full) — continuing without it.', err);
    }
  },

  // Captures the CURRENT `this._data` (before the caller mutates it) as a new snapshot, oldest
  // stored first. No deep-clone here is needed: _saveSnapshots() synchronously JSON.stringifies
  // the whole list before this returns, and that string round-trip through localStorage is what
  // decouples the stored copy from `this._data` — don't "fix" this by adding a redundant clone.
  _snapshot(reason) {
    const list = this._loadSnapshots();
    list.push({
      id: makeId('snapshot'),
      version: 1, // bump if the snapshot wrapper shape ever changes
      timestamp: new Date().toISOString(),
      reason,
      data: this._data,
    });
    this._saveSnapshots(list.slice(-SNAPSHOT_CAP));
  },

  // Newest-first, for display. Returns full {id, version, timestamp, reason, data} entries — a
  // season document is only a few KB, so no separate summary/pagination API is needed.
  listSnapshots() {
    return this._loadSnapshots().slice().reverse();
  },

  // Restoring is itself non-destructive: the state immediately prior to the restore is snapshotted
  // first, so restoring is reversible the same way importJSON()/reset() are.
  restoreSnapshot(id) {
    const list = this._loadSnapshots();
    const found = list.find((s) => s.id === id);
    if (!found) throw new Error('Snapshot not found.');
    // Capture `found` before snapshotting — _snapshot() below does its own independent
    // load/evict/save cycle and could otherwise evict this exact entry if the list is already at
    // SNAPSHOT_CAP. found.data isn't re-validated here: it almost always already passed
    // validateImportData() at some earlier point, the one exception being a 'load-validation-failed'
    // snapshot (see init()) — restoring one of those just puts the invalid data back in place for
    // inspection/re-export rather than losing it, so init()'s same catch-and-reset runs again next
    // load if it isn't fixed first.
    this._snapshot('before-restore');
    this._data = found.data;
    this._save();
    return this._data;
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
    this._snapshot('before-import');
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
    this._snapshot('before-reset');
    this._data = emptyData();
    this._save();
    return this._data;
  },
};
