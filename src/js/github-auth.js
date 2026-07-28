// GitHub device-flow login. Any GitHub account can log in — no repo-collaborator invite needed.
// Admin mode (for the current team) is decided by src/teams.json, checked via the Worker's
// /whoami endpoint, never by GitHub repo-collaborator status: under path-based multi-team hosting
// one repo serves every team, so repo permissions are too coarse to mean "admin for team X." No
// token, an unconfigured app, or a token that fails a live check all fall back to the safe
// default: read-only viewer mode.
// Deliberately NOT namespaced by team slug (unlike DataStore's STORAGE_KEY) — a GitHub token
// identifies the same account regardless of which team path it's used on, so one login covers
// every team the account happens to administer.
const AUTH_STORAGE_KEY = 'mstgt:github-token';

const GitHubAuth = {
  username: null,

  isConfigured() {
    const { clientId, deviceFlowWorkerUrl } = TEAM_CONFIG.githubApp;
    return !clientId.startsWith('REPLACE_') && !deviceFlowWorkerUrl.includes('REPLACE_');
  },

  getStoredToken() {
    return localStorage.getItem(AUTH_STORAGE_KEY);
  },

  logout() {
    localStorage.removeItem(AUTH_STORAGE_KEY);
    this.username = null;
  },

  // Confirms the token is live and belongs to a teams.json-listed admin for this team.
  async checkAdmin(token) {
    try {
      const res = await fetch(`${TEAM_CONFIG.githubApp.deviceFlowWorkerUrl}/whoami`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ teamSlug: TEAM_CONFIG.teamSlug }),
      });
      if (!res.ok) return false;
      const data = await res.json();
      this.username = data.username ?? null;
      return Boolean(data.isAdmin);
    } catch (err) {
      console.warn('GitHub admin check failed.', err);
      return false;
    }
  },

  async isAdmin() {
    if (!this.isConfigured()) return false;
    const token = this.getStoredToken();
    if (!token) return false;
    return this.checkAdmin(token);
  },

  // Drives the device-flow login through the Cloudflare Worker relay (see
  // worker/cloudflare-device-flow-relay.js and docs/auth-and-publishing.md for why a relay is
  // needed — GitHub's device-flow endpoints don't send CORS headers for direct browser calls).
  // onUserCode(code, verificationUri) is called once the user needs to go approve the login.
  async login(onUserCode) {
    if (!this.isConfigured()) {
      throw new Error('GitHub App is not configured yet — see docs/auth-and-publishing.md.');
    }
    const { clientId, deviceFlowWorkerUrl } = TEAM_CONFIG.githubApp;

    const codeRes = await fetch(`${deviceFlowWorkerUrl}/device/code`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ client_id: clientId }),
    });
    if (!codeRes.ok) throw new Error('Failed to start device flow login.');
    const { device_code, user_code, verification_uri, interval, expires_in } = await codeRes.json();

    onUserCode(user_code, verification_uri);

    const deadline = Date.now() + expires_in * 1000;
    let pollInterval = interval;

    while (Date.now() < deadline) {
      await new Promise((resolve) => setTimeout(resolve, pollInterval * 1000));

      const tokenRes = await fetch(`${deviceFlowWorkerUrl}/token`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ client_id: clientId, device_code }),
      });
      const tokenData = await tokenRes.json();

      if (tokenData.access_token) {
        // Store the token regardless of admin status — a logged-in-but-not-listed user is a
        // known visitor, not an error. isAdmin() re-checks against teams.json on every load.
        localStorage.setItem(AUTH_STORAGE_KEY, tokenData.access_token);
        const isAdmin = await this.checkAdmin(tokenData.access_token);
        if (!isAdmin) throw new Error('Logged in, but this account is not listed as an admin for this team.');
        return true;
      }
      if (tokenData.error === 'slow_down') pollInterval += 5;
      else if (tokenData.error && tokenData.error !== 'authorization_pending') {
        throw new Error(`GitHub login failed: ${tokenData.error}`);
      }
    }
    throw new Error('Login timed out — please try again.');
  },
};
