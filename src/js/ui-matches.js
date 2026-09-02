// Match-day scoring: 2-3 team blocks per card, hole-by-hole entry, derived team score.
// Each team's `players` entries carry an `isStarter` flag (extension beyond the brief's base
// model) so team score can be computed from the 6 starters only, per rule 5 — alternates never
// count toward it even if they post a score.

// Ephemeral "click to edit" state for the Matches page — mirrors the editingRoundId pattern in
// ui-rounds.js. Only one edit is ever in flight at a time; starting a new one (header, a team's
// name, or a single score entry) implicitly cancels whatever was in progress, same as every other
// edit-in-place form in this app. Shapes:
//   { kind: 'header', matchId }
//   { kind: 'teamName', matchId, teamId }
//   { kind: 'entry', matchId, teamId, entryIndex }
let matchEditState = null;

function matchHolePars(match) {
  return resolveHolePars(match, getCourseById);
}

// Keeps each own-roster player entry's linked `rounds` record in sync with the match, so
// `playerRankingStats()` (which only reads `rounds`) picks up match scores without needing to know
// anything about matches. Opponents/guests (no `playerId`) are skipped — they're not on our roster
// and have nothing to rank. Entries remember their round via `roundId` so a future edit of an
// existing entry (not possible yet — today's UI only ever appends) would update that round in
// place rather than creating a duplicate.
function syncMatchRounds(match) {
  match.teams.forEach((team) => {
    team.players.forEach((entry) => {
      if (!entry.playerId) return;
      const roundFields = {
        playerId: entry.playerId,
        date: match.date,
        type: 'match',
        courseId: match.courseId,
        teeSetId: match.teeSetId,
        side: match.side,
        inlineHolePars: match.inlineHolePars,
        holeScores: entry.holeScores,
        putts: entry.putts,
        matchId: match.id,
      };
      const existing = entry.roundId ? DataStore.getById('rounds', entry.roundId) : null;
      if (existing) {
        DataStore.update('rounds', existing.id, roundFields);
      } else {
        entry.roundId = DataStore.add('rounds', newRound(roundFields)).id;
      }
    });
  });
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

  // See viewerRedirectNotice (html-utils.js) / GitHub issue #39 — this closes a gap that used to
  // be documented as an explicit inconsistency in ui-help.js: unlike Rank, this tab used to show
  // local match data to viewers and admins alike, so a viewer checking match results from a
  // device that isn't the coach's would see local data (likely blank, or an out-of-date local
  // copy) that isn't the team's real results.
  if (!AppState.isAdmin) {
    el.innerHTML = viewerRedirectNotice(
      "Match results shown here are only meaningful from the coach's own browser — this device's " +
      "local data likely isn't in sync with the team's."
    );
    return;
  }

  const courses = DataStore.getAll('courses').slice().sort((a, b) => a.name.localeCompare(b.name));
  const matches = DataStore.getAll('matches').slice().sort((a, b) => new Date(b.date) - new Date(a.date));
  const record = computeSeasonRecord(matches);
  const editingMatch = matchEditState?.kind === 'header' ? DataStore.getById('matches', matchEditState.matchId) : null;

  el.innerHTML = `
    <p class="season-record"><strong>Season record:</strong> ${record.wins}-${record.losses}-${record.ties}</p>
    <div class="card admin-only">
      <h2>${editingMatch ? 'Edit match' : 'New match'}</h2>
      <div class="form-row">
        <input type="date" id="match-date" value="${editingMatch ? escapeHtml(editingMatch.date) : new Date().toISOString().slice(0, 10)}">
        <select id="match-location">
          <option value="Home" ${editingMatch?.location === 'Home' ? 'selected' : ''}>Home</option>
          <option value="Away" ${editingMatch?.location === 'Away' ? 'selected' : ''}>Away</option>
        </select>
        <select id="match-course">
          ${courses.map((c) => `<option value="${escapeHtml(c.id)}" ${editingMatch?.courseId === c.id ? 'selected' : ''}>${escapeHtml(c.name)}</option>`).join('')}
        </select>
        <select id="match-side"></select>
        <select id="match-tee-set"></select>
        ${editingMatch
          ? `<span class="muted">${editingMatch.teams.length} teams (can't change team count once created)</span>`
          : `<select id="match-team-count">
               <option value="2">2 teams</option>
               <option value="3">3 teams</option>
             </select>`}
      </div>
      <div class="muted" id="match-tee-info"></div>
      <button class="primary" id="btn-add-match">${editingMatch ? 'Update match' : 'Create match'}</button>
      ${editingMatch ? '<button id="btn-cancel-match-edit">Cancel</button>' : ''}
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
  if (editingMatch && editingMatch.side) matchSideSelect.value = editingMatch.side;
  updateTeeSetOptions(matchCourseSelect.value, matchTeeSelect);
  if (editingMatch && editingMatch.teeSetId) matchTeeSelect.value = editingMatch.teeSetId;
  updateMatchTeeInfo();
  matchCourseSelect.addEventListener('change', () => {
    updateSideOptions(matchCourseSelect.value, matchSideSelect);
    updateTeeSetOptions(matchCourseSelect.value, matchTeeSelect);
    updateMatchTeeInfo();
  });
  matchSideSelect.addEventListener('change', updateMatchTeeInfo);
  matchTeeSelect.addEventListener('change', updateMatchTeeInfo);

  const cancelMatchEditBtn = el.querySelector('#btn-cancel-match-edit');
  if (cancelMatchEditBtn) cancelMatchEditBtn.addEventListener('click', () => { matchEditState = null; renderMatchesView(); });

  el.querySelector('#btn-add-match').addEventListener('click', () => {
    const date = el.querySelector('#match-date').value;
    const location = el.querySelector('#match-location').value;
    const courseId = matchCourseSelect.value;
    const course = getCourseById(courseId);
    const side = selectedSideForCourse(course, matchSideSelect.value);
    const teeSetId = matchTeeSelect.value || null;
    if (!date || !location || !courseId) {
      alert('Date, location, and course are required.');
      return;
    }
    if (editingMatch) {
      DataStore.update('matches', editingMatch.id, { date, location, courseId, teeSetId, side });
      // Header fields (course/date/side/tee) are shared by every entry's mirrored round, so an
      // edit here has to cascade to all of them, not just the most recently added one.
      syncMatchRounds(editingMatch);
      matchEditState = null;
    } else {
      const teamCount = Number(el.querySelector('#match-team-count').value);
      const teams = Array.from({ length: teamCount }, (_, i) =>
        newMatchTeam({ name: i === 0 ? 'Dempsey' : `Opponent ${i}`, isOwnTeam: i === 0 })
      );
      DataStore.add('matches', newMatch({ date, location, courseId, teeSetId, side, teams }));
    }
    renderMatchesView();
  });

  const list = el.querySelector('#matches-list');
  list.innerHTML = matches.map((m) => renderMatchCard(m)).join('');
  // renderMatchCard(m) emits exactly one top-level .card per match, in the same order as
  // `matches` — zip by position instead of re-querying by id, so a match id (which may originate
  // from an imported file) can never be mistaken for, or break, a CSS selector.
  const cards = Array.from(list.children);
  matches.forEach((m, i) => wireMatchCard(m, cards[i]));
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
  const holePars = matchHolePars(match);
  const teamScores = match.teams.map((team) => ({ team, score: computeTeamScore(team) }));
  // Only declare a winner once at least 2 teams have posted a complete score — with fewer than
  // that there's nothing to compare, so no highlight rather than a premature/misleading one.
  const completeTotals = teamScores.filter((t) => t.score.complete).map((t) => t.score.total);
  const lowestScore = completeTotals.length >= 2 ? Math.min(...completeTotals) : null;
  const medalistScore = computeMedalistScore(match);
  return `
    <div class="card" data-match-id="${escapeHtml(match.id)}">
      <div class="form-row">
        <h3>${escapeHtml(match.date)} — ${escapeHtml(match.location)} (${course ? escapeHtml(course.name) : 'unknown course'}${course && isEighteenHoleCourse(course) ? ` — ${sideLabel(side)}` : ''}${teeSet ? ` — ${escapeHtml(teeSet.name)} tees` : ''})</h3>
        <button class="btn-copy-match-link" data-match-id="${escapeHtml(match.id)}">Copy report link</button>
        <button class="admin-only btn-edit-match">Edit match</button>
        <button class="admin-only btn-remove-match">Remove match</button>
      </div>
      ${holePars == null ? `
        <p class="muted"><span class="badge warn">Course unavailable</span> This match's course
        record can't be found (was it deleted?) — scores below can't be compared to par, and new
        scores can't be added until this is resolved. Team score and medalist are unaffected.</p>
      ` : ''}
      ${teamScores.map(({ team, score }) =>
        renderTeamBlock(match, team, holePars, side, score, lowestScore != null && score.complete && score.total === lowestScore, medalistScore)
      ).join('')}
    </div>
  `;
}

function renderTeamBlock(match, team, holePars, side, score, isWinner, medalistScore) {
  const players = DataStore.getAll('players').slice().sort((a, b) => a.lastName.localeCompare(b.lastName));
  const renamingTeam = matchEditState?.kind === 'teamName' && matchEditState.matchId === match.id && matchEditState.teamId === team.id;
  const editingEntryIndex = (matchEditState?.kind === 'entry' && matchEditState.matchId === match.id && matchEditState.teamId === team.id)
    ? matchEditState.entryIndex
    : null;
  const editingEntry = editingEntryIndex != null ? team.players[editingEntryIndex] : null;
  // The add/edit form's shape follows the entry being edited (so an old By Hole entry is still
  // editable as such even if the team's mode was switched to Score Only since), or the team's
  // current mode for a brand-new entry. Own team never offers Score Only (see newMatchTeam), so it
  // always resolves to 'byHole' here regardless of what's stored.
  const formMode = editingEntry
    ? (editingEntry.holeScores ? 'byHole' : 'scoreOnly')
    : (!team.isOwnTeam && team.scoringMode === 'scoreOnly' ? 'scoreOnly' : 'byHole');

  return `
    <div class="card team-block${isWinner ? ' winning-team' : ''}" data-team-id="${escapeHtml(team.id)}">
      <div class="form-row">
        ${renamingTeam ? `
          <input type="text" class="team-name-input" value="${escapeHtml(team.name)}">
          <button class="btn-save-team-name">Save</button>
          <button class="btn-cancel-team-name">Cancel</button>
        ` : `
          <strong>${escapeHtml(team.name)}</strong>
          <button class="admin-only btn-rename-team">Rename</button>
        `}
        ${team.isOwnTeam ? '<span class="badge">own team</span>' : ''}
        ${!team.isOwnTeam && team.scoringMode === 'scoreOnly' ? '<span class="badge">score only</span>' : ''}
        ${isWinner ? '<span class="badge win">Winner</span>' : ''}
        ${!team.isOwnTeam ? `
          <label class="muted admin-only">Scoring:
            <select class="team-scoring-mode-select" data-team-id="${escapeHtml(team.id)}">
              <option value="byHole" ${team.scoringMode !== 'scoreOnly' ? 'selected' : ''}>By Hole</option>
              <option value="scoreOnly" ${team.scoringMode === 'scoreOnly' ? 'selected' : ''}>Score Only</option>
            </select>
          </label>
        ` : ''}
      </div>
      <div class="form-row add-player-row admin-only" data-match-id="${escapeHtml(match.id)}" data-team-id="${escapeHtml(team.id)}">
        ${team.isOwnTeam ? `
          <select class="player-select">
            <option value="">— select a player —</option>
            ${players.map((p) => `<option value="${escapeHtml(p.id)}" ${editingEntry && editingEntry.playerId === p.id ? 'selected' : ''}>${escapeHtml(p.firstName)} ${escapeHtml(p.lastName)}</option>`).join('')}
          </select>
        ` : `
          <input type="text" class="displayname-input" placeholder="Player name" value="${editingEntry ? escapeHtml(editingEntry.displayName) : ''}">
        `}
        <div class="match-entry-fields${team.isOwnTeam && !editingEntry ? ' hidden' : ''}">
        <label class="muted"><input type="checkbox" class="starter-checkbox" ${editingEntry ? (editingEntry.isStarter ? 'checked' : '') : 'checked'}> Starter</label>
        <span class="row-break"></span>
        ${formMode === 'byHole' ? (() => {
          // New entries default each hole to par, same as ui-rounds.js's own hole entry — lets the
          // coach nudge the stepper up/down for a bogey/birdie instead of typing every score.
          // Previously defaulted to double par (the same cap capAllHoleScores enforces on submit,
          // see scoring-engine.js) specifically so a leftover/un-entered default couldn't be
          // mistaken for a real recorded score at a glance — reverted per coach feedback: that
          // traded away the far more common case (nudging from a realistic starting point) for a
          // rarer mistake it didn't meaningfully prevent in practice anyway. Editing an existing
          // entry always shows what was actually recorded, never a default fallback.
          const holeInputsHtml = Array.from({ length: 9 }, (_, i) => {
            const value = editingEntry
              ? (editingEntry.holeScores[i] != null ? editingEntry.holeScores[i] : '')
              : (holePars ? holePars[i] : '');
            return renderStepperInput({
              className: 'hole-input', dataAttrs: `data-hole="${i}"`,
              placeholder: `H${sideHoleNumber(i, side)}`, value, min: 1,
            });
          }).join('');
          // Without a resolvable course (holePars null — "Course unavailable" above), there's
          // nothing to put in a Par row, so the scorecard-style block is skipped entirely in favor
          // of the plain unbordered entry row rather than showing it missing its Par reference.
          return holePars ? `
            <div class="hole-entry-group">
              <div class="scorecard-row scorecard-hole-row">
                <span class="scorecard-cell scorecard-label-cell">Hole</span>
                ${Array.from({ length: 9 }, (_, i) => `<span class="scorecard-cell hole-number-cell">${sideHoleNumber(i, side)}</span>`).join('')}
              </div>
              <div class="scorecard-row scorecard-par-row">
                <span class="scorecard-cell scorecard-label-cell">Par</span>
                ${holePars.map((par) => `<span class="scorecard-cell hole-par-cell">${par}</span>`).join('')}
              </div>
              <div class="scorecard-row scorecard-score-row">
                <span class="scorecard-cell scorecard-label-cell">Score</span>
                <div class="hole-scores">${holeInputsHtml}</div>
              </div>
            </div>
          ` : `
            <div class="hole-scores">${holeInputsHtml}</div>
          `;
        })() : `
          ${renderStepperInput({
            className: 'total-score-input',
            placeholder: 'Score',
            value: editingEntry && editingEntry.totalScore != null ? editingEntry.totalScore : (holePars ? roundTotalPar(holePars) * 2 : ''),
            min: 1,
          })}
        `}
        <input type="text" inputmode="numeric" class="putts-input input-narrow" placeholder="Putts" value="${editingEntry && editingEntry.putts != null ? editingEntry.putts : ''}">
        <button class="btn-add-team-player">${editingEntry ? 'Update score' : 'Add score'}</button>
        ${editingEntry ? '<button class="btn-cancel-entry-edit">Cancel</button>' : ''}
        </div>
      </div>
      <div class="table-wrap">
        <table>
          <thead><tr><th>Player</th><th>Starter</th><th>Score</th><th>Putts</th><th>Front3</th><th>Mid3</th><th>Back3</th><th>To Par</th><th class="admin-only">Actions</th></tr></thead>
          <tbody>
            ${team.players.map((p, i) => {
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
                <td class="admin-only">
                  <button class="btn-edit-entry" data-entry-index="${i}">Edit</button>
                  <button class="btn-remove-entry" data-entry-index="${i}">Remove</button>
                </td>
              </tr>`;
            }).join('')}
          </tbody>
        </table>
      </div>
      <p><strong>Team score:</strong> ${score.complete ? score.total : `Incomplete — only ${score.scoresUsed} of the 6 starters have posted a score`}</p>
    </div>
  `;
}

function wireMatchCard(match, card) {
  wireStepperButtons(card);
  wireSelectOnFocus(card);

  // Copies the URL this match *will* live at on the published static report (reports/match.html,
  // see src/teams/<team>/reports/match-viewer.js) — not a guarantee it's live yet. The coach
  // typically grabs this right after entering a match to text/email the opposing coach, then
  // publishes separately; if they haven't published yet, the link 404s/shows "not published" until
  // they do.
  const copyLinkBtn = card.querySelector('.btn-copy-match-link');
  if (copyLinkBtn) {
    copyLinkBtn.addEventListener('click', async () => {
      const url = `${TEAM_CONFIG.domain}/reports/match.html?id=${encodeURIComponent(match.id)}`;
      try {
        await navigator.clipboard.writeText(url);
        copyLinkBtn.textContent = 'Copied!';
      } catch {
        copyLinkBtn.textContent = 'Copy failed — select manually';
      }
      setTimeout(() => { copyLinkBtn.textContent = 'Copy report link'; }, 2000);
    });
  }

  card.querySelectorAll('.add-player-row').forEach((row) => {
    const teamId = row.dataset.teamId;
    // Own-team rows only — opponent/guest entries use a free-text name input, nothing to "select".
    // Mirrors #round-entry-fields in ui-rounds.js: keeps the rest of the row (Starter, score
    // fields, Putts, the button) hidden until a real player is chosen, so a fresh "Add score" can't
    // silently attribute a full 9 holes to whichever roster player the select happened to default
    // to. Editing an existing entry always starts visible (the player is already fixed then) — see
    // .match-entry-fields' initial class, above.
    const playerSelect = row.querySelector('.player-select');
    if (playerSelect) {
      playerSelect.addEventListener('change', () => {
        row.querySelector('.match-entry-fields').classList.toggle('hidden', !playerSelect.value);
      });
    }
    row.querySelector('.btn-add-team-player').addEventListener('click', () => {
      const team = match.teams.find((t) => t.id === teamId);
      const isStarter = row.querySelector('.starter-checkbox').checked;

      let playerId = null;
      let displayName;
      if (team.isOwnTeam) {
        playerId = row.querySelector('.player-select').value;
        if (!playerId) {
          alert('Select a player.');
          return;
        }
        const player = DataStore.getById('players', playerId);
        displayName = `${player.firstName} ${player.lastName}`;
      } else {
        displayName = row.querySelector('.displayname-input').value.trim();
        if (!displayName) {
          alert('Enter a player name.');
          return;
        }
      }

      const holePars = matchHolePars(match);
      if (!holePars) {
        alert("This match's course record is missing (was it deleted?), so new scores can't be capped to par. Existing recorded scores are unaffected, but new scores can't be added until this is resolved.");
        return;
      }

      // Which form is showing follows renderTeamBlock's formMode — Score Only when this row has a
      // total-score-input, By Hole when it has the 9 hole-input steppers instead. Exactly one of
      // holeScores/totalScore ends up set, per the entry shape validateMatchPlayerEntry expects.
      const scoreOnlyInput = row.querySelector('.total-score-input');
      let holeScores = null;
      let totalScore = null;
      if (scoreOnlyInput) {
        if (scoreOnlyInput.value === '') {
          alert('Enter a score.');
          return;
        }
        totalScore = capTotalScore(Number(scoreOnlyInput.value), holePars).value;
      } else {
        const rawInputs = Array.from(row.querySelectorAll('.hole-input')).map((i) => (i.value === '' ? null : Number(i.value)));
        if (!hasAnyHoleScore(rawInputs)) {
          alert('Enter at least one hole score.');
          return;
        }
        holeScores = capAllHoleScores(rawInputs, holePars).map((c) => c.value);
      }
      const putts = Number(row.querySelector('.putts-input').value) || null;

      const editingThisRow = matchEditState?.kind === 'entry' && matchEditState.matchId === match.id && matchEditState.teamId === teamId;
      if (editingThisRow) {
        // Mutate the existing entry in place (keeps its `roundId`) rather than replacing it, so
        // syncMatchRounds below updates the linked round instead of creating a duplicate.
        Object.assign(team.players[matchEditState.entryIndex], {
          playerId, displayName, holeScores, totalScore, putts, isStarter,
        });
        matchEditState = null;
      } else {
        team.players.push({ playerId, displayName, holeScores, totalScore, putts, isStarter, roundId: null });
      }
      syncMatchRounds(match);
      DataStore.update('matches', match.id, { teams: match.teams });
      renderMatchesView();
    });

    const cancelEntryBtn = row.querySelector('.btn-cancel-entry-edit');
    if (cancelEntryBtn) cancelEntryBtn.addEventListener('click', () => { matchEditState = null; renderMatchesView(); });
  });

  card.querySelectorAll('.btn-edit-entry').forEach((btn) => {
    btn.addEventListener('click', () => {
      const teamId = btn.closest('.team-block').dataset.teamId;
      matchEditState = { kind: 'entry', matchId: match.id, teamId, entryIndex: Number(btn.dataset.entryIndex) };
      renderMatchesView();
      document.getElementById('view-matches').querySelector(`.team-block[data-team-id="${teamId}"] .add-player-row`).scrollIntoView({ behavior: 'smooth' });
    });
  });

  card.querySelectorAll('.btn-remove-entry').forEach((btn) => {
    btn.addEventListener('click', () => {
      const teamId = btn.closest('.team-block').dataset.teamId;
      const team = match.teams.find((t) => t.id === teamId);
      const index = Number(btn.dataset.entryIndex);
      const entry = team.players[index];
      if (!confirm(`Remove ${entry.displayName}'s score?`)) return;
      const linkedRound = entry.roundId ? DataStore.getById('rounds', entry.roundId) : null;
      if (linkedRound) {
        const removeRound = confirm(
          `This score has a linked round that counts toward rankings. Delete it too?\n\n` +
          `OK: delete the round as well.\n` +
          `Cancel: keep it — it'll stay on the Rounds page without a match link.`
        );
        if (removeRound) DataStore.remove('rounds', linkedRound.id);
      }
      team.players.splice(index, 1);
      DataStore.update('matches', match.id, { teams: match.teams });
      // Indices shift after a splice, so any other in-flight entry edit for this match can no
      // longer be trusted to point at the right row — cancel it rather than risk editing the
      // wrong one.
      if (matchEditState?.kind === 'entry' && matchEditState.matchId === match.id) matchEditState = null;
      renderMatchesView();
    });
  });

  card.querySelectorAll('.team-scoring-mode-select').forEach((select) => {
    select.addEventListener('change', () => {
      const team = match.teams.find((t) => t.id === select.dataset.teamId);
      team.scoringMode = select.value;
      DataStore.update('matches', match.id, { teams: match.teams });
      // Only changes what the add/edit form offers for *new* entries going forward — existing
      // entries keep whatever shape (holeScores or totalScore) they were entered with, and any
      // in-flight edit of one of them (formMode in renderTeamBlock) is unaffected.
      renderMatchesView();
    });
  });

  card.querySelectorAll('.btn-rename-team').forEach((btn) => {
    btn.addEventListener('click', () => {
      const teamId = btn.closest('.team-block').dataset.teamId;
      matchEditState = { kind: 'teamName', matchId: match.id, teamId };
      renderMatchesView();
    });
  });

  card.querySelectorAll('.btn-save-team-name').forEach((btn) => {
    btn.addEventListener('click', () => {
      const block = btn.closest('.team-block');
      const name = block.querySelector('.team-name-input').value.trim();
      if (!name) {
        alert('Team name is required.');
        return;
      }
      const team = match.teams.find((t) => t.id === block.dataset.teamId);
      team.name = name;
      DataStore.update('matches', match.id, { teams: match.teams });
      matchEditState = null;
      renderMatchesView();
    });
  });

  card.querySelectorAll('.btn-cancel-team-name').forEach((btn) => {
    btn.addEventListener('click', () => { matchEditState = null; renderMatchesView(); });
  });

  const editMatchBtn = card.querySelector('.btn-edit-match');
  if (editMatchBtn) {
    editMatchBtn.addEventListener('click', () => {
      matchEditState = { kind: 'header', matchId: match.id };
      renderMatchesView();
      document.getElementById('view-matches').querySelector('.card').scrollIntoView({ behavior: 'smooth' });
    });
  }

  const removeBtn = card.querySelector('.btn-remove-match');
  if (removeBtn) {
    removeBtn.addEventListener('click', () => {
      if (!confirm('Delete this match?')) return;
      const linkedRounds = DataStore.getAll('rounds').filter((r) => r.matchId === match.id);
      if (linkedRounds.length) {
        const removeRounds = confirm(
          `This match has ${linkedRounds.length} linked round(s) that count toward rankings. Delete them too?\n\n` +
          `OK: delete the round(s) as well.\n` +
          `Cancel: keep them — they'll stay on the Rounds page without a match link. You can delete them separately from there later if you want.`
        );
        if (removeRounds) linkedRounds.forEach((r) => DataStore.remove('rounds', r.id));
      }
      DataStore.remove('matches', match.id);
      if (matchEditState?.matchId === match.id) matchEditState = null;
      renderMatchesView();
    });
  }
}
