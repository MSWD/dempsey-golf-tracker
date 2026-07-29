function renderCoursesView() {
  const el = document.getElementById('view-courses');
  const courses = DataStore.getAll('courses').slice().sort((a, b) => a.name.localeCompare(b.name));

  el.innerHTML = `
    <div class="card admin-only">
      <h2>Add course</h2>
      <div class="form-row">
        <input type="text" id="new-course-name" placeholder="Course name">
      </div>
      <div class="form-row" id="new-course-pars">
        ${Array.from({ length: 9 }, (_, i) => `<input type="number" class="hole-input" data-hole="${i}" placeholder="P${i + 1}" min="3" max="6">`).join('')}
      </div>
      <button class="primary" id="btn-add-course">Add course</button>
    </div>
    <div class="table-wrap">
      <table>
        <thead>
          <tr><th>Course</th><th>Total par</th><th>Hole pars</th><th></th></tr>
        </thead>
        <tbody id="courses-rows"></tbody>
      </table>
    </div>
  `;

  const rows = el.querySelector('#courses-rows');
  rows.innerHTML = courses.map((c) => `
    <tr data-id="${c.id}">
      <td>${escapeHtml(c.name)} ${c.verified ? '' : '<span class="badge warn">unverified</span>'}</td>
      <td>${c.totalPar}</td>
      <td class="muted">${c.holePars.join('-')}</td>
      <td><button class="btn-remove admin-only">Remove</button></td>
    </tr>
    <tr class="tee-sets-row" data-id="${c.id}">
      <td colspan="4">
        <details>
          <summary>Tee sets (${(c.teeSets || []).length})</summary>
          <div class="table-wrap">
            <table>
              <thead><tr><th class="admin-only">Default</th><th>Name</th><th>Par</th><th>Yardage</th><th>Slope</th><th>Rating</th><th></th></tr></thead>
              <tbody>
                ${(c.teeSets || []).map((t) => `
                  <tr data-tee-id="${t.id}">
                    <td class="admin-only">
                      <input type="radio" class="default-tee-radio" name="default-tee-${c.id}" ${t.id === c.defaultTeeSetId ? 'checked' : ''}>
                    </td>
                    <td>${escapeHtml(t.name)} ${t.id === c.defaultTeeSetId ? '<span class="badge">default</span>' : ''}</td>
                    <td>${teeSetTotalPar(c, t)}${t.holeParsOverride ? ' <span class="badge">override</span>' : ''}</td>
                    <td>${teeSetTotalYardage(t) ?? '—'}</td>
                    <td>${t.slope ?? '—'}</td>
                    <td>${t.rating ?? '—'}</td>
                    <td><button class="btn-remove-tee-set admin-only">Remove</button></td>
                  </tr>
                `).join('')}
              </tbody>
            </table>
          </div>
          <div class="admin-only">
            <div class="form-row">
              <input type="text" class="new-tee-name" placeholder="Tee set name (e.g. Gold)">
            </div>
            <div class="form-row new-tee-yardages">
              ${Array.from({ length: 9 }, (_, i) => `<input type="number" class="hole-input" data-hole="${i}" placeholder="Y${i + 1}">`).join('')}
            </div>
            <label class="muted"><input type="checkbox" class="tee-par-override-toggle"> Different par on this tee (rare)</label>
            <div class="form-row new-tee-pars" style="display:none">
              ${Array.from({ length: 9 }, (_, i) => `<input type="number" class="hole-input" data-hole="${i}" placeholder="P${i + 1} (course: ${c.holePars[i]})" min="3" max="6">`).join('')}
            </div>
            <div class="form-row">
              <input type="number" class="new-tee-slope" placeholder="Slope (optional)">
              <input type="number" step="0.1" class="new-tee-rating" placeholder="Rating (optional)">
            </div>
            <button class="btn-add-tee-set" data-course-id="${c.id}">Add tee set</button>
          </div>
        </details>
      </td>
    </tr>
  `).join('');

  rows.querySelectorAll('.btn-remove').forEach((btn) => {
    btn.addEventListener('click', () => {
      const id = btn.closest('tr').dataset.id;
      if (confirm('Remove this course?')) {
        DataStore.remove('courses', id);
        renderCoursesView();
      }
    });
  });

  rows.querySelectorAll('.tee-par-override-toggle').forEach((cb) => {
    cb.addEventListener('change', () => {
      cb.closest('details').querySelector('.new-tee-pars').style.display = cb.checked ? '' : 'none';
    });
  });

  rows.querySelectorAll('.btn-remove-tee-set').forEach((btn) => {
    btn.addEventListener('click', () => {
      const courseId = btn.closest('tr.tee-sets-row').dataset.id;
      const teeId = btn.closest('tr[data-tee-id]').dataset.teeId;
      const course = DataStore.getById('courses', courseId);
      if (confirm('Remove this tee set?')) {
        const patch = { teeSets: course.teeSets.filter((t) => t.id !== teeId) };
        if (course.defaultTeeSetId === teeId) patch.defaultTeeSetId = null;
        DataStore.update('courses', courseId, patch);
        renderCoursesView();
      }
    });
  });

  rows.querySelectorAll('.default-tee-radio').forEach((radio) => {
    radio.addEventListener('change', () => {
      const courseId = radio.closest('tr.tee-sets-row').dataset.id;
      const teeId = radio.closest('tr[data-tee-id]').dataset.teeId;
      DataStore.update('courses', courseId, { defaultTeeSetId: teeId });
      renderCoursesView();
    });
  });

  rows.querySelectorAll('.btn-add-tee-set').forEach((btn) => {
    btn.addEventListener('click', () => {
      const courseId = btn.dataset.courseId;
      const course = DataStore.getById('courses', courseId);
      const details = btn.closest('details');
      const name = details.querySelector('.new-tee-name').value.trim();
      const holeYardages = Array.from(details.querySelectorAll('.new-tee-yardages input')).map((i) => Number(i.value));
      const overrideOn = details.querySelector('.tee-par-override-toggle').checked;
      const holeParsOverride = overrideOn
        ? Array.from(details.querySelectorAll('.new-tee-pars input')).map((i) => Number(i.value))
        : null;
      const slopeInput = details.querySelector('.new-tee-slope').value;
      const ratingInput = details.querySelector('.new-tee-rating').value;
      const slope = slopeInput ? Number(slopeInput) : null;
      const rating = ratingInput ? Number(ratingInput) : null;

      if (!name || holeYardages.some((y) => !y)) {
        alert('Tee set name and all 9 yardages are required.');
        return;
      }
      if (overrideOn && holeParsOverride.some((p) => !p)) {
        alert('If "different par" is checked, all 9 par values are required.');
        return;
      }
      DataStore.update('courses', courseId, {
        teeSets: [...(course.teeSets || []), newTeeSet({ name, holeYardages, holeParsOverride, slope, rating })],
      });
      renderCoursesView();
    });
  });

  el.querySelector('#btn-add-course').addEventListener('click', () => {
    const name = el.querySelector('#new-course-name').value.trim();
    const holePars = Array.from(el.querySelectorAll('#new-course-pars input')).map((i) => Number(i.value));
    if (!name || holePars.some((p) => !p)) {
      alert('Course name and all 9 hole pars are required.');
      return;
    }
    DataStore.add('courses', newCourse({ name, holePars, verified: false }));
    renderCoursesView();
  });
}
