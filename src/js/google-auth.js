// Google device-flow login ("OAuth 2.0 for TV and Limited-Input Device Applications" in Google's
// own terms) — chosen over GitHub's equivalent flow (see docs/decisions.md, issue #26) so a
// non-technical coach never has to understand what a GitHub account is; any Google account works,
// no repo-collaborator invite needed. Admin mode (for the current team) is decided by
// src/teams.json, checked via the Worker's /whoami endpoint against the caller's verified Google
// email — never by any Google-side group/directory membership, so a coach's school district doesn't
// need to grant this app any access to their Workspace directory. No token, an unconfigured client,
// or a token that fails a live check all fall back to the safe default: read-only viewer mode.
// Deliberately NOT namespaced by team slug (unlike DataStore's STORAGE_KEY) — a Google session
// identifies the same account regardless of which team path it's used on, so one login covers every
// team the account happens to administer. See docs/decisions.md for why this is not the fix for the
// cross-tenant token-theft chain in issues #1/#7.
const AUTH_STORAGE_KEY = 'mstgt:google-token';

// Google's issued access/ID tokens last about an hour (much shorter than GitHub App tokens' old 8h),
// and a refresh_token comes back alongside them. A slight early margin so an in-flight request
// started just before the real expiry doesn't land on Google's side after it lapses.
const EXPIRY_SAFETY_MARGIN_MS = 60_000;

// Reads the stored session. Returns null if nothing's stored or the stored value doesn't even look
// like a session. A pre-refresh version of this app (and, briefly, the pre-Google-swap version)
// stored a bare access-token string here — JSON.parse on that throws, and that failure is treated
// as a legacy session with no known expiry/refresh/idToken rather than forcing a logout just because
// the storage format changed under an already-logged-in coach.
function readSession() {
  const raw = localStorage.getItem(AUTH_STORAGE_KEY);
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw);
    if (parsed && typeof parsed.accessToken === 'string' && parsed.accessToken) {
      return {
        accessToken: parsed.accessToken,
        idToken: typeof parsed.idToken === 'string' ? parsed.idToken : null,
        expiresAt: typeof parsed.expiresAt === 'number' ? parsed.expiresAt : null,
        refreshToken: typeof parsed.refreshToken === 'string' ? parsed.refreshToken : null,
        refreshTokenExpiresAt:
          typeof parsed.refreshTokenExpiresAt === 'number' ? parsed.refreshTokenExpiresAt : null,
      };
    }
    return null; // valid JSON, wrong shape — don't guess, treat as no usable session
  } catch {
    return { accessToken: raw, idToken: null, expiresAt: null, refreshToken: null, refreshTokenExpiresAt: null };
  }
}

function writeSession(session) {
  localStorage.setItem(AUTH_STORAGE_KEY, JSON.stringify(session));
}

function clearSession() {
  localStorage.removeItem(AUTH_STORAGE_KEY);
}

// Maps a Google token-response body to our session shape. expiresAt/refreshTokenExpiresAt are
// absolute Date.now()-based timestamps rather than the durations Google sends, so an expiry check
// later doesn't need to remember "since when." Google doesn't document a fixed refresh-token expiry
// the way GitHub's refresh_token_expires_in did (it's invalidated by 6 months of non-use, a
// per-account/client cap, or explicit revocation instead) — refreshTokenExpiresAt stays null unless
// a future response actually includes that field.
//
// `previousIdToken` is a defensive fallback, not the expected path — confirmed via live testing
// (issue #26) that Google's refresh_token grant does reissue a fresh id_token every time, so this
// only matters if that ever changes: keep reusing the last known-good idToken rather than wiping
// out session identity if a future refresh response ever omits one.
function buildSessionFromTokenResponse(tokenData, previousIdToken = null) {
  const now = Date.now();
  return {
    accessToken: tokenData.access_token,
    idToken: typeof tokenData.id_token === 'string' ? tokenData.id_token : previousIdToken,
    expiresAt: typeof tokenData.expires_in === 'number' ? now + tokenData.expires_in * 1000 : null,
    refreshToken: typeof tokenData.refresh_token === 'string' ? tokenData.refresh_token : null,
    refreshTokenExpiresAt:
      typeof tokenData.refresh_token_expires_in === 'number'
        ? now + tokenData.refresh_token_expires_in * 1000
        : null,
  };
}

// Exchanges a refresh token for a new session via the Worker (Google requires its client_secret on
// every /token call, including this one — see worker/cloudflare-device-flow-relay.js).
// Returns { session: null|Session, transient: boolean }. `transient` distinguishes "couldn't even
// reach the network" (session should be left alone so a later call can retry) from "Google itself
// rejected the refresh token" (session really is dead) — treating a flaky-wifi moment the same as an
// actually-invalid refresh token would force a full re-login over what might just be a blip.
async function requestRefresh(refreshToken, previousIdToken) {
  const { clientId, deviceFlowWorkerUrl } = TEAM_CONFIG.googleAuth;
  try {
    const res = await fetch(`${deviceFlowWorkerUrl}/token`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ client_id: clientId, grant_type: 'refresh_token', refresh_token: refreshToken }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok || !data.access_token) return { session: null, transient: false };
    return { session: buildSessionFromTokenResponse(data, previousIdToken), transient: false };
  } catch (err) {
    console.warn('Google token refresh failed (network error) — leaving session as-is to retry later.', err);
    return { session: null, transient: true };
  }
}

// Memoizes the in-flight refresh so concurrent callers (e.g. the startup admin check and an
// almost-simultaneous publish click) share one network call instead of each independently exchanging
// the same refresh token — a provider may rotate/invalidate a refresh token the instant it's used,
// so two parallel exchanges could otherwise race and the loser would wipe out the session the winner
// just wrote.
let _refreshInFlight = null;
function refreshOnce(refreshToken, previousIdToken) {
  if (!_refreshInFlight) {
    _refreshInFlight = requestRefresh(refreshToken, previousIdToken).finally(() => {
      _refreshInFlight = null;
    });
  }
  return _refreshInFlight;
}

// Best-effort server-side revoke of exactly this one token (see the Worker's /revoke handler).
// Bounded with a timeout and never throws — logout must clear local state and return promptly
// regardless of whether Google's side can be reached. Revokes the OAuth access token specifically,
// not the ID token — Google's revoke endpoint revokes OAuth tokens (access/refresh), and an ID token
// isn't itself a revocable grant.
async function revokeToken(accessToken) {
  const { clientId, deviceFlowWorkerUrl } = TEAM_CONFIG.googleAuth;
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
    console.warn('Google token revoke failed (local session was cleared regardless).', err);
  } finally {
    clearTimeout(timeout);
  }
}

const GoogleAuth = {
  email: null,

  // True only when a previously-stored session had to be force-cleared due to expiry with no
  // viable refresh — lets the UI show "your session expired, please log in again" instead of the
  // generic "not an admin" default it'd otherwise be indistinguishable from. Reset whenever there's
  // simply no session at all, and at the start of every fresh login attempt.
  sessionExpired: false,

  isConfigured() {
    const { clientId, deviceFlowWorkerUrl } = TEAM_CONFIG.googleAuth;
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
      const { session: refreshed, transient } = await refreshOnce(session.refreshToken, session.idToken);
      if (refreshed) {
        writeSession(refreshed);
        this.sessionExpired = false;
        return refreshed;
      }
      if (transient) {
        // Couldn't reach the network, not a real rejection — leave the stored session alone so the
        // next call can retry the refresh instead of forcing a full re-login over a blip.
        return null;
      }
    }

    // Nothing left to try: this only catches expiry we know about from our own bookkeeping — a
    // token invalidated another way (revoked from the coach's Google account directly, Testing-mode
    // grant expiry) still falls through to checkAdmin()'s generic false, indistinguishable from "not
    // an admin." Accepted, pre-existing gap, not a regression.
    clearSession();
    this.email = null;
    this.sessionExpired = true;
    return null;
  },

  // Returns the ID token — the credential sent to the Worker's /whoami and /publish endpoints,
  // which verify it locally (JWKS) to resolve the caller's identity. Not the OAuth access token:
  // this app never calls any Google API on the coach's behalf, so there's nothing for an access
  // token to authorize here beyond what the ID token's verified email claim already establishes.
  async getValidIdToken() {
    const session = await this.ensureValidSession();
    return session ? session.idToken : null;
  },

  async logout() {
    const session = readSession();
    clearSession();
    this.email = null;
    this.sessionExpired = false;
    if (session?.accessToken) await revokeToken(session.accessToken);
  },

  // Confirms the token is live and belongs to a teams.json-listed admin for this team.
  async checkAdmin(token) {
    try {
      const res = await fetch(`${TEAM_CONFIG.googleAuth.deviceFlowWorkerUrl}/whoami`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ teamSlug: TEAM_CONFIG.teamSlug }),
      });
      if (!res.ok) return false;
      const data = await res.json();
      this.email = data.email ?? null;
      return Boolean(data.isAdmin);
    } catch (err) {
      console.warn('Google admin check failed.', err);
      return false;
    }
  },

  async isAdmin() {
    if (!this.isConfigured()) return false;
    const token = await this.getValidIdToken();
    if (!token) return false;
    return this.checkAdmin(token);
  },

  // Drives the device-flow login through the Cloudflare Worker relay (see
  // worker/cloudflare-device-flow-relay.js and docs/auth-and-publishing.md for why a relay is
  // needed — Google's device-flow endpoints don't send CORS headers for direct browser calls).
  // onUserCode(code, verificationUri) is called once the user needs to go approve the login.
  async login(onUserCode) {
    if (!this.isConfigured()) {
      throw new Error('Google login is not configured yet — see docs/auth-and-publishing.md.');
    }
    this.sessionExpired = false;
    const { clientId, deviceFlowWorkerUrl } = TEAM_CONFIG.googleAuth;

    const codeRes = await fetch(`${deviceFlowWorkerUrl}/device/code`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ client_id: clientId }),
    });
    if (!codeRes.ok) throw new Error('Failed to start device flow login.');
    // Google's device-code response uses the older `verification_url` field name, not the RFC
    // 8628-standard `verification_uri` GitHub's device flow used — confirmed against a real
    // request during issue #26 testing, not documented clearly anywhere upfront. Accept either so
    // this doesn't quietly break again if Google ever adds/renames the standard field.
    const data = await codeRes.json();
    const { device_code, user_code, interval, expires_in } = data;
    const verificationUri = data.verification_uri || data.verification_url;

    onUserCode(user_code, verificationUri);

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
        const session = buildSessionFromTokenResponse(tokenData);
        writeSession(session);
        const isAdmin = await this.checkAdmin(session.idToken);
        if (!isAdmin) {
          // Don't leave a non-admin account's session sitting in localStorage — it can never
          // grant anything (every admin check re-verifies live against the Worker regardless of
          // what's stored), so a stored-but-unusable token is just dead credential material with
          // no UI affordance to log it out. Clear it, and best-effort revoke it server-side, the
          // same as a real logout would — matches the "not admin" result to actually being logged
          // out, rather than a hidden logged-in state the button never reflects.
          clearSession();
          this.email = null;
          if (session.accessToken) await revokeToken(session.accessToken);
          throw new Error('Logged in, but this account is not listed as an admin for this team.');
        }
        return true;
      }
      // Google returns HTTP 403/428 for slow_down/authorization_pending (GitHub used a flat 200
      // with the same error field) — irrelevant here since this branches purely on the parsed JSON
      // body, never on tokenRes.status.
      if (tokenData.error === 'slow_down') pollInterval += 5;
      else if (tokenData.error && tokenData.error !== 'authorization_pending') {
        throw new Error(`Google login failed: ${tokenData.error}`);
      }
    }
    throw new Error('Login timed out — please try again.');
  },
};
