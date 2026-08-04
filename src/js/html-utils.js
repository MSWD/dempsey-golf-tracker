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

// Wraps a number input with +/- stepper buttons. iOS/iPadOS browsers — "Chrome" for iOS included,
// since Apple requires every iOS browser to run on WebKit under the hood — never render the native
// spin-button UI on <input type="number"> the way desktop Chromium does, so on those devices these
// custom buttons are the *only* increment/decrement affordance; on desktop they're simply
// redundant with the native spinner. See GitHub issue #33.
//
// Shared by ui-matches.js (hole scores + putts) and ui-rounds.js (same) rather than duplicated in
// both, since the duplication of the plain <input> markup between those two files was exactly what
// let this gap go unnoticed in one of them — see docs/architecture.md.
//
// `min` only bounds the stepper's own decrement (so "-" can't produce a negative score/putts
// count); it's deliberately not enforced as an upper bound here — the existing double-par cap
// (scoring-engine.js) already handles that at submit time, with its own warning, and this input
// still accepts direct typing/pasting above it same as before.
function renderStepperInput({ className = '', dataAttrs = '', placeholder = '', value = '', min = 0 } = {}) {
  return `
    <span class="stepper">
      <button type="button" class="stepper-btn stepper-minus" tabindex="-1" aria-label="Decrease ${escapeHtml(placeholder) || 'value'}">&minus;</button>
      <input type="number" inputmode="numeric" class="${className}" ${dataAttrs} placeholder="${escapeHtml(placeholder)}" value="${escapeHtml(value)}" min="${min}">
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
    };
    stepper.querySelector('.stepper-minus').addEventListener('click', () => nudge(-1));
    stepper.querySelector('.stepper-plus').addEventListener('click', () => nudge(1));
  });
}
