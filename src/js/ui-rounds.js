// Lives at module scope (not inside renderRoundsView) so selections survive a re-render — the
// view gets rebuilt from scratch on every save/edit/cancel, but the filter should feel persistent
// for the length of the session. Resets on page reload, which is the intended scope.
const roundsFilterState = { playerId: '', type: '', courseId: '', dateFrom: '', dateTo: '' };

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
    : ['<option value="">— no tee set —</option>', ...teeSets.map((t) => `<option value="${escapeHtml(t.id)}">${escapeHtml(t.name)}</option>`)].join('');
  // Pre-select the course's default tee set, if it has one set and it still exists — which tee is
  // "usual" varies per course (not every course defaults to the same yellow/gold tee), so this is
  // per-course rather than a single app-wide default.
  if (course && course.defaultTeeSetId && teeSets.some((t) => t.id === course.defaultTeeSetId)) {
    selectEl.value = course.defaultTeeSetId;
  }
}

function updateSideOptions(courseId, selectEl) {
  const course = getCourseById(courseId);
  const sides = courseSides(course);
  selectEl.disabled = sides.length === 1;
  selectEl.innerHTML = sides.map((side) => `<option value="${side}">${sideLabel(side)}</option>`).join('');
  selectEl.value = sides[0];
}

function selectedSideForCourse(course, sideValue) {
  return normalizeSide(course, sideValue || 'front');
}

// Keeps each hole-input's placeholder and the scorecard-style reference block above it (Hole
// numbers + Par row, desktop/iPad-landscape only — see .scorecard-row in styles.css) in sync with
// the current course/side/tee selection. `side` drives hole numbering (front vs back nine) for
// both; `holePars` is null before a course is picked, which blanks the Par row rather than leaving
// stale pars behind from a since-abandoned selection.
function updateHoleReferenceRow(container, side, holePars) {
  container.querySelectorAll('.hole-input').forEach((input, i) => {
    input.placeholder = `H${sideHoleNumber(i, side)}`;
  });
  container.querySelectorAll('.hole-number-cell').forEach((cell, i) => {
    cell.textContent = sideHoleNumber(i, side);
  });
  container.querySelectorAll('.hole-par-cell').forEach((cell, i) => {
    cell.textContent = holePars ? holePars[i] : '';
  });
}

function renderRoundsView(warningMessage, editingRoundId) {
  const el = document.getElementById('view-rounds');

  // See viewerRedirectNotice (html-utils.js) / GitHub issue #39 — same reasoning as renderRankView
  // below: a viewer's local rounds are essentially never the team's actual rounds.
  if (!AppState.isAdmin) {
    el.innerHTML = viewerRedirectNotice(
      "Rounds shown here are only meaningful from the coach's own browser — this device's local " +
      "data likely isn't in sync with the team's."
    );
    return;
  }

  const players = DataStore.getAll('players').filter((p) => p.active).sort((a, b) => a.lastName.localeCompare(b.lastName));
  // Unlike the log-round form's player list above, filtering needs every player who could own a
  // historical round, including ones since marked inactive — otherwise their old rounds become
  // impossible to isolate in the table.
  const allPlayers = DataStore.getAll('players').slice().sort((a, b) => a.lastName.localeCompare(b.lastName));
  const courses = DataStore.getAll('courses').slice().sort((a, b) => a.name.localeCompare(b.name));
  const rounds = DataStore.getAll('rounds').slice().sort((a, b) => new Date(b.date) - new Date(a.date));
  const editingRound = editingRoundId ? DataStore.getById('rounds', editingRoundId) : null;

  el.innerHTML = `
    <div class="card admin-only">
      <h2>${editingRound ? 'Edit a round' : 'Log a round'}</h2>
      <div class="form-row">
        <select id="round-player">
          <option value="">— select a player —</option>
          ${players.map((p) => `<option value="${escapeHtml(p.id)}">${escapeHtml(p.firstName)} ${escapeHtml(p.lastName)}</option>`).join('')}
        </select>
        <select id="round-type">
          <option value="tryout">Tryout</option>
          <option value="practice">Practice</option>
        </select>
        <select id="round-course">
          <option value="">— select a course —</option>
          ${courses.map((c) => `<option value="${escapeHtml(c.id)}">${escapeHtml(c.name)}</option>`).join('')}
        </select>
        <select id="round-side"></select>
        <select id="round-tee-set"></select>
        <input type="date" id="round-date" value="${editingRound ? escapeHtml(editingRound.date) : new Date().toISOString().slice(0, 10)}">
      </div>
      <div id="round-entry-fields" class="${editingRound ? '' : 'hidden'}">
        <div class="muted" id="round-tee-info"></div>
        <div class="form-row" id="round-holes">
          <div class="hole-entry-group">
            <div class="scorecard-row scorecard-hole-row">
              <span class="scorecard-cell scorecard-label-cell">Hole</span>
              ${Array.from({ length: 9 }, (_, i) => `<span class="scorecard-cell hole-number-cell">${i + 1}</span>`).join('')}
            </div>
            <div class="scorecard-row scorecard-par-row">
              <span class="scorecard-cell scorecard-label-cell">Par</span>
              ${Array.from({ length: 9 }, () => `<span class="scorecard-cell hole-par-cell"></span>`).join('')}
            </div>
            <div class="scorecard-row scorecard-score-row">
              <span class="scorecard-cell scorecard-label-cell">Score</span>
              <div class="hole-scores">
                ${Array.from({ length: 9 }, (_, i) => renderStepperInput({
                  className: 'hole-input', dataAttrs: `data-hole="${i}"`, placeholder: `H${i + 1}`,
                  value: editingRound && editingRound.holeScores[i] != null ? editingRound.holeScores[i] : '', min: 1,
                })).join('')}
              </div>
            </div>
          </div>
          <input type="text" inputmode="numeric" id="round-putts" class="input-narrow" placeholder="Putts" value="${editingRound && editingRound.putts != null ? editingRound.putts : ''}">
        </div>
        <button class="primary" id="btn-add-round">${editingRound ? 'Update round' : 'Save round'}</button>
        ${editingRound ? '<button id="btn-cancel-edit">Cancel</button>' : ''}
        <div class="muted" id="round-warning">${warningMessage ?? ''}</div>
      </div>
    </div>
    <p class="muted">Click a row to see hole-by-hole detail<span class="admin-only"> and edit</span>.</p>
    <div class="form-row" id="rounds-filter">
      <select id="filter-player">
        <option value="">All players</option>
        ${allPlayers.map((p) => `<option value="${escapeHtml(p.id)}">${escapeHtml(p.firstName)} ${escapeHtml(p.lastName)}</option>`).join('')}
      </select>
      <select id="filter-type">
        <option value="">All types</option>
        <option value="tryout">Tryout</option>
        <option value="practice">Practice</option>
        <option value="match">Match</option>
      </select>
      <select id="filter-course">
        <option value="">All courses</option>
        ${courses.map((c) => `<option value="${escapeHtml(c.id)}">${escapeHtml(c.name)}</option>`).join('')}
      </select>
      <label class="muted">From <input type="date" id="filter-date-from"></label>
      <label class="muted">To <input type="date" id="filter-date-to"></label>
      <button id="btn-clear-filters">Clear filters</button>
    </div>
    <p class="muted" id="rounds-filter-count"></p>
    <div class="table-wrap">
      <table>
        <thead>
          <tr><th>Date</th><th>Player</th><th>Type</th><th>Course</th><th>Side</th><th>Tee</th><th>Holes</th><th>Raw</th><th>Adjusted</th></tr>
        </thead>
        <tbody id="rounds-rows"></tbody>
      </table>
    </div>
  `;

  wireStepperButtons(el.querySelector('#round-holes'));
  wireSelectOnFocus(el.querySelector('#round-holes'));

  const roundPlayerSelect = el.querySelector('#round-player');
  const roundEntryFields = el.querySelector('#round-entry-fields');
  const roundCourseSelect = el.querySelector('#round-course');
  const roundSideSelect = el.querySelector('#round-side');
  const roundTeeSelect = el.querySelector('#round-tee-set');
  function updateRoundTeeInfo() {
    const course = getCourseById(roundCourseSelect.value);
    const teeSet = findTeeSet(course, roundTeeSelect.value);
    const side = selectedSideForCourse(course, roundSideSelect.value);
    const info = el.querySelector('#round-tee-info');
    if (!course) { info.textContent = ''; updateHoleReferenceRow(el.querySelector('#round-holes'), 'front', null); return; }
    const par = teeSetTotalPar(course, teeSet, side);
    const yards = teeSet ? teeSetTotalYardage(teeSet, side) : null;
    const sideText = isEighteenHoleCourse(course) ? `${sideLabel(side)} · ` : '';
    info.textContent = teeSet
      ? `${sideText}Par ${par}${yards != null ? `, ${yards} yds` : ''}${teeSet.holeParsOverride ? ' (par differs on this tee)' : ''}`
      : `${sideText}Par ${teeSetTotalPar(course, null, side)} (course default)`;
    updateHoleReferenceRow(el.querySelector('#round-holes'), side, teeSetEffectiveHolePars(course, teeSet, side));
  }

  // New rounds default every hole to par so the coach can nudge the spinner up/down for a
  // bogey/birdie instead of typing every score. This is a plain, explicit reset rather than a
  // "smart" per-hole tracker — changing course/side/tee after one's already selected always asks
  // first, since it wipes all 9 holes to the new selection's par; declining reverts the dropdown(s)
  // back and leaves every hole exactly as it was. Editing an existing round never resets or asks —
  // it always shows what was actually recorded.
  function applyParDefaults() {
    const course = getCourseById(roundCourseSelect.value);
    const teeSet = findTeeSet(course, roundTeeSelect.value);
    const side = selectedSideForCourse(course, roundSideSelect.value);
    if (!course) return;
    const holePars = teeSetEffectiveHolePars(course, teeSet, side);
    el.querySelectorAll('#round-holes .hole-input').forEach((input, i) => { input.value = holePars[i]; });
  }

  if (editingRound) {
    el.querySelector('#round-player').value = editingRound.playerId;
    el.querySelector('#round-type').value = editingRound.type;
    roundCourseSelect.value = editingRound.courseId ?? '';
  } else {
    const homeCourseId = DataStore.getHomeCourseId();
    if (homeCourseId && getCourseById(homeCourseId)) roundCourseSelect.value = homeCourseId;
  }
  updateSideOptions(roundCourseSelect.value, roundSideSelect);
  if (editingRound && editingRound.side) roundSideSelect.value = editingRound.side;
  updateTeeSetOptions(roundCourseSelect.value, roundTeeSelect);
  if (editingRound && editingRound.teeSetId) roundTeeSelect.value = editingRound.teeSetId;
  updateRoundTeeInfo();
  if (!editingRound) applyParDefaults();

  let priorCourseId = roundCourseSelect.value;
  let priorSide = roundSideSelect.value;
  let priorTeeSetId = roundTeeSelect.value;

  // The entry section (tee info, hole scores, Save) stays hidden until a real player is chosen —
  // an unattributed round is a mistake waiting to happen (easy to fill in 9 holes' worth of scores
  // against whichever player the browser happened to default-select), and hiding the section is a
  // stronger nudge than just leaving the picker blank. Editing an existing round always shows it
  // immediately (roundEntryFields' initial class, above) since the player is already fixed then —
  // this listener only matters for logging a brand-new round.
  roundPlayerSelect.addEventListener('change', () => {
    roundEntryFields.classList.toggle('hidden', !roundPlayerSelect.value);
  });

  // Shared by all three selects below: ask before resetting (skipped on the very first course
  // pick, since there's nothing on the form yet to lose), apply-and-reset on OK, or run `revert`
  // to put every select back the way it was on Cancel — holes are untouched either way until OK.
  function confirmResetOrRevert(applyChange, revert) {
    const hadCourseAlready = priorCourseId !== '';
    if (hadCourseAlready && !confirm("Changing the course, side, or tee set resets all 9 hole scores to the new selection's par. Continue?")) {
      revert();
      return;
    }
    applyChange();
    if (!editingRound) applyParDefaults();
    priorCourseId = roundCourseSelect.value;
    priorSide = roundSideSelect.value;
    priorTeeSetId = roundTeeSelect.value;
  }

  roundCourseSelect.addEventListener('change', () => {
    if (editingRound) {
      updateSideOptions(roundCourseSelect.value, roundSideSelect);
      updateTeeSetOptions(roundCourseSelect.value, roundTeeSelect);
      updateRoundTeeInfo();
      return;
    }
    confirmResetOrRevert(
      () => {
        updateSideOptions(roundCourseSelect.value, roundSideSelect);
        updateTeeSetOptions(roundCourseSelect.value, roundTeeSelect);
        updateRoundTeeInfo();
      },
      () => {
        roundCourseSelect.value = priorCourseId;
        updateSideOptions(priorCourseId, roundSideSelect);
        roundSideSelect.value = priorSide;
        updateTeeSetOptions(priorCourseId, roundTeeSelect);
        roundTeeSelect.value = priorTeeSetId;
        updateRoundTeeInfo();
      }
    );
  });
  roundSideSelect.addEventListener('change', () => {
    if (editingRound) { updateRoundTeeInfo(); return; }
    confirmResetOrRevert(updateRoundTeeInfo, () => { roundSideSelect.value = priorSide; updateRoundTeeInfo(); });
  });
  roundTeeSelect.addEventListener('change', () => {
    if (editingRound) { updateRoundTeeInfo(); return; }
    confirmResetOrRevert(updateRoundTeeInfo, () => { roundTeeSelect.value = priorTeeSetId; updateRoundTeeInfo(); });
  });

  const cancelBtn = el.querySelector('#btn-cancel-edit');
  if (cancelBtn) cancelBtn.addEventListener('click', () => renderRoundsView(null, null));

  function matchesFilter(r) {
    if (roundsFilterState.playerId && r.playerId !== roundsFilterState.playerId) return false;
    if (roundsFilterState.type && r.type !== roundsFilterState.type) return false;
    if (roundsFilterState.courseId && r.courseId !== roundsFilterState.courseId) return false;
    if (roundsFilterState.dateFrom && r.date < roundsFilterState.dateFrom) return false;
    if (roundsFilterState.dateTo && r.date > roundsFilterState.dateTo) return false;
    return true;
  }

  const rows = el.querySelector('#rounds-rows');
  const filterCount = el.querySelector('#rounds-filter-count');

  function renderFilteredRows() {
    const filtered = rounds.filter(matchesFilter);
    filterCount.textContent = filtered.length === rounds.length
      ? `${rounds.length} round${rounds.length === 1 ? '' : 's'}`
      : `${filtered.length} of ${rounds.length} rounds shown`;

    rows.innerHTML = filtered.map((r) => {
      const player = DataStore.getById('players', r.playerId);
      const course = getCourseById(r.courseId);
      const teeSet = findTeeSet(course, r.teeSetId);
      const side = selectedSideForCourse(course, r.side);
      const holePars = resolveHolePars(r, getCourseById);
      const raw = rawScoreOrNull(r.holeScores);
      const holesPlayed = holesPlayedCount(r.holeScores);
      const valid = isValidRound(r.holeScores);
      const adj = holePars && valid ? adjustedScore(r.holeScores, holePars) : null;
      const detailCells = holePars
        ? r.holeScores.map((s, i) => `<td>H${sideHoleNumber(i, side)}<br>${s ?? '—'}</td>`).join('')
        : r.holeScores.map((s) => `<td>${s ?? '—'}</td>`).join('');
      return `
        <tr class="round-row" data-round-id="${escapeHtml(r.id)}">
          <td>${escapeHtml(r.date)}</td>
          <td>${player ? `${escapeHtml(player.firstName)} ${escapeHtml(player.lastName)}` : '—'}</td>
          <td>${escapeHtml(r.type)}</td>
          <td>${course ? escapeHtml(course.name) : '—'}</td>
          <td>${course && isEighteenHoleCourse(course) ? sideLabel(side) : '—'}</td>
          <td>${teeSet ? escapeHtml(teeSet.name) : '—'}</td>
          <td>${holesPlayed}${!valid ? ' <span class="badge warn">incomplete</span>' : ''}</td>
          <td>${raw ?? '—'}</td>
          <td>${adj != null ? adj.toFixed(1) : '—'}</td>
        </tr>
        <tr class="round-detail hidden" data-round-id="${escapeHtml(r.id)}">
          <td colspan="9">
            <div class="table-wrap">
              <table><tbody><tr>${detailCells}</tr></tbody></table>
            </div>
            ${r.type === 'match'
              ? '<p class="muted admin-only">Derived from a match — edit scores on the Matches page.</p>'
              : `<button class="admin-only btn-edit-round" data-round-id="${escapeHtml(r.id)}">Edit</button>
                 <button class="admin-only btn-delete-round" data-round-id="${escapeHtml(r.id)}" style="margin-left:0.5rem;color:#c0392b;">Delete</button>`}
          </td>
        </tr>
      `;
    }).join('');
  }

  rows.addEventListener('click', (e) => {
    const delBtn = e.target.closest('.btn-delete-round');
    if (delBtn) {
      e.stopPropagation();
      const roundId = delBtn.dataset.roundId;
      const round = DataStore.getById('rounds', roundId);
      if (!round) return;
      const player = DataStore.getById('players', round.playerId);
      const name = player ? `${player.firstName} ${player.lastName}` : 'Unknown';
      if (!confirm(`Delete this ${round.type} round for ${name} on ${round.date}?`)) return;
      DataStore.remove('rounds', roundId);
      renderFilteredRows();
      return;
    }
    const editBtn = e.target.closest('.btn-edit-round');
    if (editBtn) {
      e.stopPropagation();
      renderRoundsView(null, editBtn.dataset.roundId);
      el.querySelector('.card').scrollIntoView({ behavior: 'smooth' });
      return;
    }
    const row = e.target.closest('tr[data-round-id]');
    if (!row) return;
    const detail = rows.querySelector(`.round-detail[data-round-id="${row.dataset.roundId}"]`);
    if (detail) detail.classList.toggle('hidden');
  });

  const filterPlayerSelect = el.querySelector('#filter-player');
  const filterTypeSelect = el.querySelector('#filter-type');
  const filterCourseSelect = el.querySelector('#filter-course');
  const filterDateFrom = el.querySelector('#filter-date-from');
  const filterDateTo = el.querySelector('#filter-date-to');

  filterPlayerSelect.value = roundsFilterState.playerId;
  filterTypeSelect.value = roundsFilterState.type;
  filterCourseSelect.value = roundsFilterState.courseId;
  filterDateFrom.value = roundsFilterState.dateFrom;
  filterDateTo.value = roundsFilterState.dateTo;

  filterPlayerSelect.addEventListener('change', () => { roundsFilterState.playerId = filterPlayerSelect.value; renderFilteredRows(); });
  filterTypeSelect.addEventListener('change', () => { roundsFilterState.type = filterTypeSelect.value; renderFilteredRows(); });
  filterCourseSelect.addEventListener('change', () => { roundsFilterState.courseId = filterCourseSelect.value; renderFilteredRows(); });
  filterDateFrom.addEventListener('change', () => { roundsFilterState.dateFrom = filterDateFrom.value; renderFilteredRows(); });
  filterDateTo.addEventListener('change', () => { roundsFilterState.dateTo = filterDateTo.value; renderFilteredRows(); });
  el.querySelector('#btn-clear-filters').addEventListener('click', () => {
    roundsFilterState.playerId = '';
    roundsFilterState.type = '';
    roundsFilterState.courseId = '';
    roundsFilterState.dateFrom = '';
    roundsFilterState.dateTo = '';
    filterPlayerSelect.value = '';
    filterTypeSelect.value = '';
    filterCourseSelect.value = '';
    filterDateFrom.value = '';
    filterDateTo.value = '';
    renderFilteredRows();
  });

  renderFilteredRows();

  el.querySelector('#btn-add-round').addEventListener('click', () => {
    const playerId = el.querySelector('#round-player').value;
    const type = el.querySelector('#round-type').value;
    const courseId = roundCourseSelect.value;
    const course = getCourseById(courseId);
    const side = selectedSideForCourse(course, roundSideSelect.value);
    const teeSetId = roundTeeSelect.value || null;
    const date = el.querySelector('#round-date').value;
    const putts = Number(el.querySelector('#round-putts').value) || null;

    if (!playerId || !courseId || !date) {
      alert('Player, course, and date are required.');
      return;
    }

    const teeSet = findTeeSet(course, teeSetId);
    const rawInputs = Array.from(el.querySelectorAll('#round-holes .hole-input'))
      .map((i) => (i.value === '' ? null : Number(i.value)));

    if (!hasAnyHoleScore(rawInputs)) {
      alert('Enter at least one hole score.');
      return;
    }

    const capped = capAllHoleScores(rawInputs, teeSetEffectiveHolePars(course, teeSet, side));
    const anyCapped = capped.some((c) => c.wasCapped);
    const holeScores = capped.map((c) => c.value);

    if (editingRound) {
      DataStore.update('rounds', editingRound.id, { playerId, date, type, courseId, teeSetId, side, holeScores, putts });
    } else {
      DataStore.add('rounds', newRound({ playerId, date, type, courseId, teeSetId, side, holeScores, putts }));
    }

    renderRoundsView(anyCapped ? 'Note: one or more hole scores exceeded double-par and were capped.' : null, null);
  });
}

function renderRankView() {
  const el = document.getElementById('view-rank');

  // Viewer mode almost never means "the coach's own browser" — localStorage is per-browser, so
  // anyone else looking has their own (usually empty or stale) copy of the data, not the coach's.
  // Computing a rank table from that would be misleading rather than just unhelpful, so send
  // viewers straight to the published report instead, which reflects the actual season data
  // regardless of whose browser they're on. Admins still get the live local table below, since
  // that's the coach's own browser and the whole point is checking it before publishing. This was
  // the original instance of this pattern — see viewerRedirectNotice (html-utils.js) / GitHub
  // issue #39 for where it got generalized to the other local-data tabs.
  if (!AppState.isAdmin) {
    el.innerHTML = viewerRedirectNotice(
      "Rankings are only meaningful from the coach's own browser — this device's local data " +
      "likely isn't in sync with the team's."
    );
    return;
  }

  const players = DataStore.getAll('players').filter((p) => p.active);
  const allRounds = DataStore.getAll('rounds');
  const extended = TEAM_CONFIG.extendedRankingStats?.enabled;

  const withAverage = players.map((p) => ({
    ...p,
    ...playerRankingStats(allRounds.filter((r) => r.playerId === p.id), getCourseById),
  }));
  const ranked = rankPlayers(withAverage);

  el.innerHTML = `
    <p class="muted">Reference/suggestion only — the coach always sets the full lineup order manually.</p>
    <p><a href="reports/index.html" title="See current published report">See current published report</a></p>
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
