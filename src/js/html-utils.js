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
