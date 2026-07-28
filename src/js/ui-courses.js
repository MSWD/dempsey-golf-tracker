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
