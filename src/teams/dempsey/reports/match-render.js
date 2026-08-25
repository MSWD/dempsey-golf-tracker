// Shared match-card rendering, used by both report-viewer.js (the full season report's Matches
// tab) and match-viewer.js (the single-match share page). Both pages load this script before their
// own, then set `_snapshot` after fetching data/latest.json — keeping the rendering here (instead
// of copy-pasted in each page) means a single-match share link always looks exactly like the same
// match's card in the full report.
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

function computeTeamScore(team) {
  const starterRaws = team.players
    .filter((p) => p.isStarter)
    .map((p) => (entryIsValid(p) ? entryRawScore(p) : null));
  return teamScore(starterRaws);
}

// The lowest individual valid raw score across every player in the match, regardless of team or
// starter status — medalist is an individual stroke-play award, separate from the team-score
// mechanic (which only counts starters). Ties are co-medalists: every player at that score gets
// the badge, not just the first found. Score Only entries (entryRawScore/entryIsValid,
// scoring-engine.js) are just as eligible as By Hole ones.
function computeMedalistScore(match) {
  let lowest = null;
  match.teams.forEach((team) => {
    team.players.forEach((p) => {
      if (!entryIsValid(p)) return;
      const raw = entryRawScore(p);
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
        ${!team.isOwnTeam && team.scoringMode === 'scoreOnly' ? '<span class="badge">score only</span>' : ''}
        ${isWinner ? '<span class="badge win">Winner</span>' : ''}
      </div>
      <div class="table-wrap">
        <table>
          <thead><tr><th>Player</th><th>Starter</th><th>Score</th><th>Putts</th><th>Front3</th><th>Mid3</th><th>Back3</th><th>To Par</th></tr></thead>
          <tbody>
            ${team.players.map((p) => {
              const raw = entryRawScore(p);
              const splits = p.holeScores ? holeSplits(p.holeScores) : { front3: null, mid3: null, back3: null };
              const par = holePars && raw != null ? toPar(raw, roundTotalPar(holePars)) : null;
              const valid = entryIsValid(p);
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
