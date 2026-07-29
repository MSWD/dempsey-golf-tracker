function getCourseById(id) {
  return DataStore.getById('courses', id);
}

// Repopulates a tee-set <select>'s options in place (never replaces the element, so its own
// change listener survives) for whichever course is currently selected. Shared by ui-rounds.js
// and ui-matches.js (defined here, alongside getCourseById, so both files' load order is safe).
function updateTeeSetOptions(courseId, selectEl) {
  const course = getCourseById(courseId);
  const teeSets = course ? (course.teeSets || []) : [];
  selectEl.disabled = teeSets.length === 0;
  selectEl.innerHTML = teeSets.length === 0
    ? '<option value="">No tee data</option>'
    : ['<option value="">— no tee set —</option>', ...teeSets.map((t) => `<option value="${t.id}">${escapeHtml(t.name)}</option>`)].join('');
  // Pre-select the course's default tee set, if it has one set and it still exists — which tee is
  // "usual" varies per course (not every course defaults to the same yellow/gold tee), so this is
  // per-course rather than a single app-wide default.
  if (course && course.defaultTeeSetId && teeSets.some((t) => t.id === course.defaultTeeSetId)) {
    selectEl.value = course.defaultTeeSetId;
  }
}

// Chronological adjusted scores for a player, oldest first (tryouts naturally sort first by date).
function playerAdjustedScores(playerId) {
  return DataStore.getAll('rounds')
    .filter((r) => r.playerId === playerId)
    .sort((a, b) => new Date(a.date) - new Date(b.date))
    .map((r) => {
      const holePars = resolveHolePars(r, getCourseById);
      if (!holePars || !isValidRound(r.holeScores)) return null;
      return adjustedScore(r.holeScores, holePars);
    });
}

function renderRoundsView(warningMessage) {
  const el = document.getElementById('view-rounds');
  const players = DataStore.getAll('players').filter((p) => p.active).sort((a, b) => a.lastName.localeCompare(b.lastName));
  const courses = DataStore.getAll('courses').slice().sort((a, b) => a.name.localeCompare(b.name));
  const rounds = DataStore.getAll('rounds').slice().sort((a, b) => new Date(b.date) - new Date(a.date));

  el.innerHTML = `
    <div class="card admin-only">
      <h2>Log a round</h2>
      <div class="form-row">
        <select id="round-player">
          ${players.map((p) => `<option value="${p.id}">${escapeHtml(p.firstName)} ${escapeHtml(p.lastName)}</option>`).join('')}
        </select>
        <select id="round-type">
          <option value="tryout">Tryout</option>
          <option value="practice">Practice</option>
        </select>
        <select id="round-course">
          ${courses.map((c) => `<option value="${c.id}">${escapeHtml(c.name)}</option>`).join('')}
        </select>
        <select id="round-tee-set"></select>
        <input type="date" id="round-date" value="${new Date().toISOString().slice(0, 10)}">
      </div>
      <div class="muted" id="round-tee-info"></div>
      <div class="form-row" id="round-holes">
        ${Array.from({ length: 9 }, (_, i) => `<input type="number" class="hole-input" data-hole="${i}" placeholder="H${i + 1}">`).join('')}
        <input type="number" id="round-putts" class="input-narrow" placeholder="Putts">
      </div>
      <button class="primary" id="btn-add-round">Save round</button>
      <div class="muted" id="round-warning">${warningMessage ?? ''}</div>
    </div>
    <div class="table-wrap">
      <table>
        <thead>
          <tr><th>Date</th><th>Player</th><th>Type</th><th>Course</th><th>Tee</th><th>Holes</th><th>Raw</th><th>Adjusted</th></tr>
        </thead>
        <tbody id="rounds-rows"></tbody>
      </table>
    </div>
  `;

  const roundCourseSelect = el.querySelector('#round-course');
  const roundTeeSelect = el.querySelector('#round-tee-set');
  function updateRoundTeeInfo() {
    const course = getCourseById(roundCourseSelect.value);
    const teeSet = findTeeSet(course, roundTeeSelect.value);
    const info = el.querySelector('#round-tee-info');
    if (!course) { info.textContent = ''; return; }
    const par = teeSetTotalPar(course, teeSet);
    const yards = teeSet ? teeSetTotalYardage(teeSet) : null;
    info.textContent = teeSet
      ? `Par ${par}${yards != null ? `, ${yards} yds` : ''}${teeSet.holeParsOverride ? ' (par differs on this tee)' : ''}`
      : `Par ${course.totalPar} (course default)`;
  }
  updateTeeSetOptions(roundCourseSelect.value, roundTeeSelect);
  updateRoundTeeInfo();
  roundCourseSelect.addEventListener('change', () => {
    updateTeeSetOptions(roundCourseSelect.value, roundTeeSelect);
    updateRoundTeeInfo();
  });
  roundTeeSelect.addEventListener('change', updateRoundTeeInfo);

  const rows = el.querySelector('#rounds-rows');
  rows.innerHTML = rounds.map((r) => {
    const player = DataStore.getById('players', r.playerId);
    const course = getCourseById(r.courseId);
    const teeSet = findTeeSet(course, r.teeSetId);
    const holePars = resolveHolePars(r, getCourseById);
    const raw = rawScoreOrNull(r.holeScores);
    const holesPlayed = holesPlayedCount(r.holeScores);
    const valid = isValidRound(r.holeScores);
    const adj = holePars && valid ? adjustedScore(r.holeScores, holePars) : null;
    return `
      <tr>
        <td>${r.date}</td>
        <td>${player ? `${escapeHtml(player.firstName)} ${escapeHtml(player.lastName)}` : '—'}</td>
        <td>${r.type}</td>
        <td>${course ? escapeHtml(course.name) : '—'}</td>
        <td>${teeSet ? escapeHtml(teeSet.name) : '—'}</td>
        <td>${holesPlayed}${!valid ? ' <span class="badge warn">incomplete</span>' : ''}</td>
        <td>${raw ?? '—'}</td>
        <td>${adj != null ? adj.toFixed(1) : '—'}</td>
      </tr>
    `;
  }).join('');

  el.querySelector('#btn-add-round').addEventListener('click', () => {
    const playerId = el.querySelector('#round-player').value;
    const type = el.querySelector('#round-type').value;
    const courseId = roundCourseSelect.value;
    const teeSetId = roundTeeSelect.value || null;
    const date = el.querySelector('#round-date').value;
    const putts = Number(el.querySelector('#round-putts').value) || null;

    if (!playerId || !courseId || !date) {
      alert('Player, course, and date are required.');
      return;
    }

    const course = getCourseById(courseId);
    const teeSet = findTeeSet(course, teeSetId);
    const rawInputs = Array.from(el.querySelectorAll('#round-holes .hole-input'))
      .map((i) => (i.value === '' ? null : Number(i.value)));

    if (!hasAnyHoleScore(rawInputs)) {
      alert('Enter at least one hole score.');
      return;
    }

    const capped = capAllHoleScores(rawInputs, teeSetEffectiveHolePars(course, teeSet));
    const anyCapped = capped.some((c) => c.wasCapped);
    const holeScores = capped.map((c) => c.value);

    DataStore.add('rounds', newRound({ playerId, date, type, courseId, teeSetId, holeScores, putts }));

    renderRoundsView(anyCapped ? 'Note: one or more hole scores exceeded double-par and were capped.' : null);
  });
}

function renderRankView() {
  const el = document.getElementById('view-rank');
  const players = DataStore.getAll('players').filter((p) => p.active);

  const withAverage = players.map((p) => ({
    ...p,
    rollingAverage: rollingAverage(playerAdjustedScores(p.id)),
  }));
  const ranked = rankPlayers(withAverage);

  el.innerHTML = `
    <p class="muted">Reference/suggestion only — the coach always sets the full lineup order manually.</p>
    <div class="table-wrap">
      <table>
        <thead><tr><th>Rank</th><th>Player</th><th>Grade</th><th>Rolling avg (best 4 of last 6)</th></tr></thead>
        <tbody>
          ${ranked.map((p) => `
            <tr>
              <td>${p.rank ?? '—'}</td>
              <td>${escapeHtml(p.firstName)} ${escapeHtml(p.lastName)}</td>
              <td>${p.grade}</td>
              <td>${p.rollingAverage != null ? p.rollingAverage.toFixed(1) : 'No rounds yet'}</td>
            </tr>
          `).join('')}
        </tbody>
      </table>
    </div>
  `;
}
