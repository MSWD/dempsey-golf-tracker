// GitHub device-flow login. Any GitHub account can log in — no repo-collaborator invite needed.
// Admin mode (for the current team) is decided by src/teams.json, checked via the Worker's
// /whoami endpoint, never by GitHub repo-collaborator status: under path-based multi-team hosting
// one repo serves every team, so repo permissions are too coarse to mean "admin for team X." No
// token, an unconfigured app, or a token that fails a live check all fall back to the safe
// default: read-only viewer mode.
// Deliberately NOT namespaced by team slug (unlike DataStore's STORAGE_KEY) — a GitHub token
// identifies the same account regardless of which team path it's used on, so one login covers
// every team the account happens to administer. See docs/decisions.md for why this is not the
// fix for the cross-tenant token-theft chain in issues #1/#7.
const AUTH_STORAGE_KEY = 'mstgt:github-token';

// This app's GitHub App has "User-to-server token expiration" enabled, so access tokens expire
// after 8h and GitHub issues a refresh_token alongside them. A slight early margin so an in-flight
// request started just before the real expiry doesn't land on GitHub's side after it lapses.
const EXPIRY_SAFETY_MARGIN_MS = 60_000;

// Reads the stored session. Returns null if nothing's stored or the stored value doesn't even
// look like a session. A pre-refresh version of this app stored a bare access-token string here —
// JSON.parse on that throws, and that failure is treated as a legacy session with no known
// expiry/refresh rather than forcing a logout just because the storage format changed under an
// already-logged-in coach.
function readSession() {
  const raw = localStorage.getItem(AUTH_STORAGE_KEY);
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw);
    if (parsed && typeof parsed.accessToken === 'string' && parsed.accessToken) {
      return {
        accessToken: parsed.accessToken,
        expiresAt: typeof parsed.expiresAt === 'number' ? parsed.expiresAt : null,
        refreshToken: typeof parsed.refreshToken === 'string' ? parsed.refreshToken : null,
        refreshTokenExpiresAt:
          typeof parsed.refreshTokenExpiresAt === 'number' ? parsed.refreshTokenExpiresAt : null,
      };
    }
    return null; // valid JSON, wrong shape — don't guess, treat as no usable session
  } catch {
    return { accessToken: raw, expiresAt: null, refreshToken: null, refreshTokenExpiresAt: null };
  }
}

function writeSession(session) {
  localStorage.setItem(AUTH_STORAGE_KEY, JSON.stringify(session));
}

function clearSession() {
  localStorage.removeItem(AUTH_STORAGE_KEY);
}

// Maps a GitHub token-response body to our session shape. expiresAt/refreshTokenExpiresAt are
// absolute Date.now()-based timestamps rather than the durations GitHub sends, so an expiry check
// later doesn't need to remember "since when."
function buildSessionFromTokenResponse(tokenData) {
  const now = Date.now();
  return {
    accessToken: tokenData.access_token,
    expiresAt: typeof tokenData.expires_in === 'number' ? now + tokenData.expires_in * 1000 : null,
    refreshToken: typeof tokenData.refresh_token === 'string' ? tokenData.refresh_token : null,
    refreshTokenExpiresAt:
      typeof tokenData.refresh_token_expires_in === 'number'
        ? now + tokenData.refresh_token_expires_in * 1000
        : null,
  };
}

// Exchanges a refresh token for a new session via the Worker (the refresh grant needs the GitHub
// App's client secret, unlike the initial device-code exchange — see worker/cloudflare-device-flow-relay.js).
// Returns { session: null|Session, transient: boolean }. `transient` distinguishes "couldn't even
// reach the network" (session should be left alone so a later call can retry) from "GitHub itself
// rejected the refresh token" (session really is dead) — treating a flaky-wifi moment the same as
// an actually-invalid refresh token would force a full re-login over what might just be a blip.
async function requestRefresh(refreshToken) {
  const { clientId, deviceFlowWorkerUrl } = TEAM_CONFIG.githubApp;
  try {
    const res = await fetch(`${deviceFlowWorkerUrl}/token`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ client_id: clientId, grant_type: 'refresh_token', refresh_token: refreshToken }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok || !data.access_token) return { session: null, transient: false };
    return { session: buildSessionFromTokenResponse(data), transient: false };
  } catch (err) {
    console.warn('GitHub token refresh failed (network error) — leaving session as-is to retry later.', err);
    return { session: null, transient: true };
  }
}

// Memoizes the in-flight refresh so concurrent callers (e.g. the startup admin check and an
// almost-simultaneous publish click) share one network call instead of each independently
// exchanging the same refresh token — GitHub may rotate/invalidate a refresh token the instant
// it's used, so two parallel exchanges could otherwise race and the loser would wipe out the
// session the winner just wrote.
let _refreshInFlight = null;
function refreshOnce(refreshToken) {
  if (!_refreshInFlight) {
    _refreshInFlight = requestRefresh(refreshToken).finally(() => {
      _refreshInFlight = null;
    });
  }
  return _refreshInFlight;
}

// Best-effort server-side revoke of exactly this one token (see the Worker's /revoke handler).
// Bounded with a timeout and never throws — logout must clear local state and return promptly
// regardless of whether GitHub's side can be reached.
async function revokeToken(accessToken) {
  const { clientId, deviceFlowWorkerUrl } = TEAM_CONFIG.githubApp;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 5000);
  try {
    await fetch(`${deviceFlowWorkerUrl}/revoke`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ client_id: clientId, access_token: accessToken }),
      signal: controller.signal,
    });
  } catch (err) {
    console.warn('GitHub token revoke failed (local session was cleared regardless).', err);
  } finally {
    clearTimeout(timeout);
  }
}

const GitHubAuth = {
  username: null,

  // True only when a previously-stored session had to be force-cleared due to expiry with no
  // viable refresh — lets the UI show "your session expired, please log in again" instead of the
  // generic "not an admin" default it'd otherwise be indistinguishable from. Reset whenever
  // there's simply no session at all, and at the start of every fresh login attempt.
  sessionExpired: false,

  isConfigured() {
    const { clientId, deviceFlowWorkerUrl } = TEAM_CONFIG.githubApp;
    return !clientId.startsWith('REPLACE_') && !deviceFlowWorkerUrl.includes('REPLACE_');
  },

  // Resolves a usable session, transparently refreshing an expired access token if a live refresh
  // token is available. Returns null if there's no session, or it's expired with nothing left to
  // refresh (as a side effect, clears storage and sets sessionExpired in that case).
  async ensureValidSession() {
    const session = readSession();
    if (!session) {
      this.sessionExpired = false;
      return null;
    }

    const now = Date.now();
    const accessExpired = session.expiresAt !== null && session.expiresAt - EXPIRY_SAFETY_MARGIN_MS <= now;
    if (!accessExpired) {
      this.sessionExpired = false;
      return session;
    }

    const refreshUsable =
      session.refreshToken && (session.refreshTokenExpiresAt === null || session.refreshTokenExpiresAt > now);
    if (refreshUsable) {
      const { session: refreshed, transient } = await refreshOnce(session.refreshToken);
      if (refreshed) {
        writeSession(refreshed);
        this.sessionExpired = false;
        return refreshed;
      }
      if (transient) {
        // Couldn't reach the network, not a real rejection — leave the stored session alone so
        // the next call can retry the refresh instead of forcing a full re-login over a blip.
        return null;
      }
    }

    // Nothing left to try: this only catches expiry we know about from our own bookkeeping — a
    // token invalidated another way (revoked on github.com directly, App uninstalled) still falls
    // through to checkAdmin()'s generic false, indistinguishable from "not an admin." Accepted,
    // pre-existing gap, not a regression.
    clearSession();
    this.username = null;
    this.sessionExpired = true;
    return null;
  },

  async getValidAccessToken() {
    const session = await this.ensureValidSession();
    return session ? session.accessToken : null;
  },

  async logout() {
    const session = readSession();
    clearSession();
    this.username = null;
    this.sessionExpired = false;
    if (session?.accessToken) await revokeToken(session.accessToken);
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
    const token = await this.getValidAccessToken();
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
    this.sessionExpired = false;
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
        // Store the session regardless of admin status — a logged-in-but-not-listed user is a
        // known visitor, not an error. isAdmin() re-checks against teams.json on every load.
        const session = buildSessionFromTokenResponse(tokenData);
        writeSession(session);
        const isAdmin = await this.checkAdmin(session.accessToken);
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
