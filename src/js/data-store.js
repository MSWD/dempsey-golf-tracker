// localStorage persistence: seed-on-first-run, CRUD for each entity type, export/import.
// Namespaced by team slug — multiple teams share this one domain (path-based hosting), and
// browsers scope localStorage by origin, not path, so two teams' data would otherwise collide.
const STORAGE_KEY = `mstgt:data:${TEAM_CONFIG.teamSlug}`;
const SEED_DATA_PATH = 'seed_data.json';

function emptyData() {
  return { players: [], courses: [], rounds: [], matches: [], tournaments: [] };
}

const DataStore = {
  _data: null,

  async init() {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      this._data = JSON.parse(raw);
      return this._data;
    }
    try {
      const res = await fetch(SEED_DATA_PATH);
      const seed = await res.json();
      this._data = {
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
    a.href = url;
    a.download = `dempsey-golf-data-${date}.json`;
    a.click();
    URL.revokeObjectURL(url);
  },

  async importJSON(file) {
    const text = await file.text();
    const parsed = JSON.parse(text);
    for (const key of ['players', 'courses', 'rounds', 'matches', 'tournaments']) {
      if (!Array.isArray(parsed[key])) {
        throw new Error(`Invalid import file: missing "${key}" array.`);
      }
    }
    this._data = {
      players: parsed.players,
      courses: parsed.courses,
      rounds: parsed.rounds,
      matches: parsed.matches,
      tournaments: parsed.tournaments,
    };
    this._save();
    return this._data;
  },
};
