// Admin-only "Publish report" flow: commits the full current dataset to reports/data/latest.json
// via the GitHub Contents API, using the token GitHubAuth stored. There's just one always-current
// file, not a snapshot per publish — every round/match already carries a date, so
// reports/report-viewer.js can reconstruct "rank as of any past week" dynamically from the full
// history, using the exact same scoring-engine.js the live app uses.
const GitHubPublish = {
  _apiBase() {
    const { owner, repo } = TEAM_CONFIG.github;
    return `https://api.github.com/repos/${owner}/${repo}/contents`;
  },

  _authHeaders() {
    return {
      Authorization: `Bearer ${GitHubAuth.getStoredToken()}`,
      Accept: 'application/vnd.github+json',
    };
  },

  _toBase64(str) {
    const bytes = new TextEncoder().encode(str);
    const binary = Array.from(bytes, (b) => String.fromCharCode(b)).join('');
    return btoa(binary);
  },

  async _getExistingSha(path) {
    const res = await fetch(`${this._apiBase()}/${path}`, { headers: this._authHeaders() });
    if (res.status === 404) return null;
    if (!res.ok) throw new Error(`Failed to check existing file: ${path}`);
    const data = await res.json();
    return data.sha;
  },

  async _putFile(path, contentObj, message) {
    const sha = await this._getExistingSha(path);
    const body = {
      message,
      content: this._toBase64(JSON.stringify(contentObj, null, 2)),
      branch: TEAM_CONFIG.github.defaultBranch,
    };
    if (sha) body.sha = sha;

    const res = await fetch(`${this._apiBase()}/${path}`, {
      method: 'PUT',
      headers: { ...this._authHeaders(), 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.message || `Failed to write ${path}`);
    }
  },

  async publishSnapshot() {
    if (!AppState.isAdmin) throw new Error('Admin login required to publish.');

    const publishedAt = new Date().toISOString().slice(0, 10);
    const snapshot = {
      publishedAt,
      players: DataStore.getAll('players'),
      courses: DataStore.getAll('courses'),
      rounds: DataStore.getAll('rounds'),
      matches: DataStore.getAll('matches'),
    };

    await this._putFile('reports/data/latest.json', snapshot, `Publish report data as of ${publishedAt}`);

    return `${TEAM_CONFIG.domain}/reports/index.html`;
  },
};
