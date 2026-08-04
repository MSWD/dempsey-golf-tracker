// Static report viewer: reads the single always-current data/latest.json (full rounds/matches
// history — not a point-in-time snapshot) and renders it with the exact same scoring-engine.js
// the live app uses. "Week by week progress" is reconstructed dynamically here, by re-running
// rank/rolling-average with rounds filtered to on-or-before a chosen date, rather than requiring
// a separately-published snapshot per week.
// `_snapshot`, `getCourseById`, `renderFooter`, and the match-card renderers live in
// match-render.js (loaded before this script) so the single-match share page (match-viewer.js)
// renders matches identically without duplicating that logic.

function showView(name) {
  document.querySelectorAll('.view').forEach((el) => el.classList.remove('active'));
  document.querySelectorAll('nav.tabs button').forEach((btn) => btn.classList.remove('active'));
  document.getElementById(`view-report-${name}`).classList.add('active');
  const tab = document.querySelector(`nav.tabs button[data-view="${name}"]`);
  if (tab) tab.classList.add('active');
  if (name === 'matches') renderMatches();
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
    document.querySelector('nav.tabs').classList.add('hidden');
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

  select.addEventListener('change', () => renderRankings(select.value || null));

  document.querySelectorAll('nav.tabs button').forEach((btn) => {
    btn.addEventListener('click', () => showView(btn.dataset.view));
  });

  renderRankings(null);
}

function distinctDates(rounds, matches) {
  const set = new Set([...rounds.map((r) => r.date), ...matches.map((m) => m.date)]);
  return [...set].sort((a, b) => new Date(b) - new Date(a));
}

function renderRankings(asOfDate) {
  const { players, courses, rounds, publishedAt } = _snapshot;
  const getCourseByIdLocal = (id) => courses.find((c) => c.id === id) ?? null;

  const roundsAsOf = asOfDate ? rounds.filter((r) => r.date <= asOfDate) : rounds;
  const activePlayers = players.filter((p) => p.active);
  const extended = TEAM_CONFIG.extendedRankingStats?.enabled;

  const withAverage = activePlayers.map((p) => ({
    ...p,
    ...playerRankingStats(roundsAsOf.filter((r) => r.playerId === p.id), getCourseByIdLocal),
  }));

  const ranked = rankPlayers(withAverage);

  document.getElementById('report-content').innerHTML = `
    <p class="muted">
      Data published ${escapeHtml(publishedAt)}${asOfDate ? ` — showing standings as of ${escapeHtml(asOfDate)}` : ' — latest standings'}.
      Reference/suggestion only, the coach sets the lineup manually.
    </p>
    <div class="table-wrap">
      <table>
        <thead><tr>
          <th>Rank</th><th>Player</th><th>Grade</th><th>Rolling avg (best 4 of last 6)</th>
          ${extended ? '<th>Tryout Avg</th><th>Best</th><th>Rounds</th><th>HCP</th>' : ''}
        </tr></thead>
        <tbody>
          ${ranked.map((p) => `
            <tr class="${p.rank != null && p.rank <= (TEAM_CONFIG.rankHighlightCount || 0) ? 'rank-highlight' : ''}">
              <td>${p.rank != null ? (p.tied ? `T${p.rank}` : p.rank) : '—'}</td>
              <td>${escapeHtml(p.firstName)} ${escapeHtml(p.lastName)}</td>
              <td>${escapeHtml(p.grade)}</td>
              <td>${p.rollingAverage != null ? p.rollingAverage.toFixed(1) : 'No rounds yet'}</td>
              ${extended ? `
                <td>${p.tryoutAverage != null ? p.tryoutAverage.toFixed(1) : ''}</td>
                <td>${p.personalBest != null ? p.personalBest.toFixed(1) : '—'}</td>
                <td class="${roundsCountClass(p.validRoundsCount, TEAM_CONFIG.extendedRankingStats.roundsThresholds)}">${p.validRoundsCount}</td>
                <td>${p.nineHoleHandicap != null ? p.nineHoleHandicap.toFixed(1) : '—'}</td>
              ` : ''}
            </tr>
          `).join('')}
        </tbody>
      </table>
    </div>
  `;
}

function roundsCountClass(count, thresholds) {
  if (count >= thresholds.green) return 'rounds-green';
  if (count >= thresholds.yellow) return 'rounds-yellow';
  return 'rounds-red';
}

// Own team's season W-L-T. A tri-match counts as two separate decisions — one against each
// opponent, compared independently — not one decision for the match as a whole, since the own
// team can beat one opponent and lose to the other in the same match. Only counts a decision once
// both sides of that particular comparison have a complete team score; an incomplete side (own or
// that specific opponent) is skipped rather than guessed, same "don't pad partial data" rule as
// team score itself. Mirrors src/js/ui-matches.js's computeSeasonRecord exactly.
function computeSeasonRecord(matches) {
  let wins = 0;
  let losses = 0;
  let ties = 0;
  matches.forEach((match) => {
    const ownTeam = match.teams.find((t) => t.isOwnTeam);
    if (!ownTeam) return;
    const ownScore = computeTeamScore(ownTeam);
    if (!ownScore.complete) return;
    match.teams.filter((t) => !t.isOwnTeam).forEach((opponent) => {
      const oppScore = computeTeamScore(opponent);
      if (!oppScore.complete) return;
      if (ownScore.total < oppScore.total) wins++;
      else if (ownScore.total > oppScore.total) losses++;
      else ties++;
    });
  });
  return { wins, losses, ties };
}

function renderMatches() {
  const matches = _snapshot.matches.slice().sort((a, b) => new Date(b.date) - new Date(a.date));
  const record = computeSeasonRecord(matches);

  document.getElementById('report-matches-content').innerHTML = `
    <p class="season-record"><strong>Season record:</strong> ${record.wins}-${record.losses}-${record.ties}</p>
    ${matches.length === 0
      ? '<p class="muted">No matches recorded yet.</p>'
      : matches.map((m) => renderMatchCard(m)).join('')}
  `;
}

main();
