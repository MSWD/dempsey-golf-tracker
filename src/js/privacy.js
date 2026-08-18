// Footer for the standalone privacy policy page — same pattern as home.js's footer, but this page
// has no team list to fetch. Kept as its own external file (not inlined in privacy.html) because
// every page on this site ships a `script-src 'self'` CSP with no 'unsafe-inline' exception — see
// docs/decisions.md's "Why Chart.js is vendored and every page carries a CSP."
function main() {
  const year = new Date().getFullYear();
  document.getElementById('app-footer').innerHTML = `
    <p><strong>&copy; ${year} MSWD &mdash; Montgomery's Software &amp; Web Development</strong></p>
    <p class="muted">School Golf Tracker &middot; Built with Claude (AI-assisted) &middot; v${APP_VERSION}</p>
  `;
}
main();
