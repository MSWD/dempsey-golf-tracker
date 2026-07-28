// GitHub device-flow login. Admin mode = holding a token with write access to this repo, stored
// in localStorage. No token, an unconfigured app, or a token that fails a live permission check
// all fall back to the safe default: read-only viewer mode.
const AUTH_STORAGE_KEY = 'dempsey-golf-tracker:github-token';

const GitHubAuth = {
  isConfigured() {
    const { clientId, deviceFlowWorkerUrl } = TEAM_CONFIG.githubApp;
    return !clientId.startsWith('REPLACE_') && !deviceFlowWorkerUrl.includes('REPLACE_');
  },

  getStoredToken() {
    return localStorage.getItem(AUTH_STORAGE_KEY);
  },

  logout() {
    localStorage.removeItem(AUTH_STORAGE_KEY);
  },

  // Confirms the token is live and actually has push access to this repo — not just present.
  async validateToken(token) {
    try {
      const userRes = await fetch('https://api.github.com/user', {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!userRes.ok) return false;

      const { owner, repo } = TEAM_CONFIG.github;
      const repoRes = await fetch(`https://api.github.com/repos/${owner}/${repo}`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!repoRes.ok) return false;
      const repoData = await repoRes.json();
      return Boolean(repoData.permissions && repoData.permissions.push);
    } catch (err) {
      console.warn('GitHub token validation failed.', err);
      return false;
    }
  },

  async isAdmin() {
    if (!this.isConfigured()) return false;
    const token = this.getStoredToken();
    if (!token) return false;
    return this.validateToken(token);
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
        const isValid = await this.validateToken(tokenData.access_token);
        if (!isValid) throw new Error('Logged in, but this account does not have write access to the repo.');
        localStorage.setItem(AUTH_STORAGE_KEY, tokenData.access_token);
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
