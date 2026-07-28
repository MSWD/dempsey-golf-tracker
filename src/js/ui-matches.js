// Match-day scoring: 2-3 team blocks per card, hole-by-hole entry, derived team score.
// Each team's `players` entries carry an `isStarter` flag (extension beyond the brief's base
// model) so team score can be computed from the 6 starters only, per rule 5 — alternates never
// count toward it even if they post a score.

function matchHolePars(match) {
  if (match.inlineHolePars) return match.inlineHolePars;
  const course = getCourseById(match.courseId);
  return course ? course.holePars : null;
}

function renderMatchesView() {
  const el = document.getElementById('view-matches');
  const courses = DataStore.getAll('courses').slice().sort((a, b) => a.name.localeCompare(b.name));
  const matches = DataStore.getAll('matches').slice().sort((a, b) => new Date(b.date) - new Date(a.date));

  el.innerHTML = `
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
        <select id="match-team-count">
          <option value="2">2 teams</option>
          <option value="3">3 teams</option>
        </select>
      </div>
      <button class="primary" id="btn-add-match">Create match</button>
    </div>
    <div id="matches-list"></div>
  `;

  el.querySelector('#btn-add-match').addEventListener('click', () => {
    const date = el.querySelector('#match-date').value;
    const location = el.querySelector('#match-location').value;
    const courseId = el.querySelector('#match-course').value;
    const teamCount = Number(el.querySelector('#match-team-count').value);
    if (!date || !location || !courseId) {
      alert('Date, location, and course are required.');
      return;
    }
    const teams = Array.from({ length: teamCount }, (_, i) =>
      newMatchTeam({ name: i === 0 ? 'Dempsey' : `Opponent ${i}`, isOwnTeam: i === 0 })
    );
    DataStore.add('matches', newMatch({ date, location, courseId, teams }));
    renderMatchesView();
  });

  const list = el.querySelector('#matches-list');
  list.innerHTML = matches.map((m) => renderMatchCard(m)).join('');
  matches.forEach((m) => wireMatchCard(m));
}

function renderMatchCard(match) {
  const course = getCourseById(match.courseId);
  const holePars = matchHolePars(match);
  return `
    <div class="card" data-match-id="${match.id}">
      <h3>${match.date} — ${escapeHtml(match.location)} (${course ? escapeHtml(course.name) : 'unknown course'})</h3>
      ${match.teams.map((team) => renderTeamBlock(match, team, holePars)).join('')}
    </div>
  `;
}

function renderTeamBlock(match, team, holePars) {
  const players = DataStore.getAll('players').slice().sort((a, b) => a.lastName.localeCompare(b.lastName));
  const starterRaws = team.players
    .filter((p) => p.isStarter)
    .map((p) => (isValidRound(p.holeScores) ? rawScoreOrNull(p.holeScores) : null));
  const score = teamScore(starterRaws);

  return `
    <div class="card" style="background:#fafaf6" data-team-id="${team.id}">
      <div class="form-row">
        <strong>${escapeHtml(team.name)}</strong>
        ${team.isOwnTeam ? '<span class="badge">own team</span>' : ''}
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
        ${Array.from({ length: 9 }, (_, i) => `<input type="number" class="hole-input" data-hole="${i}" placeholder="H${i + 1}">`).join('')}
        <input type="number" class="putts-input" placeholder="Putts" style="width:70px">
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
              return `<tr>
                <td>${escapeHtml(p.displayName)}</td>
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
      const course = getCourseById(match.courseId);
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
      const capped = capAllHoleScores(rawInputs, course.holePars);
      const putts = Number(row.querySelector('.putts-input').value) || null;

      team.players.push({ playerId, displayName, holeScores: capped.map((c) => c.value), putts, isStarter });
      DataStore.update('matches', match.id, { teams: match.teams });
      renderMatchesView();
    });
  });
}
