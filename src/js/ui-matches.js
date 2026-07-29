// Match-day scoring: 2-3 team blocks per card, hole-by-hole entry, derived team score.
// Each team's `players` entries carry an `isStarter` flag (extension beyond the brief's base
// model) so team score can be computed from the 6 starters only, per rule 5 — alternates never
// count toward it even if they post a score.

function matchHolePars(match) {
  return resolveHolePars(match, getCourseById);
}

// Own team's season W-L-T. A tri-match counts as two separate decisions — one against each
// opponent, compared independently — not one decision for the match as a whole, since the own
// team can beat one opponent and lose to the other in the same match. Only counts a decision once
// both sides of that particular comparison have a complete team score; an incomplete side (own or
// that specific opponent) is skipped rather than guessed, same "don't pad partial data" rule as
// team score itself.
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

function renderMatchesView() {
  const el = document.getElementById('view-matches');
  const courses = DataStore.getAll('courses').slice().sort((a, b) => a.name.localeCompare(b.name));
  const matches = DataStore.getAll('matches').slice().sort((a, b) => new Date(b.date) - new Date(a.date));
  const record = computeSeasonRecord(matches);

  el.innerHTML = `
    <p class="season-record"><strong>Season record:</strong> ${record.wins}-${record.losses}-${record.ties}</p>
    <div class="card admin-only">
      <h2>New match</h2>
      <div class="form-row">
        <input type="date" id="match-date" value="${new Date().toISOString().slice(0, 10)}">
        <select id="match-location">
          <option value="Home">Home</option>
          <option value="Away">Away</option>
        </select>
        <select id="match-course">
          ${courses.map((c) => `<option value="${c.id}">${escapeHtml(c.name)}</option>`).join('')}
        </select>
        <select id="match-side"></select>
        <select id="match-tee-set"></select>
        <select id="match-team-count">
          <option value="2">2 teams</option>
          <option value="3">3 teams</option>
        </select>
      </div>
      <div class="muted" id="match-tee-info"></div>
      <button class="primary" id="btn-add-match">Create match</button>
    </div>
    <div id="matches-list"></div>
  `;

  const matchCourseSelect = el.querySelector('#match-course');
  const matchSideSelect = el.querySelector('#match-side');
  const matchTeeSelect = el.querySelector('#match-tee-set');
  function updateMatchTeeInfo() {
    const course = getCourseById(matchCourseSelect.value);
    const teeSet = findTeeSet(course, matchTeeSelect.value);
    const side = selectedSideForCourse(course, matchSideSelect.value);
    const info = el.querySelector('#match-tee-info');
    if (!course) { info.textContent = ''; return; }
    const par = teeSetTotalPar(course, teeSet, side);
    const yards = teeSet ? teeSetTotalYardage(teeSet, side) : null;
    const sideText = isEighteenHoleCourse(course) ? `${sideLabel(side)} · ` : '';
    info.textContent = teeSet
      ? `${sideText}Par ${par}${yards != null ? `, ${yards} yds` : ''}${teeSet.holeParsOverride ? ' (par differs on this tee)' : ''}`
      : `${sideText}Par ${teeSetTotalPar(course, null, side)} (course default)`;
  }
  updateSideOptions(matchCourseSelect.value, matchSideSelect);
  updateTeeSetOptions(matchCourseSelect.value, matchTeeSelect);
  updateMatchTeeInfo();
  matchCourseSelect.addEventListener('change', () => {
    updateSideOptions(matchCourseSelect.value, matchSideSelect);
    updateTeeSetOptions(matchCourseSelect.value, matchTeeSelect);
    updateMatchTeeInfo();
  });
  matchSideSelect.addEventListener('change', updateMatchTeeInfo);
  matchTeeSelect.addEventListener('change', updateMatchTeeInfo);

  el.querySelector('#btn-add-match').addEventListener('click', () => {
    const date = el.querySelector('#match-date').value;
    const location = el.querySelector('#match-location').value;
    const courseId = matchCourseSelect.value;
    const course = getCourseById(courseId);
    const side = selectedSideForCourse(course, matchSideSelect.value);
    const teeSetId = matchTeeSelect.value || null;
    const teamCount = Number(el.querySelector('#match-team-count').value);
    if (!date || !location || !courseId) {
      alert('Date, location, and course are required.');
      return;
    }
    const teams = Array.from({ length: teamCount }, (_, i) =>
      newMatchTeam({ name: i === 0 ? 'Dempsey' : `Opponent ${i}`, isOwnTeam: i === 0 })
    );
    DataStore.add('matches', newMatch({ date, location, courseId, teeSetId, side, teams }));
    renderMatchesView();
  });

  const list = el.querySelector('#matches-list');
  list.innerHTML = matches.map((m) => renderMatchCard(m)).join('');
  matches.forEach((m) => wireMatchCard(m));
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
  const holePars = matchHolePars(match);
  const teamScores = match.teams.map((team) => ({ team, score: computeTeamScore(team) }));
  // Only declare a winner once at least 2 teams have posted a complete score — with fewer than
  // that there's nothing to compare, so no highlight rather than a premature/misleading one.
  const completeTotals = teamScores.filter((t) => t.score.complete).map((t) => t.score.total);
  const lowestScore = completeTotals.length >= 2 ? Math.min(...completeTotals) : null;
  const medalistScore = computeMedalistScore(match);
  return `
    <div class="card" data-match-id="${match.id}">
      <h3>${match.date} — ${escapeHtml(match.location)} (${course ? escapeHtml(course.name) : 'unknown course'}${course && isEighteenHoleCourse(course) ? ` — ${sideLabel(side)}` : ''}${teeSet ? ` — ${escapeHtml(teeSet.name)} tees` : ''})</h3>
      ${teamScores.map(({ team, score }) =>
        renderTeamBlock(match, team, holePars, side, score, lowestScore != null && score.complete && score.total === lowestScore, medalistScore)
      ).join('')}
    </div>
  `;
}

function renderTeamBlock(match, team, holePars, side, score, isWinner, medalistScore) {
  const players = DataStore.getAll('players').slice().sort((a, b) => a.lastName.localeCompare(b.lastName));

  return `
    <div class="card team-block${isWinner ? ' winning-team' : ''}" data-team-id="${team.id}">
      <div class="form-row">
        <strong>${escapeHtml(team.name)}</strong>
        ${team.isOwnTeam ? '<span class="badge">own team</span>' : ''}
        ${isWinner ? '<span class="badge win">Winner</span>' : ''}
      </div>
      <div class="form-row add-player-row admin-only" data-match-id="${match.id}" data-team-id="${team.id}">
        ${team.isOwnTeam ? `
          <select class="player-select">
            ${players.map((p) => `<option value="${p.id}">${escapeHtml(p.firstName)} ${escapeHtml(p.lastName)}</option>`).join('')}
          </select>
        ` : `
          <input type="text" class="displayname-input" placeholder="Player name">
        `}
        <label class="muted"><input type="checkbox" class="starter-checkbox" checked> Starter</label>
        ${Array.from({ length: 9 }, (_, i) => `<input type="number" class="hole-input" data-hole="${i}" placeholder="H${sideHoleNumber(i, side)}">`).join('')}
        <input type="number" class="putts-input input-narrow" placeholder="Putts">
        <button class="btn-add-team-player">Add score</button>
      </div>
      <div class="table-wrap">
        <table>
          <thead><tr><th>Player</th><th>Starter</th><th>Score</th><th>Putts</th><th>Front3</th><th>Mid3</th><th>Back3</th><th>To Par</th></tr></thead>
          <tbody>
            ${team.players.map((p) => {
              const raw = rawScoreOrNull(p.holeScores);
              const splits = holeSplits(p.holeScores);
              const par = raw != null ? toPar(raw, roundTotalPar(holePars)) : null;
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

function wireMatchCard(match) {
  const card = document.querySelector(`[data-match-id="${match.id}"]`);
  card.querySelectorAll('.add-player-row').forEach((row) => {
    const teamId = row.dataset.teamId;
    row.querySelector('.btn-add-team-player').addEventListener('click', () => {
      const team = match.teams.find((t) => t.id === teamId);
      const isStarter = row.querySelector('.starter-checkbox').checked;

      let playerId = null;
      let displayName;
      if (team.isOwnTeam) {
        playerId = row.querySelector('.player-select').value;
        const player = DataStore.getById('players', playerId);
        displayName = `${player.firstName} ${player.lastName}`;
      } else {
        displayName = row.querySelector('.displayname-input').value.trim();
        if (!displayName) {
          alert('Enter a player name.');
          return;
        }
      }

      const rawInputs = Array.from(row.querySelectorAll('.hole-input')).map((i) => (i.value === '' ? null : Number(i.value)));
      if (!hasAnyHoleScore(rawInputs)) {
        alert('Enter at least one hole score.');
        return;
      }
      const capped = capAllHoleScores(rawInputs, matchHolePars(match));
      const putts = Number(row.querySelector('.putts-input').value) || null;

      team.players.push({ playerId, displayName, holeScores: capped.map((c) => c.value), putts, isStarter });
      DataStore.update('matches', match.id, { teams: match.teams });
      renderMatchesView();
    });
  });
}
