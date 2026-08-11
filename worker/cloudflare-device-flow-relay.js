// Cloudflare Worker: (1) relays Google's OAuth device-flow endpoints, and (2) gatekeeps report
// publishing under path-based multi-team hosting.
//
// (1) Device-flow relay: Google's device-code and token endpoints don't send CORS headers, so a
// static site's browser JS can't call them directly. This Worker forwards those requests
// server-side and adds CORS headers to the response. This is "OAuth 2.0 for TV and Limited-Input
// Device Applications" in Google's own terms — the same category of flow GitHub's device flow used
// to be, chosen so a non-technical coach never has to understand what a GitHub account is; see
// issue #26 and docs/decisions.md for why Google replaced GitHub here.
//
// (2) Publish gatekeeping: under path-based hosting, every team shares one repo, so no third-party
// identity provider's own permission model can scope "who can administer team X." Admin rights are
// instead decided by src/teams.json (slug -> allowed Google account emails), which only the
// platform operator ever edits directly via git — no code path here writes to it. This Worker is
// the one non-spoofable place that mapping can be enforced: it verifies the caller's own Google ID
// token (a signed JWT, checked locally against Google's public keys — no outbound identity API call
// needed), checks the verified email against teams.json, and only then commits, using its own
// fine-grained PAT (a Cloudflare secret, `GITHUB_PAT`) scoped to just this repo. The caller's own
// credentials are never used to make the write itself.
//
// (3) Token refresh + revoke: Google's issued access/ID tokens last about an hour, much shorter
// than GitHub's old 8h App tokens, so the client exchanges its refresh_token here
// (grant_type=refresh_token) more often to get a new access/ID token without re-running the whole
// device flow. logout calls here to revoke the specific token being discarded. Unlike GitHub's
// device-code exchange, Google requires a client_secret on EVERY token-poll call, not just refresh
// — see handleToken below. Google's revoke endpoint, by contrast, needs no secret at all (simpler
// than GitHub's Basic-auth DELETE call).
//
// (4) client_id pinning: this relay only ever brokers device-flow logins for our own OAuth Client,
// so /device/code and /token reject any request carrying a different client_id (GOOGLE_CLIENT_ID in
// [vars] — public, not a secret, since it already ships in every team's team-config.js). Without
// this, anyone could point their own site at this Worker as a free CORS bridge for their own OAuth
// Client's device flow, consuming the rate-limit budget meant to protect GITHUB_PAT.
//
// Deploy: `npm install` (first-time only — this Worker now has one npm dependency, `jose`, for
// local Google ID-token verification), then `wrangler deploy` (Quick Edit dashboard paste-in is no
// longer viable once there's an import to bundle) under the same Cloudflare account that manages
// mswd.us DNS. Requires env vars/secrets: GITHUB_PAT (secret, unrelated to login — see (2) above),
// GOOGLE_CLIENT_SECRET (secret), GOOGLE_CLIENT_ID, GITHUB_OWNER, GITHUB_REPO, GITHUB_BRANCH.
// See docs/auth-and-publishing.md for full setup.

import { createRemoteJWKSet, jwtVerify } from 'jose';

const GOOGLE_DEVICE_CODE_URL = 'https://oauth2.googleapis.com/device/code';
const GOOGLE_TOKEN_URL = 'https://oauth2.googleapis.com/token';
const GOOGLE_REVOKE_URL = 'https://oauth2.googleapis.com/revoke';
const GOOGLE_JWKS_URL = 'https://www.googleapis.com/oauth2/v3/certs';
// Google ID tokens use either form depending on token version — accept both rather than picking
// one and having a spurious rejection the day Google happens to issue the other.
const GOOGLE_ISSUERS = ['https://accounts.google.com', 'accounts.google.com'];
const TEAMS_JSON_PATH = 'src/teams.json';
const TEAMS_CACHE_TTL_MS = 5 * 60 * 1000; // short TTL — teams.json edits take a few minutes to propagate

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
};

// Created once per isolate — jose's remote JWKS helper handles its own fetch/caching/key-rotation
// internally, so holding this at module scope (alongside the _teamsCache pattern below) is safe and
// avoids re-fetching Google's public keys on every single request.
const googleJwks = createRemoteJWKSet(new URL(GOOGLE_JWKS_URL));

function json(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', ...CORS_HEADERS },
  });
}

// A malformed POST body should be a 400, not an uncaught throw that surfaces as a 500.
async function readJson(request) {
  try {
    return await request.json();
  } catch {
    return null;
  }
}

async function relayDeviceFlow(upstreamUrl, body) {
  const res = await fetch(upstreamUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify(body),
  });
  const data = await res.json();
  return json(data, res.status);
}

// Branches on the client's requested grant type. Unlike GitHub's device flow, which only required a
// client_secret on the refresh_token grant, Google requires one on EVERY token-poll call, including
// the very first poll after the user approves — so both branches below reach into
// env.GOOGLE_CLIENT_SECRET; that secret is never sent to or readable by the browser.
async function handleToken(request, env) {
  const body = await readJson(request);
  if (!body) return json({ error: 'Invalid JSON body' }, 400);
  // This relay only ever brokers logins for our own OAuth Client — without this check, anyone could
  // point their own site at it and use it as a free CORS bridge for a device-flow login against a
  // completely different client_id, burning the shared per-IP rate-limit budget that protects
  // GITHUB_PAT.
  if (body.client_id !== env.GOOGLE_CLIENT_ID) {
    return json({ error: 'unknown client' }, 400);
  }
  if (!env.GOOGLE_CLIENT_SECRET) {
    return json({ error: 'server_error', error_description: 'Google login is not configured on this Worker.' }, 500);
  }

  if (body.grant_type === 'refresh_token') {
    if (!body.refresh_token) {
      return json({ error: 'invalid_request', error_description: 'Missing refresh_token' }, 400);
    }
    return relayDeviceFlow(GOOGLE_TOKEN_URL, {
      client_id: body.client_id,
      client_secret: env.GOOGLE_CLIENT_SECRET,
      grant_type: 'refresh_token',
      refresh_token: body.refresh_token,
    });
  }

  return relayDeviceFlow(GOOGLE_TOKEN_URL, {
    client_id: body.client_id,
    client_secret: env.GOOGLE_CLIENT_SECRET,
    device_code: body.device_code,
    grant_type: 'urn:ietf:params:oauth:grant-type:device_code',
  });
}

// Revokes exactly one token. Simpler than GitHub's revoke: Google's /revoke takes no client_secret
// and no Basic auth — it identifies the token by its own value, form-encoded, and returns 200 (not
// GitHub's 204) on success. Still accepts the same {client_id, access_token} JSON shape from the
// browser as before (client_id just isn't used in the outbound call) so google-auth.js's
// revokeToken() needs no change at all.
async function handleRevoke(request, env) {
  const body = await readJson(request);
  if (!body) return json({ error: 'Invalid JSON body' }, 400);
  const { access_token: accessToken } = body;
  if (!accessToken) return json({ error: 'Missing access_token' }, 400);

  try {
    const res = await fetch(GOOGLE_REVOKE_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: `token=${encodeURIComponent(accessToken)}`,
    });
    // The client already clears its local session unconditionally regardless of this response, so
    // treat anything short of a confirmed 200 as "couldn't confirm revocation" rather than guessing
    // at other status codes' meaning for this endpoint.
    return json({ ok: true, revoked: res.status === 200 });
  } catch (err) {
    return json({ ok: true, revoked: false });
  }
}

function toBase64(str) {
  const bytes = new TextEncoder().encode(str);
  let binary = '';
  for (const b of bytes) binary += String.fromCharCode(b);
  return btoa(binary);
}

function fromBase64(b64) {
  const binary = atob(b64);
  const bytes = Uint8Array.from(binary, (c) => c.charCodeAt(0));
  return new TextDecoder().decode(bytes);
}

function contentsUrl(env, path) {
  return `https://api.github.com/repos/${env.GITHUB_OWNER}/${env.GITHUB_REPO}/contents/${path}`;
}

// GitHub's API rejects any request with no User-Agent header (403) — Cloudflare Workers' fetch()
// doesn't send a default one the way curl/browsers do, so every call through here was silently
// failing without this. Only used for reading/writing this GitHub repo via GITHUB_PAT — unrelated
// to caller identity, which is now Google-verified (see verifyGoogleIdToken below).
function githubHeaders(token) {
  return {
    Authorization: `Bearer ${token}`,
    Accept: 'application/vnd.github+json',
    'User-Agent': 'dempsey-golf-tracker-worker',
  };
}

// Best-effort, per-isolate cache — acceptable at this scale; a cold isolate just re-fetches.
let _teamsCache = null;
let _teamsCacheAt = 0;

async function getTeamsJson(env) {
  if (_teamsCache && Date.now() - _teamsCacheAt < TEAMS_CACHE_TTL_MS) return _teamsCache;

  const res = await fetch(contentsUrl(env, TEAMS_JSON_PATH), { headers: githubHeaders(env.GITHUB_PAT) });
  if (!res.ok) throw new Error('Failed to fetch teams.json');
  const data = await res.json();
  const teams = JSON.parse(fromBase64(data.content));

  _teamsCache = teams;
  _teamsCacheAt = Date.now();
  return teams;
}

// Verifies the caller's Google ID token locally against Google's rotating public keys (JWKS) —
// checks signature, issuer, audience, and expiry all in one call. Deliberately NOT using Google's
// /tokeninfo endpoint here: Google's own docs call that debug-only, and a live network round-trip
// on every single admin check would add an external dependency and latency this doesn't need.
// Collapses every failure mode (bad signature, expired, wrong issuer/audience) to `null`, matching
// the old getCallerUsername()'s "null on any failure" shape.
async function verifyGoogleIdToken(idToken, env) {
  try {
    const { payload } = await jwtVerify(idToken, googleJwks, {
      issuer: GOOGLE_ISSUERS,
      audience: env.GOOGLE_CLIENT_ID,
    });
    if (typeof payload.email !== 'string' || !payload.email) return null;
    // An unconfirmed email claim shouldn't be trusted for an admin gate.
    if (payload.email_verified === false) return null;
    return payload.email;
  } catch (err) {
    return null;
  }
}

// Shared by handleWhoami and handlePublish (previously two separately-duplicated inline checks
// against adminUsernames) — case-insensitive since Google normalizes emails but a differently-cased
// entry in teams.json (typo, inconsistent casing when typed in) shouldn't silently fail with no
// indication why.
async function isAdminForTeam(email, teamSlug, env) {
  if (!email || !teamSlug) return false;
  const teams = await getTeamsJson(env);
  const team = teams[teamSlug];
  return Boolean(team && (team.adminEmails || []).some((e) => e.toLowerCase() === email.toLowerCase()));
}

// Lets the browser ask "am I admin for this team?" without needing read access to the repo itself —
// the Worker resolves the caller's identity via their own Google ID token and checks teams.json
// using its own PAT, so repo visibility never matters to the caller.
async function handleWhoami(request, env) {
  const authHeader = request.headers.get('Authorization') ?? '';
  const idToken = authHeader.replace(/^Bearer\s+/i, '');
  if (!idToken) return json({ isAdmin: false });

  const body = await readJson(request);
  if (!body) return json({ error: 'Invalid JSON body' }, 400);
  const { teamSlug } = body;
  const email = await verifyGoogleIdToken(idToken, env);
  if (!email || !teamSlug) return json({ isAdmin: false });

  try {
    const isAdmin = await isAdminForTeam(email, teamSlug, env);
    return json({ isAdmin, email });
  } catch (err) {
    return json({ isAdmin: false });
  }
}

async function handlePublish(request, env) {
  const authHeader = request.headers.get('Authorization') ?? '';
  const idToken = authHeader.replace(/^Bearer\s+/i, '');
  if (!idToken) return json({ error: 'Missing Authorization token' }, 401);

  const body = await readJson(request);
  if (!body) return json({ error: 'Invalid JSON body' }, 400);
  const { teamSlug, path, content, message } = body;
  if (!teamSlug || !path || !content || !message) {
    return json({ error: 'Missing teamSlug, path, content, or message' }, 400);
  }
  // Exact allowlist, not a prefix check: the client only ever writes this one file
  // (src/js/github-publish.js), so nothing legitimate needs any other path. A prefix+traversal
  // check still lets an authorized-for-team-A caller write *any* filename/extension into their own
  // team's directory (e.g. an .html file, which executes on this same shared origin that holds the
  // cross-team, unnamespaced auth token — see docs/decisions.md). Pinning to the one real path
  // removes that, the encoded-traversal question, and the extension question all at once.
  const allowedPath = `src/teams/${teamSlug}/reports/data/latest.json`;
  if (path !== allowedPath) {
    return json({ error: 'path not allowed' }, 400);
  }

  const email = await verifyGoogleIdToken(idToken, env);
  if (!email) return json({ error: 'Invalid or expired Google token' }, 401);

  let isAdmin;
  try {
    isAdmin = await isAdminForTeam(email, teamSlug, env);
  } catch (err) {
    return json({ error: 'Could not load teams.json' }, 500);
  }
  if (!isAdmin) {
    return json({ error: `${email} is not an admin for team "${teamSlug}"` }, 403);
  }

  const existingRes = await fetch(contentsUrl(env, path), { headers: githubHeaders(env.GITHUB_PAT) });
  const sha = existingRes.ok ? (await existingRes.json()).sha : undefined;

  const putRes = await fetch(contentsUrl(env, path), {
    method: 'PUT',
    headers: { ...githubHeaders(env.GITHUB_PAT), 'Content-Type': 'application/json' },
    body: JSON.stringify({
      message,
      content: toBase64(JSON.stringify(content, null, 2)),
      branch: env.GITHUB_BRANCH,
      ...(sha ? { sha } : {}),
    }),
  });

  if (!putRes.ok) {
    const err = await putRes.json().catch(() => ({}));
    return json({ error: err.message || 'Failed to commit file' }, 502);
  }
  return json({ ok: true });
}

// Flat per-IP cap across every POST endpoint (see wrangler.toml's RATE_LIMITER binding) — this
// Worker holds a powerful credential (GITHUB_PAT), so an unthrottled public endpoint in front of it
// is worth guarding even at this project's small scale.
async function checkRateLimit(request, env) {
  const ip = request.headers.get('CF-Connecting-IP') ?? 'unknown';
  const { success } = await env.RATE_LIMITER.limit({ key: ip });
  return success;
}

export default {
  async fetch(request, env) {
    if (request.method === 'OPTIONS') {
      return new Response(null, { headers: CORS_HEADERS });
    }
    if (request.method !== 'POST') {
      return new Response('Method not allowed', { status: 405, headers: CORS_HEADERS });
    }

    if (!(await checkRateLimit(request, env))) {
      return json({ error: 'Too many requests — please wait a moment and try again.' }, 429);
    }

    const url = new URL(request.url);
    if (url.pathname === '/publish') {
      return handlePublish(request, env);
    }
    if (url.pathname === '/whoami') {
      return handleWhoami(request, env);
    }
    if (url.pathname === '/revoke') {
      return handleRevoke(request, env);
    }
    if (url.pathname === '/token') {
      return handleToken(request, env);
    }
    if (url.pathname === '/device/code') {
      const body = await readJson(request);
      if (!body) return json({ error: 'Invalid JSON body' }, 400);
      if (body.client_id !== env.GOOGLE_CLIENT_ID) {
        return json({ error: 'unknown client' }, 400);
      }
      // Scope is hardcoded server-side, not client-supplied — the client never gets to dictate what
      // access it's requesting. openid+email+profile is all this app needs: identity only, never
      // access to the coach's actual Google data (Drive, Calendar, etc.).
      return relayDeviceFlow(GOOGLE_DEVICE_CODE_URL, { client_id: body.client_id, scope: 'openid email profile' });
    }
    return new Response('Not found', { status: 404, headers: CORS_HEADERS });
  },
};
