let _chartInstances = [];

function renderChartsView() {
  const el = document.getElementById('view-charts');
  _chartInstances.forEach((c) => c.destroy());
  _chartInstances = [];

  // See viewerRedirectNotice (html-utils.js) / GitHub issue #39 — charts are drawn from the same
  // local rounds as Rank/Rounds, so they're subject to the same "not the team's real data" issue.
  if (!AppState.isAdmin) {
    el.innerHTML = viewerRedirectNotice(
      "Trends shown here are drawn from this browser's local data, which is only meaningful on " +
      "the coach's own browser."
    );
    return;
  }

  const players = DataStore.getAll('players').filter((p) => p.active).sort((a, b) => a.lastName.localeCompare(b.lastName));

  el.innerHTML = `<div class="charts-grid">${players.map((p) => `
    <div class="card">
      <h3>${escapeHtml(p.firstName)} ${escapeHtml(p.lastName)}</h3>
      <canvas id="chart-score-${escapeHtml(p.id)}" height="140"></canvas>
      <canvas id="chart-putts-${escapeHtml(p.id)}" height="140" class="chart-secondary"></canvas>
    </div>
  `).join('')}</div>`;

  players.forEach((p) => {
    const rounds = DataStore.getAll('rounds')
      .filter((r) => r.playerId === p.id)
      .sort((a, b) => new Date(a.date) - new Date(b.date));

    if (rounds.length === 0) return;

    const labels = rounds.map((r) => r.date);
    const adjusted = rounds.map((r) => {
      const holePars = resolveHolePars(r, getCourseById);
      return holePars ? adjustedScore(r.holeScores, holePars) : null;
    });
    const putts = rounds.map((r) => r.putts);

    const scoreCanvas = document.getElementById(`chart-score-${p.id}`);
    _chartInstances.push(new Chart(scoreCanvas, {
      type: 'line',
      data: { labels, datasets: [{ label: 'Adjusted score', data: adjusted, borderColor: TEAM_CONFIG.colors.primary, tension: 0.2 }] },
      options: { plugins: { title: { display: true, text: 'Scoring trend' } } },
    }));

    const puttsCanvas = document.getElementById(`chart-putts-${p.id}`);
    _chartInstances.push(new Chart(puttsCanvas, {
      type: 'line',
      data: { labels, datasets: [{ label: 'Putts', data: putts, borderColor: TEAM_CONFIG.colors.secondary, tension: 0.2 }] },
      options: { plugins: { title: { display: true, text: 'Putts trend' } } },
    }));
  });
}
