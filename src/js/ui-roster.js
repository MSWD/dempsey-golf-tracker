function renderRosterView(editingPlayerId) {
  const el = document.getElementById('view-roster');

  // See viewerRedirectNotice (html-utils.js) / GitHub issue #39 — a viewer's local roster is
  // essentially never the team's actual roster. The published Rankings table already lists every
  // player by name and grade, so it's a reasonable stand-in even though it isn't a roster page.
  if (!AppState.isAdmin) {
    el.innerHTML = viewerRedirectNotice(
      "The roster shown here is only meaningful from the coach's own browser — this device's " +
      'local data likely isn\'t in sync with the team\'s. The published report lists every ' +
      'player by name and grade.'
    );
    return;
  }

  const players = DataStore.getAll('players').slice().sort((a, b) => a.lastName.localeCompare(b.lastName));
  const editingPlayer = editingPlayerId ? DataStore.getById('players', editingPlayerId) : null;

  el.innerHTML = `
    <div class="card admin-only">
      <h2>${editingPlayer ? 'Edit player' : 'Add player'}</h2>
      <div class="form-row">
        <input type="text" id="new-first-name" placeholder="First name" value="${editingPlayer ? escapeHtml(editingPlayer.firstName) : ''}">
        <input type="text" id="new-last-name" placeholder="Last name" value="${editingPlayer ? escapeHtml(editingPlayer.lastName) : ''}">
        <input type="number" id="new-grade" class="input-medium" placeholder="Grade" min="5" max="12" value="${editingPlayer ? escapeHtml(editingPlayer.grade) : ''}">
        <button class="primary" id="btn-add-player">${editingPlayer ? 'Update' : 'Add'}</button>
        ${editingPlayer ? '<button id="btn-cancel-edit-player">Cancel</button>' : ''}
      </div>
    </div>
    <p class="muted admin-only">Click a row to edit a player's name or grade.</p>
    <div class="table-wrap">
      <table>
        <thead>
          <tr><th>Name</th><th>Grade</th><th>Active</th><th></th></tr>
        </thead>
        <tbody id="roster-rows"></tbody>
      </table>
    </div>
  `;

  const rows = el.querySelector('#roster-rows');
  rows.innerHTML = players.map((p) => `
    <tr class="player-row" data-id="${escapeHtml(p.id)}">
      <td>${escapeHtml(p.firstName)} ${escapeHtml(p.lastName)}</td>
      <td>${escapeHtml(p.grade)}</td>
      <td>
        <input type="checkbox" class="toggle-active admin-only" ${p.active ? 'checked' : ''}>
        <span class="viewer-only">${p.active ? 'Yes' : 'No'}</span>
      </td>
      <td><button class="btn-remove admin-only">Remove</button></td>
    </tr>
  `).join('');

  rows.querySelectorAll('tr').forEach((tr) => {
    const id = tr.dataset.id;
    tr.querySelector('.toggle-active').addEventListener('change', (e) => {
      e.stopPropagation();
      DataStore.update('players', id, { active: e.target.checked });
    });
    tr.querySelector('.btn-remove').addEventListener('click', (e) => {
      e.stopPropagation();
      if (confirm('Remove this player?')) {
        DataStore.remove('players', id);
        renderRosterView();
      }
    });
    tr.addEventListener('click', () => {
      if (!AppState.isAdmin) return;
      renderRosterView(id);
      el.querySelector('.card').scrollIntoView({ behavior: 'smooth' });
    });
  });

  const cancelBtn = el.querySelector('#btn-cancel-edit-player');
  if (cancelBtn) cancelBtn.addEventListener('click', () => renderRosterView(null));

  el.querySelector('#btn-add-player').addEventListener('click', () => {
    const firstName = el.querySelector('#new-first-name').value.trim();
    const lastName = el.querySelector('#new-last-name').value.trim();
    const grade = Number(el.querySelector('#new-grade').value);
    if (!firstName || !lastName || !grade) {
      alert('First name, last name, and grade are required.');
      return;
    }
    if (editingPlayer) {
      DataStore.update('players', editingPlayer.id, { firstName, lastName, grade });
    } else {
      DataStore.add('players', newPlayer({ firstName, lastName, grade }));
    }
    renderRosterView(null);
  });
}
