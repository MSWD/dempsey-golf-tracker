// Admin-only "Publish report" flow. Under path-based multi-team hosting, the actual GitHub write
// happens server-side in the Cloudflare Worker (worker/cloudflare-device-flow-relay.js), not here —
// this just calls the Worker's /publish endpoint with the caller's own token (used there only to
// identify who's calling, checked against src/teams.json) and lets the Worker's own credential
// make the commit. See docs/auth-and-publishing.md for why: one shared repo means GitHub's repo
// permissions can't scope "admin for team X," so that has to be enforced somewhere non-spoofable.
const GitHubPublish = {
  async publishSnapshot() {
    if (!AppState.isAdmin) throw new Error('Admin login required to publish.');

    const publishedAt = new Date().toISOString().slice(0, 10);
    const players = DataStore.getAll('players');
    const playersById = new Map(players.map((p) => [p.id, p]));

    // This repo (and everything it publishes) is public, so full last names never leave the
    // coach's own browser. Roster players get abbreviated here; match entries re-derive their
    // displayName from the (now-abbreviated) roster record rather than trusting whatever full name
    // was baked in at entry time. Free-text entries with no playerId (extra/opponent players) are
    // left as typed — the coach should keep those abbreviated too, see the Help page.
    const abbreviatedPlayers = players.map((p) => ({
      ...p,
      lastName: abbreviatedLastName(p, players),
    }));
    const matches = DataStore.getAll('matches').map((match) => ({
      ...match,
      teams: match.teams.map((team) => ({
        ...team,
        players: team.players.map((entry) => {
          const rosterPlayer = entry.playerId ? playersById.get(entry.playerId) : null;
          if (!rosterPlayer) return entry;
          return { ...entry, displayName: publicDisplayName(rosterPlayer, players) };
        }),
      })),
    }));

    const snapshot = {
      publishedAt,
      players: abbreviatedPlayers,
      courses: DataStore.getAll('courses'),
      rounds: DataStore.getAll('rounds'),
      matches,
    };

    const res = await fetch(`${TEAM_CONFIG.githubApp.deviceFlowWorkerUrl}/publish`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${GitHubAuth.getStoredToken()}`,
      },
      body: JSON.stringify({
        teamSlug: TEAM_CONFIG.teamSlug,
        path: `src/teams/${TEAM_CONFIG.teamSlug}/reports/data/latest.json`,
        content: snapshot,
        message: `Publish report data for ${TEAM_CONFIG.teamSlug} as of ${publishedAt}`,
      }),
    });

    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.error || 'Failed to publish report');
    }

    return `${TEAM_CONFIG.domain}/reports/index.html`;
  },
};
