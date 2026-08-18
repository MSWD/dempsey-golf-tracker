async function main() {
  const res = await fetch('teams.json');
  const teams = await res.json();
  const list = document.getElementById('team-list');
  list.innerHTML = Object.entries(teams).map(([slug, team]) =>
    `<li><a href="teams/${slug}/index.html">${team.name}</a></li>`
  ).join('');

  const year = new Date().getFullYear();
  document.getElementById('app-footer').innerHTML = `
    <p><strong>&copy; ${year} MSWD &mdash; Montgomery's Software &amp; Web Development</strong></p>
    <p class="muted">School Golf Tracker &middot; Built with Claude (AI-assisted) &middot; v${APP_VERSION} &middot; <a href="privacy.html">Privacy Policy</a></p>
  `;
}
main();
