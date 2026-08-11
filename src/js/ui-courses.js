function holeInputs({ length, className, prefix, min = null, max = null, values = [], offset = 0 }) {
  return Array.from({ length }, (_, i) => {
    const minAttr = min == null ? '' : ` min="${min}"`;
    const maxAttr = max == null ? '' : ` max="${max}"`;
    const valueAttr = values[i] == null ? '' : ` value="${values[i]}"`;
    return `<input type="number" class="${className}" data-hole="${offset + i}" placeholder="${prefix}${offset + i + 1}"${minAttr}${maxAttr}${valueAttr}>`;
  }).join('');
}

function groupedHoleInputs({ length, className, prefix, min = null, max = null, values = [] }) {
  if (length <= 9) return `<div class="form-row hole-input-row">${holeInputs({ length, className, prefix, min, max, values })}</div>`;
  return `
    <div class="hole-group">
      <span class="muted">Front</span>
      <div class="form-row hole-input-row">${holeInputs({ length: 9, className, prefix, min, max, values })}</div>
    </div>
    <div class="hole-group">
      <span class="muted">Back</span>
      <div class="form-row hole-input-row">${holeInputs({ length: 9, className, prefix, min, max, values: values.slice(9), offset: 9 })}</div>
    </div>
  `;
}

function courseUsageCounts(courseId) {
  return {
    rounds: DataStore.getAll('rounds').filter((r) => r.courseId === courseId).length,
    matches: DataStore.getAll('matches').filter((m) => m.courseId === courseId).length,
  };
}

function teeSetUsageCounts(teeSetId) {
  return {
    rounds: DataStore.getAll('rounds').filter((r) => r.teeSetId === teeSetId).length,
    matches: DataStore.getAll('matches').filter((m) => m.teeSetId === teeSetId).length,
  };
}

function courseParSummary(course) {
  if (isEighteenHoleCourse(course)) {
    return `18 holes · Front ${sideTotal(course.holePars, 'front')} / Back ${sideTotal(course.holePars, 'back')} / Total ${roundTotalPar(course.holePars)}`;
  }
  return `9 holes · Par ${roundTotalPar(course.holePars)}`;
}

function teeSetParSummary(course, teeSet) {
  if (isEighteenHoleCourse(course)) {
    return `Front ${teeSetTotalPar(course, teeSet, 'front')} / Back ${teeSetTotalPar(course, teeSet, 'back')}`;
  }
  return teeSetTotalPar(course, teeSet);
}

function teeSetYardageSummary(course, teeSet) {
  if (!teeSet || !teeSet.holeYardages) return '—';
  if (isEighteenHoleCourse(course)) {
    return `Front ${teeSetTotalYardage(teeSet, 'front')} / Back ${teeSetTotalYardage(teeSet, 'back')}`;
  }
  return teeSetTotalYardage(teeSet) ?? '—';
}

// editingCourseId: course loaded into the top "Add/Edit course" form.
// editingTeeSet: { courseId, teeSetId } for a tee set loaded into its course's "Add/Edit tee set"
// mini-form — kept separate from editingCourseId since you edit a tee set from within its own
// course's (already-open) details panel, not from the top-level form.
function renderCoursesView(editingCourseId, editingTeeSet) {
  const el = document.getElementById('view-courses');

  // See viewerRedirectNotice (html-utils.js) / GitHub issue #39. Courses exists purely to feed
  // data entry (pars, yardages, tee sets used when logging rounds/matches) — a viewer has no
  // independent use for it, and there's no published-report equivalent to point at either, so this
  // is just a plain "nothing to see here" rather than a link to a matching public view.
  if (!AppState.isAdmin) {
    el.innerHTML = viewerRedirectNotice(
      'Course setup is only used for entering rounds and matches — there\'s nothing here for a ' +
      "viewer to see. Check the published report for the team's actual results."
    );
    return;
  }

  const courses = DataStore.getAll('courses').slice().sort((a, b) => a.name.localeCompare(b.name));
  const editingCourse = editingCourseId ? DataStore.getById('courses', editingCourseId) : null;

  // A course's tee-sets <details> is easy to lose track of on re-render (the whole view is
  // rebuilt from scratch), which would be a jarring UX every time an unrelated field changes —
  // capture what's open beforehand and restore it below, alongside whichever course a tee-set
  // edit is targeting (which must be forced open even if it wasn't already).
  const previouslyOpenIds = new Set(
    Array.from(el.querySelectorAll('tr.tee-sets-row')).filter((tr) => tr.querySelector('details')?.open).map((tr) => tr.dataset.id)
  );
  if (editingTeeSet) previouslyOpenIds.add(editingTeeSet.courseId);

  el.innerHTML = `
    <div class="card admin-only">
      <h2>${editingCourse ? 'Edit course' : 'Add course'}</h2>
      <div class="form-row">
        <input type="text" id="new-course-name" placeholder="Course name" value="${editingCourse ? escapeHtml(editingCourse.name) : ''}">
        ${editingCourse
          ? `<span class="muted">${courseHoleCount(editingCourse)} holes (layout can't change once tee sets exist)</span>`
          : `<select id="new-course-hole-count">
               <option value="9">9 holes</option>
               <option value="18">18 holes</option>
             </select>`}
      </div>
      <div id="new-course-pars"></div>
      <button class="primary" id="btn-add-course">${editingCourse ? 'Update course' : 'Add course'}</button>
      ${editingCourse ? '<button id="btn-cancel-edit-course">Cancel</button>' : ''}
    </div>
    <p class="muted admin-only">Click a course's name to edit it, or a tee set's name to edit that tee.</p>
    <div class="table-wrap">
      <table>
        <thead>
          <tr><th class="admin-only">Home</th><th>Course</th><th>Layout</th><th>Hole pars</th><th></th></tr>
        </thead>
        <tbody id="courses-rows"></tbody>
      </table>
    </div>
  `;

  const courseHoleCountSelect = el.querySelector('#new-course-hole-count');
  const courseParsEl = el.querySelector('#new-course-pars');
  function renderCoursePars() {
    courseParsEl.innerHTML = groupedHoleInputs({
      length: editingCourse ? courseHoleCount(editingCourse) : Number(courseHoleCountSelect.value),
      className: 'hole-input par-input',
      prefix: 'P',
      min: 3,
      max: 6,
      values: editingCourse ? editingCourse.holePars : [],
    });
  }
  renderCoursePars();
  if (courseHoleCountSelect) courseHoleCountSelect.addEventListener('change', renderCoursePars);

  const cancelCourseBtn = el.querySelector('#btn-cancel-edit-course');
  if (cancelCourseBtn) cancelCourseBtn.addEventListener('click', () => renderCoursesView(null, null));

  const homeCourseId = DataStore.getHomeCourseId();
  const rows = el.querySelector('#courses-rows');
  rows.innerHTML = courses.map((c) => `
    <tr data-id="${escapeHtml(c.id)}">
      <td class="admin-only">
        <input type="radio" class="home-course-radio" name="home-course" ${c.id === homeCourseId ? 'checked' : ''}>
      </td>
      <td>
        <span class="admin-only editable-name btn-edit-course" data-course-id="${escapeHtml(c.id)}">${escapeHtml(c.name)}</span>
        <span class="viewer-only">${escapeHtml(c.name)}</span>
        ${c.verified ? '' : ' <span class="badge warn">unverified</span>'}
        ${c.id === homeCourseId ? ' <span class="badge">home</span>' : ''}
      </td>
      <td>${courseParSummary(c)}</td>
      <td class="muted">${escapeHtml(c.holePars.join('-'))}</td>
      <td><button class="btn-remove admin-only">Remove</button></td>
    </tr>
    <tr class="tee-sets-row" data-id="${escapeHtml(c.id)}">
      <td colspan="5">
        <details ${previouslyOpenIds.has(c.id) ? 'open' : ''}>
          <summary>Tee sets (${(c.teeSets || []).length})</summary>
          <div class="table-wrap">
            <table>
              <thead><tr><th class="admin-only">Default</th><th>Name</th><th>Par</th><th>Yardage</th><th>Slope</th><th>Rating</th><th></th></tr></thead>
              <tbody>
                ${(c.teeSets || []).map((t) => `
                  <tr data-tee-id="${escapeHtml(t.id)}">
                    <td class="admin-only">
                      <input type="radio" class="default-tee-radio" name="default-tee-${escapeHtml(c.id)}" ${t.id === c.defaultTeeSetId ? 'checked' : ''}>
                    </td>
                    <td>
                      <span class="admin-only editable-name btn-edit-tee-set" data-course-id="${escapeHtml(c.id)}" data-tee-id="${escapeHtml(t.id)}">${escapeHtml(t.name)}</span>
                      <span class="viewer-only">${escapeHtml(t.name)}</span>
                      ${t.id === c.defaultTeeSetId ? ' <span class="badge">default</span>' : ''}
                    </td>
                    <td>${teeSetParSummary(c, t)}${t.holeParsOverride ? ' <span class="badge">override</span>' : ''}</td>
                    <td>${teeSetYardageSummary(c, t)}</td>
                    <td>${t.slope ?? '—'}</td>
                    <td>${t.rating ?? '—'}</td>
                    <td><button class="btn-remove-tee-set admin-only">Remove</button></td>
                  </tr>
                `).join('')}
              </tbody>
            </table>
          </div>
          <div class="admin-only">
            <h3>${editingTeeSet && editingTeeSet.courseId === c.id ? 'Edit tee set' : 'Add tee set'}</h3>
            <div class="form-row">
              <input type="text" class="new-tee-name" placeholder="Tee set name (e.g. Gold)" value="${editingTeeSet && editingTeeSet.courseId === c.id ? escapeHtml(findTeeSet(c, editingTeeSet.teeSetId)?.name ?? '') : ''}">
            </div>
            <div class="new-tee-yardages">
              ${groupedHoleInputs({
                length: courseHoleCount(c),
                className: 'hole-input yardage-input',
                prefix: 'Y',
                values: (editingTeeSet && editingTeeSet.courseId === c.id ? findTeeSet(c, editingTeeSet.teeSetId)?.holeYardages : null) ?? [],
              })}
            </div>
            <label class="muted"><input type="checkbox" class="tee-par-override-toggle" ${editingTeeSet && editingTeeSet.courseId === c.id && findTeeSet(c, editingTeeSet.teeSetId)?.holeParsOverride ? 'checked' : ''}> Different par on this tee (rare)</label>
            <div class="new-tee-pars ${editingTeeSet && editingTeeSet.courseId === c.id && findTeeSet(c, editingTeeSet.teeSetId)?.holeParsOverride ? '' : 'hidden'}">
              ${groupedHoleInputs({
                length: courseHoleCount(c),
                className: 'hole-input par-input',
                prefix: 'P',
                min: 3,
                max: 6,
                values: (editingTeeSet && editingTeeSet.courseId === c.id ? findTeeSet(c, editingTeeSet.teeSetId)?.holeParsOverride : null) ?? c.holePars,
              })}
            </div>
            <div class="form-row">
              <input type="number" class="new-tee-slope" placeholder="Slope (optional)" value="${editingTeeSet && editingTeeSet.courseId === c.id ? (findTeeSet(c, editingTeeSet.teeSetId)?.slope ?? '') : ''}">
              <input type="number" step="0.1" class="new-tee-rating" placeholder="Rating (optional)" value="${editingTeeSet && editingTeeSet.courseId === c.id ? (findTeeSet(c, editingTeeSet.teeSetId)?.rating ?? '') : ''}">
            </div>
            <button class="btn-add-tee-set" data-course-id="${escapeHtml(c.id)}">${editingTeeSet && editingTeeSet.courseId === c.id ? 'Update tee set' : 'Add tee set'}</button>
            ${editingTeeSet && editingTeeSet.courseId === c.id ? '<button class="btn-cancel-edit-tee-set">Cancel</button>' : ''}
          </div>
        </details>
      </td>
    </tr>
  `).join('');

  rows.querySelectorAll('.btn-edit-course').forEach((span) => {
    span.addEventListener('click', () => {
      renderCoursesView(span.dataset.courseId, null);
      el.querySelector('.card').scrollIntoView({ behavior: 'smooth' });
    });
  });

  rows.querySelectorAll('.btn-remove').forEach((btn) => {
    btn.addEventListener('click', () => {
      const id = btn.closest('tr').dataset.id;
      const { rounds, matches } = courseUsageCounts(id);
      const usageNote = (rounds || matches)
        ? ` This course is referenced by ${rounds} round(s) and ${matches} match(es) — removing it won't delete those records, but their par comparisons will become unavailable.`
        : '';
      if (confirm(`Remove this course?${usageNote}`)) {
        DataStore.remove('courses', id);
        if (DataStore.getHomeCourseId() === id) DataStore.setHomeCourseId(null);
        renderCoursesView();
      }
    });
  });

  rows.querySelectorAll('.home-course-radio').forEach((radio) => {
    radio.addEventListener('change', () => {
      DataStore.setHomeCourseId(radio.closest('tr').dataset.id);
      renderCoursesView();
    });
  });

  const clearHomeBtn = el.querySelector('#btn-clear-home-course');
  if (clearHomeBtn) {
    clearHomeBtn.addEventListener('click', () => {
      DataStore.setHomeCourseId(null);
      renderCoursesView();
    });
  }

  rows.querySelectorAll('.tee-par-override-toggle').forEach((cb) => {
    cb.addEventListener('change', () => {
      cb.closest('details').querySelector('.new-tee-pars').classList.toggle('hidden', !cb.checked);
    });
  });

  rows.querySelectorAll('.btn-remove-tee-set').forEach((btn) => {
    btn.addEventListener('click', () => {
      const courseId = btn.closest('tr.tee-sets-row').dataset.id;
      const teeId = btn.closest('tr[data-tee-id]').dataset.teeId;
      const course = DataStore.getById('courses', courseId);
      const { rounds, matches } = teeSetUsageCounts(teeId);
      const usageNote = (rounds || matches)
        ? ` This tee set is referenced by ${rounds} round(s) and ${matches} match(es) — removing it won't delete those records, but their yardage/par comparisons will become unavailable.`
        : '';
      if (confirm(`Remove this tee set?${usageNote}`)) {
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

  rows.querySelectorAll('.btn-edit-tee-set').forEach((span) => {
    span.addEventListener('click', () => {
      renderCoursesView(null, { courseId: span.dataset.courseId, teeSetId: span.dataset.teeId });
    });
  });

  rows.querySelectorAll('.btn-cancel-edit-tee-set').forEach((btn) => {
    btn.addEventListener('click', () => renderCoursesView());
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
        alert(`Tee set name and all ${courseHoleCount(course)} yardages are required.`);
        return;
      }
      if (overrideOn && holeParsOverride.some((p) => !p)) {
        alert(`If "different par" is checked, all ${courseHoleCount(course)} par values are required.`);
        return;
      }

      const isEditingThisTee = editingTeeSet && editingTeeSet.courseId === courseId;
      if (isEditingThisTee) {
        DataStore.update('courses', courseId, {
          teeSets: course.teeSets.map((t) => (t.id === editingTeeSet.teeSetId ? { ...t, name, holeYardages, holeParsOverride, slope, rating } : t)),
        });
      } else {
        DataStore.update('courses', courseId, {
          teeSets: [...(course.teeSets || []), newTeeSet({ name, holeYardages, holeParsOverride, slope, rating })],
        });
      }
      renderCoursesView();
    });
  });

  el.querySelector('#btn-add-course').addEventListener('click', () => {
    const name = el.querySelector('#new-course-name').value.trim();
    const holeCount = editingCourse ? courseHoleCount(editingCourse) : Number(courseHoleCountSelect.value);
    const holePars = Array.from(el.querySelectorAll('#new-course-pars input')).map((i) => Number(i.value));
    if (!name || holePars.some((p) => !p)) {
      alert(`Course name and all ${holeCount} hole pars are required.`);
      return;
    }
    if (editingCourse) {
      DataStore.update('courses', editingCourse.id, { name, holePars, totalPar: holePars.reduce((sum, par) => sum + par, 0) });
    } else {
      DataStore.add('courses', newCourse({ name, holePars, verified: false }));
    }
    renderCoursesView();
  });
}
