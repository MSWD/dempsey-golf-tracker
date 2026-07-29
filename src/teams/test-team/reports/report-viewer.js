// Static report viewer: reads the single always-current data/latest.json (full rounds/matches
// history — not a point-in-time snapshot) and renders it with the exact same scoring-engine.js
// the live app uses. "Week by week progress" is reconstructed dynamically here, by re-running
// rank/rolling-average with rounds filtered to on-or-before a chosen date, rather than requiring
// a separately-published snapshot per week.
let _snapshot = null;

function renderFooter() {
  const footer = document.getElementById('app-footer');
  if (!footer) return;
  const year = new Date().getFullYear();
  footer.innerHTML = `
    <p><strong>&copy; ${year} MSWD &mdash; Montgomery's Software &amp; Web Development</strong></p>
    <p class="muted">${TEAM_CONFIG.siteTitle} &middot; Built with Claude (AI-assisted) &middot; v${APP_VERSION}</p>
  `;
}

async function main() {
  document.getElementById('team-title').textContent = `${TEAM_CONFIG.siteTitle} — Reports`;
  const logo = document.getElementById('team-logo');
  // logoPath is relative to the main app page; this page sits one level deeper, hence the "../"
  // prefix. Optional per team — falls back to the shared golf-green-flag graphic if unset.
  const logoPath = TEAM_CONFIG.logoPath ?? TEAM_CONFIG.iconSpritePath.replace('icons.svg', 'favicon.svg');
  logo.src = `../${logoPath}`;
  logo.alt = TEAM_CONFIG.logoAlt ?? `${TEAM_CONFIG.siteTitle} logo`;
  renderFooter();

  const res = await fetch('data/latest.json');
  if (!res.ok) {
    document.getElementById('report-content').innerHTML = '<p class="muted">No report has been published yet.</p>';
    document.querySelector('.card').classList.add('hidden');
    return;
  }
  _snapshot = await res.json();
  if (_snapshot.seasonName) {
    document.getElementById('team-title').textContent = `${TEAM_CONFIG.siteTitle} — ${_snapshot.seasonName} — Reports`;
  }

  const select = document.getElementById('report-date-select');
  const dates = distinctDates(_snapshot.rounds, _snapshot.matches);
  select.innerHTML = [
    '<option value="">Latest (all data)</option>',
    ...dates.map((d) => `<option value="${escapeHtml(d)}">As of ${escapeHtml(d)}</option>`),
  ].join('');

  select.addEventListener('change', () => render(select.value || null));
  render(null);
}

function distinctDates(rounds, matches) {
  const set = new Set([...rounds.map((r) => r.date), ...matches.map((m) => m.date)]);
  return [...set].sort((a, b) => new Date(b) - new Date(a));
}

function render(asOfDate) {
  const { players, courses, rounds, publishedAt } = _snapshot;
  const getCourseById = (id) => courses.find((c) => c.id === id) ?? null;

  const roundsAsOf = asOfDate ? rounds.filter((r) => r.date <= asOfDate) : rounds;
  const activePlayers = players.filter((p) => p.active);

  const withAverage = activePlayers.map((p) => {
    const chrono = roundsAsOf
      .filter((r) => r.playerId === p.id)
      .sort((a, b) => new Date(a.date) - new Date(b.date))
      .map((r) => {
        const holePars = resolveHolePars(r, getCourseById);
        if (!holePars || !isValidRound(r.holeScores)) return null;
        return adjustedScore(r.holeScores, holePars);
      });
    return { ...p, rollingAverage: rollingAverage(chrono) };
  });

  const ranked = rankPlayers(withAverage);

  document.getElementById('report-content').innerHTML = `
    <p class="muted">
      Data published ${escapeHtml(publishedAt)}${asOfDate ? ` — showing standings as of ${escapeHtml(asOfDate)}` : ' — latest standings'}.
      Reference/suggestion only, the coach sets the lineup manually.
    </p>
    <div class="table-wrap">
      <table>
        <thead><tr><th>Rank</th><th>Player</th><th>Grade</th><th>Rolling avg (best 4 of last 6)</th></tr></thead>
        <tbody>
          ${ranked.map((p) => `
            <tr>
              <td>${p.rank ?? '—'}</td>
              <td>${escapeHtml(p.firstName)} ${escapeHtml(p.lastName)}</td>
              <td>${escapeHtml(p.grade)}</td>
              <td>${p.rollingAverage != null ? p.rollingAverage.toFixed(1) : 'No rounds yet'}</td>
            </tr>
          `).join('')}
        </tbody>
      </table>
    </div>
  `;
}

main();
