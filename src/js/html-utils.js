// Escapes text before interpolating it into innerHTML. Needed anywhere a coach-entered or
// published field (player/course names, match location, free-text display names) meets a
// template string — those values are shared across teams on one origin and are rendered in other
// people's browsers (other admins, and the public report viewer), so they're never safe to trust
// as raw HTML. See docs/decisions.md.
function escapeHtml(str) {
  return String(str).replace(/[&<>"']/g, (c) => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;',
  }[c]));
}

// Wraps a numeric-entry input with +/- stepper buttons. The input is `type="text"
// inputmode="numeric"`, not `type="number"` — see "Why score-entry fields are type=text
// inputmode=numeric" in docs/decisions.md (short version: it lets wireSelectOnFocus select the
// field's contents on focus, which type=number forbids). That makes these buttons the *only*
// increment/decrement affordance on every platform now, not just on iOS/iPadOS WebKit where the
// native spinner was already absent (GitHub issue #33).
//
// Shared by ui-matches.js (hole scores + putts) and ui-rounds.js (same) rather than duplicated in
// both, since the duplication of the plain <input> markup between those two files was exactly what
// let this gap go unnoticed in one of them — see docs/architecture.md.
//
// `min` only bounds the stepper's own decrement (so "-" can't produce a negative score/putts
// count); it's deliberately not enforced as an upper bound here — the existing double-par cap
// (scoring-engine.js) already handles that at submit time, with its own warning, and this input
// still accepts direct typing/pasting above it same as before. `input.min` reflects the `min`
// content attribute on a text input just as it does on a number one, so wireStepperButtons reads
// it the same way.
// Non-admin ("viewer") fallback for any tab whose primary content is this browser's own local
// DataStore data. Originated in renderRankView (ui-rounds.js) and generalized here for the other
// local-data tabs (Roster, Courses, Rounds, Charts, Matches) — see GitHub issue #39. Only the
// coach ever signs in and edits data, so a viewer's local store is essentially never the team's
// real data (usually empty, occasionally stale) — rendering it would be misleading rather than
// just unhelpful. Send viewers to the published report instead, which reflects the actual season
// data regardless of whose browser they're on.
function viewerRedirectNotice(message) {
  return `
    <p class="muted">${message}</p>
    <p><a href="reports/index.html">View published report</a></p>
  `;
}

function renderStepperInput({ className = '', dataAttrs = '', placeholder = '', value = '', min = 0 } = {}) {
  return `
    <span class="stepper">
      <button type="button" class="stepper-btn stepper-minus" tabindex="-1" aria-label="Decrease ${escapeHtml(placeholder) || 'value'}">&minus;</button>
      <input type="text" inputmode="numeric" class="${className}" ${dataAttrs} placeholder="${escapeHtml(placeholder)}" value="${escapeHtml(value)}" min="${min}">
      <button type="button" class="stepper-btn stepper-plus" tabindex="-1" aria-label="Increase ${escapeHtml(placeholder) || 'value'}">+</button>
    </span>
  `;
}

// Wires every `.stepper`'s buttons within `container` to nudge the input inside it. Call once,
// right after the markup containing them is inserted (re-querying on every render is cheap and
// avoids a separate "did this already get wired" flag).
//
// An empty input has no current number to nudge from, so "+" starts it at `min` (or 1, whichever
// is larger — nudging from empty should always produce a real, nonzero-looking value) and "-" is a
// no-op (nothing to decrement below). Dispatches real `input`/`change` events afterward so this
// behaves identically to the user having typed the new value themselves, for any other listener on
// the field (native browser validation, autosave-on-change, etc.).
function wireStepperButtons(container) {
  container.querySelectorAll('.stepper').forEach((stepper) => {
    const input = stepper.querySelector('input');
    const min = Number(input.min) || 0;
    const nudge = (delta) => {
      if (input.value === '') {
        if (delta < 0) return;
        input.value = Math.max(min, 1);
      } else {
        input.value = Math.max(min, Number(input.value) + delta);
      }
      input.dispatchEvent(new Event('input', { bubbles: true }));
      input.dispatchEvent(new Event('change', { bubbles: true }));
      // If the field was already focused when its stepper was tapped, leave the new value selected
      // so the next keystroke replaces it — same tab-through flow wireSelectOnFocus gives on focus.
      // Guarded on the field itself having focus, never forcing it: on desktop a "+"/"-" click
      // lands focus on the tabindex="-1" button (so this is a no-op there), and force-focusing the
      // input would pop the on-screen keyboard on iPad, which is what the steppers exist to avoid.
      // Where it does fire — a focused field on iPad — select() works because the field is text.
      if (document.activeElement === input) input.select();
    };
    stepper.querySelector('.stepper-minus').addEventListener('click', () => nudge(-1));
    stepper.querySelector('.stepper-plus').addEventListener('click', () => nudge(1));
  });
}

// Selects an input's existing contents whenever it takes focus, so tabbing (or tapping) from field
// to field lets the coach immediately type the new number over the old one. Both score-entry forms
// and the course par/yardage grids pre-fill every box with a default (par, double par, the course's
// current pars), so without this every field has to be manually cleared first — clunky when a
// player is reading scores aloud. Call once, right after the markup is inserted (re-querying per
// render is cheap; no already-wired flag needed).
//
// Targets `input[inputmode="numeric"]` — every field renderStepperInput / holeInputs emits, and
// the raw putts inputs, but not the name/date/text fields that share these containers. This only
// works because those fields are `type="text"`, not `type="number"`: `select()` is a no-op on a
// number input by spec. See "Why score-entry fields are type=text inputmode=numeric" in
// docs/decisions.md for the full rationale and what that trade-off gives up.
//
// Two browser quirks handled:
//  - iOS/iPadOS WebKit tends to discard a selection made synchronously inside the focus handler, so
//    it's re-asserted once on the next frame (guarded on the field still being focused; a no-op on
//    desktop, where the first select already stuck).
//  - A mouse click focuses the field first and then places the caret on mouseup, which would undo
//    the select. preventDefault on that first post-focus mouseup keeps the selection; later clicks
//    inside an already-focused field still position the caret normally.
function wireSelectOnFocus(container, selector = 'input[inputmode="numeric"]') {
  container.querySelectorAll(selector).forEach((input) => {
    let selectPending = false;
    input.addEventListener('focus', () => {
      selectPending = true;
      input.select();
      requestAnimationFrame(() => {
        if (document.activeElement === input) input.select();
      });
    });
    input.addEventListener('mouseup', (e) => {
      if (selectPending) {
        e.preventDefault();
        selectPending = false;
      }
    });
    input.addEventListener('blur', () => { selectPending = false; });
  });
}
