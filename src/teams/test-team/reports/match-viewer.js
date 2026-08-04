// Single-match share page: reads a match id from ?id=, fetches the same always-current
// data/latest.json report-viewer.js uses, and renders just that one match's card via the shared
// match-render.js functions. Meant to be handed to an opposing coach as a standalone link — no
// season rankings, no other matches, nothing else on the page to browse.
async function main() {
  document.getElementById('team-title').textContent = TEAM_CONFIG.siteTitle;
  const logo = document.getElementById('team-logo');
  // logoPath is relative to the main app page; this page sits one level deeper, hence the "../"
  // prefix. Optional per team — falls back to the shared golf-green-flag graphic if unset.
  const logoPath = TEAM_CONFIG.logoPath ?? TEAM_CONFIG.iconSpritePath.replace('icons.svg', 'favicon.svg');
  logo.src = `../${logoPath}`;
  logo.alt = TEAM_CONFIG.logoAlt ?? `${TEAM_CONFIG.siteTitle} logo`;
  renderFooter();

  const content = document.getElementById('match-content');
  const matchId = new URLSearchParams(location.search).get('id');
  if (!matchId) {
    content.innerHTML = '<p class="muted">This link is missing its match id.</p>';
    return;
  }

  const res = await fetch('data/latest.json');
  if (!res.ok) {
    content.innerHTML = '<p class="muted">No report has been published yet.</p>';
    return;
  }
  _snapshot = await res.json();
  if (_snapshot.seasonName) {
    document.getElementById('team-title').textContent = `${TEAM_CONFIG.siteTitle} — ${_snapshot.seasonName}`;
  }

  const match = _snapshot.matches.find((m) => m.id === matchId);
  if (!match) {
    content.innerHTML = `
      <p class="muted">This match isn't in the published report yet — it may not have been
      published, or this link is out of date.</p>
    `;
    return;
  }
  content.innerHTML = renderMatchCard(match);
}

main();
