// Static report viewer: reads the single always-current data/latest.json (full rounds/matches
// history — not a point-in-time snapshot) and renders it with the exact same scoring-engine.js
// the live app uses. "Week by week progress" is reconstructed dynamically here, by re-running
// rank/rolling-average with rounds filtered to on-or-before a chosen date, rather than requiring
// a separately-published snapshot per week.
let _snapshot = null;

function getCourseById(id) {
  return _snapshot.courses.find((c) => c.id === id) ?? null;
}

function selectedSideForCourse(course, sideValue) {
  return normalizeSide(course, sideValue || 'front');
}

function renderFooter() {
  const footer = document.getElementById('app-footer');
  if (!footer) return;
  const year = new Date().getFullYear();
  footer.innerHTML = `
    <p><strong>&copy; ${year} MSWD &mdash; Montgomery's Software &amp; Web Development</strong></p>
    <p class="muted">${TEAM_CONFIG.siteTitle} &middot; Built with Claude (AI-assisted) &middot; v${APP_VERSION}</p>
  `;
}

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

  const withAverage = activePlayers.map((p) => {
    const chrono = roundsAsOf
      .filter((r) => r.playerId === p.id)
      .sort((a, b) => new Date(a.date) - new Date(b.date))
      .map((r) => {
        const holePars = resolveHolePars(r, getCourseByIdLocal);
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
            <tr class="${p.rank != null && p.rank <= (TEAM_CONFIG.rankHighlightCount || 0) ? 'rank-highlight' : ''}">
              <td>${p.rank != null ? (p.tied ? `T${p.rank}` : p.rank) : '—'}</td>
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

function computeTeamScore(team) {
  const starterRaws = team.players
    .filter((p) => p.isStarter)
    .map((p) => (isValidRound(p.holeScores) ? rawScoreOrNull(p.holeScores) : null));
  return teamScore(starterRaws);
}

// The lowest individual valid raw score across every player in the match, regardless of team or
// starter status — medalist is an individual stroke-play award, separate from the team-score
// mechanic (which only counts starters). Ties are co-medalists: every player at that score gets
// the badge, not just the first found.
function computeMedalistScore(match) {
  let lowest = null;
  match.teams.forEach((team) => {
    team.players.forEach((p) => {
      if (!isValidRound(p.holeScores)) return;
      const raw = rawScoreOrNull(p.holeScores);
      if (raw == null) return;
      if (lowest == null || raw < lowest) lowest = raw;
    });
  });
  return lowest;
}

function renderMatchCard(match) {
  const course = getCourseById(match.courseId);
  const teeSet = findTeeSet(course, match.teeSetId);
  const side = selectedSideForCourse(course, match.side);
  const holePars = resolveHolePars(match, getCourseById);
  const teamScores = match.teams.map((team) => ({ team, score: computeTeamScore(team) }));
  // Only declare a winner once at least 2 teams have posted a complete score — with fewer than
  // that there's nothing to compare, so no highlight rather than a premature/misleading one.
  const completeTotals = teamScores.filter((t) => t.score.complete).map((t) => t.score.total);
  const lowestScore = completeTotals.length >= 2 ? Math.min(...completeTotals) : null;
  const medalistScore = computeMedalistScore(match);
  return `
    <div class="card" data-match-id="${escapeHtml(match.id)}">
      <h3>${escapeHtml(match.date)} — ${escapeHtml(match.location)} (${course ? escapeHtml(course.name) : 'unknown course'}${course && isEighteenHoleCourse(course) ? ` — ${sideLabel(side)}` : ''}${teeSet ? ` — ${escapeHtml(teeSet.name)} tees` : ''})</h3>
      ${holePars == null ? `
        <p class="muted"><span class="badge warn">Course unavailable</span> This match's course
        record can't be found (was it deleted?) — scores below can't be compared to par.</p>
      ` : ''}
      ${teamScores.map(({ team, score }) =>
        renderTeamBlock(team, holePars, score, lowestScore != null && score.complete && score.total === lowestScore, medalistScore)
      ).join('')}
    </div>
  `;
}

function renderTeamBlock(team, holePars, score, isWinner, medalistScore) {
  return `
    <div class="card team-block${isWinner ? ' winning-team' : ''}" data-team-id="${escapeHtml(team.id)}">
      <div class="form-row">
        <strong>${escapeHtml(team.name)}</strong>
        ${team.isOwnTeam ? '<span class="badge">own team</span>' : ''}
        ${isWinner ? '<span class="badge win">Winner</span>' : ''}
      </div>
      <div class="table-wrap">
        <table>
          <thead><tr><th>Player</th><th>Starter</th><th>Score</th><th>Putts</th><th>Front3</th><th>Mid3</th><th>Back3</th><th>To Par</th></tr></thead>
          <tbody>
            ${team.players.map((p) => {
              const raw = rawScoreOrNull(p.holeScores);
              const splits = holeSplits(p.holeScores);
              const par = holePars && raw != null ? toPar(raw, roundTotalPar(holePars)) : null;
              const valid = isValidRound(p.holeScores);
              const isMedalist = valid && raw != null && medalistScore != null && raw === medalistScore;
              return `<tr>
                <td>${escapeHtml(p.displayName)}${isMedalist ? ' <span class="badge medalist" title="Match medalist">🏆</span>' : ''}</td>
                <td>${p.isStarter ? 'Yes' : 'Alt'}</td>
                <td>${raw ?? '—'}${!valid ? ' <span class="badge warn">incomplete</span>' : ''}</td>
                <td>${p.putts ?? '—'}</td>
                <td>${splits.front3 ?? '—'}</td>
                <td>${splits.mid3 ?? '—'}</td>
                <td>${splits.back3 ?? '—'}</td>
                <td>${par != null ? (par > 0 ? `+${par}` : par) : '—'}</td>
              </tr>`;
            }).join('')}
          </tbody>
        </table>
      </div>
      <p><strong>Team score:</strong> ${score.complete ? score.total : `Incomplete — only ${score.scoresUsed} of the 6 starters have posted a score`}</p>
    </div>
  `;
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
