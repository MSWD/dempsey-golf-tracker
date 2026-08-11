// Admin-only "Data Maintenance" page: local snapshot history (one Restore button per entry) plus
// the Export/Import season actions, relocated here from the top nav bar. See GitHub issue #30.
// Gated at the nav-tab level (`.admin-only` on the tab button in index.html) and again here at
// render time, same defense-in-depth pattern as every other admin action (the old header import
// handler, ui-help.js's reset handler) — a non-admin somehow forcing this view still sees nothing.
function renderMaintenanceView() {
  const el = document.getElementById('view-maintenance');
  if (!AppState.isAdmin) {
    el.innerHTML = '';
    return;
  }

  const snapshots = DataStore.listSnapshots(); // newest first

  el.innerHTML = `
    <div class="card notice">
      <h2>⚠️ Local safety net only</h2>
      <p>Snapshots below live only in this browser's local storage, same as the rest of your
      season data — they are <strong>not</strong> backed up anywhere else and are lost if this
      browser's data is cleared. They exist to undo an accidental Import or Restore on
      <em>this device</em>, not as a substitute for exporting a backup file regularly.</p>
    </div>

    <div class="card">
      <h2>Export / Import season</h2>
      <p>"Export season" downloads everything as a JSON file — do this regularly as a backup.
      "Import season" replaces all current data with a previously exported file; the data being
      replaced is saved as a snapshot below automatically first.</p>
      <div class="form-row">
        <button id="btn-export">Export season</button>
        <button id="btn-import">Import season</button>
        <input type="file" id="file-import" accept="application/json" class="hidden">
      </div>
    </div>

    <div class="card">
      <h2>Snapshot history</h2>
      <p class="muted">Taken automatically right before an Import or Restore replaces your data —
      not on a timer. The most recent 20 are kept; older ones are dropped.</p>
      ${snapshots.length === 0 ? '<p class="muted">No snapshots yet.</p>' : `
      <div class="table-wrap">
        <table>
          <thead>
            <tr><th>When</th><th>Reason</th><th>Players</th><th>Rounds</th><th>Matches</th><th></th></tr>
          </thead>
          <tbody id="snapshot-rows"></tbody>
        </table>
      </div>`}
    </div>
  `;

  if (snapshots.length) {
    const rows = el.querySelector('#snapshot-rows');
    rows.innerHTML = snapshots.map((s) => `
      <tr data-id="${escapeHtml(s.id)}">
        <td>${escapeHtml(new Date(s.timestamp).toLocaleString())}</td>
        <td>${escapeHtml(s.reason)}</td>
        <td>${s.data.players.length}</td>
        <td>${s.data.rounds.length}</td>
        <td>${s.data.matches.length}</td>
        <td><button class="btn-restore">Restore</button></td>
      </tr>
    `).join('');

    rows.querySelectorAll('tr').forEach((tr) => {
      const id = tr.dataset.id;
      const snapshot = snapshots.find((s) => s.id === id);
      tr.querySelector('.btn-restore').addEventListener('click', () => {
        if (!AppState.isAdmin) return;
        const confirmed = confirm(
          `Restoring this snapshot (from ${new Date(snapshot.timestamp).toLocaleString()}) replaces ` +
          `ALL current data in this browser (roster, rounds, matches) — this cannot be undone, though ` +
          `the data being replaced will itself be saved as a new snapshot first. Continue?`
        );
        if (!confirmed) return;
        DataStore.restoreSnapshot(id);
        updateSeasonNameUI();
        alert('Restore successful.');
        showView('roster');
      });
    });
  }

  el.querySelector('#btn-export').addEventListener('click', () => {
    if (!AppState.isAdmin) return;
    DataStore.exportJSON();
  });
  el.querySelector('#btn-import').addEventListener('click', () => {
    if (!AppState.isAdmin) return;
    el.querySelector('#file-import').click();
  });
  el.querySelector('#file-import').addEventListener('change', async (e) => {
    const file = e.target.files[0];
    if (!file || !AppState.isAdmin) return;
    const confirmed = confirm(
      `Importing a season replaces ALL current data in this browser (roster, rounds, matches) ` +
      `with the contents of "${file.name}" — this cannot be undone. ` +
      `Make sure you've exported the current season first if you want to keep it. Continue?`
    );
    if (!confirmed) {
      e.target.value = '';
      return;
    }
    try {
      await DataStore.importJSON(file);
      updateSeasonNameUI();
      alert('Import successful.');
      showView('roster');
    } catch (err) {
      alert(`Import failed: ${err.message}`);
    } finally {
      e.target.value = '';
    }
  });
}
