// Bootstraps the app: loads team branding, initializes the data store, wires up nav/export/import/
// auth, and delegates each view's rendering to its own ui-*.js module.
const AppState = { isAdmin: false };

function currentView() {
  const active = document.querySelector('.view.active');
  return active ? active.id.replace('view-', '') : null;
}

function renderFooter() {
  const footer = document.getElementById('app-footer');
  if (!footer) return;
  const year = new Date().getFullYear();
  footer.innerHTML = `
    <p><strong>&copy; ${year} MSWD &mdash; Montgomery's Software &amp; Web Development</strong></p>
    <p class="muted">${TEAM_CONFIG.siteTitle} &middot; Built with Claude (AI-assisted) &middot; v${APP_VERSION}</p>
  `;
}

async function main() {
  document.getElementById('team-title').textContent = TEAM_CONFIG.siteTitle;
  const logo = document.getElementById('team-logo');
  // logoPath is optional per team — fall back to the shared golf-green-flag graphic used for the
  // favicon so a team isn't blocked from trying the app just because they don't have a logo ready.
  // Derived from iconSpritePath's directory rather than a hardcoded depth, since it's already
  // defined relative to this page.
  logo.src = TEAM_CONFIG.logoPath ?? TEAM_CONFIG.iconSpritePath.replace('icons.svg', 'favicon.svg');
  logo.alt = TEAM_CONFIG.logoAlt ?? `${TEAM_CONFIG.siteTitle} logo`;
  renderFooter();

  const spriteRes = await fetch(TEAM_CONFIG.iconSpritePath);
  document.getElementById('icon-sprite').innerHTML = await spriteRes.text();

  await DataStore.init();

  const views = {
    roster: renderRosterView,
    courses: renderCoursesView,
    rounds: renderRoundsView,
    rank: renderRankView,
    charts: renderChartsView,
    matches: renderMatchesView,
  };

  function showView(name) {
    document.querySelectorAll('.view').forEach((el) => el.classList.remove('active'));
    document.querySelectorAll('nav.tabs button').forEach((btn) => btn.classList.remove('active'));
    document.getElementById(`view-${name}`).classList.add('active');
    const tab = document.querySelector(`nav.tabs button[data-view="${name}"]`);
    if (tab) tab.classList.add('active');
    if (views[name]) views[name]();
  }

  document.querySelectorAll('nav.tabs button').forEach((btn) => {
    btn.addEventListener('click', () => showView(btn.dataset.view));
  });

  document.getElementById('btn-export').addEventListener('click', () => DataStore.exportJSON());
  document.getElementById('btn-import').addEventListener('click', () => {
    document.getElementById('file-import').click();
  });
  document.getElementById('file-import').addEventListener('change', async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    try {
      await DataStore.importJSON(file);
      alert('Import successful.');
      showView('roster');
    } catch (err) {
      alert(`Import failed: ${err.message}`);
    } finally {
      e.target.value = '';
    }
  });

  const loginBtn = document.getElementById('btn-login');
  const loginStatus = document.getElementById('login-status');

  function updateAuthUI() {
    document.body.classList.toggle('admin-mode', AppState.isAdmin);
    document.body.classList.toggle('viewer-mode', !AppState.isAdmin);
    loginBtn.textContent = AppState.isAdmin ? 'Logout' : 'Login with GitHub';
  }

  async function refreshAdminStatus() {
    AppState.isAdmin = await GitHubAuth.isAdmin();
    updateAuthUI();
  }

  loginBtn.addEventListener('click', async () => {
    if (AppState.isAdmin) {
      GitHubAuth.logout();
      AppState.isAdmin = false;
      updateAuthUI();
      showView(currentView() ?? 'roster');
      return;
    }

    if (!GitHubAuth.isConfigured()) {
      loginStatus.textContent = 'GitHub login is not configured yet — see docs/auth-and-publishing.md.';
      return;
    }

    try {
      loginStatus.textContent = 'Starting login…';
      await GitHubAuth.login((userCode, verificationUri) => {
        loginStatus.innerHTML = `Go to <a href="${verificationUri}" target="_blank" rel="noopener">${verificationUri}</a> and enter code <strong>${userCode}</strong>`;
      });
      loginStatus.textContent = 'Logged in.';
      AppState.isAdmin = true;
      updateAuthUI();
      showView(currentView() ?? 'roster');
    } catch (err) {
      loginStatus.textContent = err.message;
    }
  });

  document.getElementById('btn-publish').addEventListener('click', async () => {
    try {
      loginStatus.textContent = 'Publishing report…';
      const url = await GitHubPublish.publishSnapshot();
      loginStatus.innerHTML = `Published: <a href="${url}" target="_blank" rel="noopener">${url}</a>`;
    } catch (err) {
      loginStatus.textContent = `Publish failed: ${err.message}`;
    }
  });

  await refreshAdminStatus();
  showView('roster');
}

main();
