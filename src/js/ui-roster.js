function renderRosterView() {
  const el = document.getElementById('view-roster');
  const players = DataStore.getAll('players').slice().sort((a, b) => a.lastName.localeCompare(b.lastName));

  el.innerHTML = `
    <div class="card admin-only">
      <h2>Add player</h2>
      <div class="form-row">
        <input type="text" id="new-first-name" placeholder="First name">
        <input type="text" id="new-last-name" placeholder="Last name">
        <input type="number" id="new-grade" class="input-medium" placeholder="Grade" min="5" max="12">
        <button class="primary" id="btn-add-player">Add</button>
      </div>
    </div>
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
    <tr data-id="${escapeHtml(p.id)}">
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
      DataStore.update('players', id, { active: e.target.checked });
    });
    tr.querySelector('.btn-remove').addEventListener('click', () => {
      if (confirm('Remove this player?')) {
        DataStore.remove('players', id);
        renderRosterView();
      }
    });
  });

  el.querySelector('#btn-add-player').addEventListener('click', () => {
    const firstName = el.querySelector('#new-first-name').value.trim();
    const lastName = el.querySelector('#new-last-name').value.trim();
    const grade = Number(el.querySelector('#new-grade').value);
    if (!firstName || !lastName || !grade) {
      alert('First name, last name, and grade are required.');
      return;
    }
    DataStore.add('players', newPlayer({ firstName, lastName, grade }));
    renderRosterView();
  });
}
