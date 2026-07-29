// Cloudflare Worker: (1) relays GitHub's OAuth device-flow endpoints, and (2) gatekeeps report
// publishing under path-based multi-team hosting.
//
// (1) Device-flow relay: GitHub's /login/device/code and access-token endpoints don't send CORS
// headers, so a static site's browser JS can't call them directly. This Worker forwards those two
// requests server-side and adds CORS headers to the response.
//
// (2) Publish gatekeeping: under path-based hosting, every team shares one repo, so GitHub's own
// repo-collaborator permission can't scope "who can administer team X" — a collaborator has
// push access to the whole repo. Admin rights are instead decided by src/teams.json (slug ->
// allowed GitHub usernames), which only the platform operator ever edits directly via git — no
// code path here writes to it. This Worker is the one non-spoofable place that mapping can be
// enforced: it identifies the caller via their own GitHub token (read-only — GET /user), checks
// them against teams.json, and only then commits, using its own fine-grained PAT (a Cloudflare
// secret, `GITHUB_PAT`) scoped to just this repo. The caller's token is never used to make the
// write itself.
//
// (3) Token refresh + revoke: once the GitHub App's user-to-server tokens expire (8h), the client
// exchanges its refresh_token here (grant_type=refresh_token) to get a new access token without
// re-running the whole device flow, and logout calls here to revoke the specific token being
// discarded. Both need the GitHub App's client secret — unlike the device-code exchange above,
// which is a public-client flow and never touches it.
//
// Deploy: `wrangler deploy` (or paste into the Cloudflare dashboard's Quick Edit) under the same
// Cloudflare account that manages mswd.us DNS. Requires env vars/secrets: GITHUB_PAT (secret),
// GITHUB_APP_CLIENT_SECRET (secret), GITHUB_OWNER, GITHUB_REPO, GITHUB_BRANCH. See
// docs/auth-and-publishing.md for full setup.

const GITHUB_DEVICE_CODE_URL = 'https://github.com/login/device/code';
const GITHUB_TOKEN_URL = 'https://github.com/login/oauth/access_token';
const TEAMS_JSON_PATH = 'src/teams.json';
const TEAMS_CACHE_TTL_MS = 5 * 60 * 1000; // short TTL — teams.json edits take a few minutes to propagate

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
};

function json(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', ...CORS_HEADERS },
  });
}

async function relayDeviceFlow(githubUrl, body) {
  const res = await fetch(githubUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify(body),
  });
  const data = await res.json();
  return json(data, res.status);
}

// Branches on the client's requested grant type. The device-code exchange (used during initial
// login) is a public-client flow — GitHub doesn't require, and will reject, a client_secret
// there. The refresh grant does require one, so it's the one branch that reaches into
// env.GITHUB_APP_CLIENT_SECRET; that secret is never sent to or readable by the browser.
async function handleToken(request, env) {
  const body = await request.json().catch(() => ({}));

  if (body.grant_type === 'refresh_token') {
    if (!body.refresh_token) {
      return json({ error: 'invalid_request', error_description: 'Missing refresh_token' }, 400);
    }
    if (!env.GITHUB_APP_CLIENT_SECRET) {
      return json({ error: 'server_error', error_description: 'Refresh is not configured on this Worker.' }, 500);
    }
    return relayDeviceFlow(GITHUB_TOKEN_URL, {
      client_id: body.client_id,
      client_secret: env.GITHUB_APP_CLIENT_SECRET,
      grant_type: 'refresh_token',
      refresh_token: body.refresh_token,
    });
  }

  return relayDeviceFlow(GITHUB_TOKEN_URL, {
    client_id: body.client_id,
    device_code: body.device_code,
    grant_type: 'urn:ietf:params:oauth:grant-type:device_code',
  });
}

// Revokes exactly this one access token — DELETE /applications/{client_id}/token — NOT
// DELETE /applications/{client_id}/grant, which would revoke the coach's entire authorization for
// this GitHub App across every device/session at once. The narrower /token endpoint matches
// "logout this tab"; the /grant one would silently sign the coach out everywhere, an easy,
// high-blast-radius mistake to make here.
async function handleRevoke(request, env) {
  const { client_id: clientId, access_token: accessToken } = await request.json().catch(() => ({}));
  if (!accessToken || !clientId) return json({ error: 'Missing client_id or access_token' }, 400);
  if (!env.GITHUB_APP_CLIENT_SECRET) {
    // Not configured yet (e.g. mid-rollout) — logout must never hard-fail client-side just
    // because this Worker deploy hasn't had the secret set.
    return json({ ok: true, revoked: false });
  }

  try {
    const res = await fetch(`https://api.github.com/applications/${clientId}/token`, {
      method: 'DELETE',
      headers: {
        Authorization: `Basic ${toBase64(`${clientId}:${env.GITHUB_APP_CLIENT_SECRET}`)}`,
        Accept: 'application/vnd.github+json',
        'Content-Type': 'application/json',
        'User-Agent': 'dempsey-golf-tracker-worker',
      },
      body: JSON.stringify({ access_token: accessToken }),
    });
    // The client already clears its local session unconditionally regardless of this response, so
    // treat anything short of a confirmed 204 as "couldn't confirm revocation" rather than
    // guessing at other status codes' meaning for this endpoint.
    return json({ ok: true, revoked: res.status === 204 });
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
// failing (getCallerUsername always returned null, so /whoami and /publish always looked like an
// invalid token, regardless of the actual token).
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

async function getCallerUsername(callerToken) {
  const res = await fetch('https://api.github.com/user', { headers: githubHeaders(callerToken) });
  if (!res.ok) return null;
  const user = await res.json();
  return user.login;
}

// Lets the browser ask "am I admin for this team?" without needing read access to the repo
// itself — the Worker resolves the caller's identity via their own token (works for any GitHub
// account) and checks teams.json using its own PAT, so repo visibility never matters to the caller.
async function handleWhoami(request, env) {
  const authHeader = request.headers.get('Authorization') ?? '';
  const callerToken = authHeader.replace(/^Bearer\s+/i, '');
  if (!callerToken) return json({ isAdmin: false });

  const { teamSlug } = await request.json();
  const username = await getCallerUsername(callerToken);
  if (!username || !teamSlug) return json({ isAdmin: false });

  try {
    const teams = await getTeamsJson(env);
    const team = teams[teamSlug];
    return json({ isAdmin: Boolean(team && team.adminUsernames.includes(username)), username });
  } catch (err) {
    return json({ isAdmin: false });
  }
}

async function handlePublish(request, env) {
  const authHeader = request.headers.get('Authorization') ?? '';
  const callerToken = authHeader.replace(/^Bearer\s+/i, '');
  if (!callerToken) return json({ error: 'Missing Authorization token' }, 401);

  const { teamSlug, path, content, message } = await request.json();
  if (!teamSlug || !path || !content || !message) {
    return json({ error: 'Missing teamSlug, path, content, or message' }, 400);
  }
  // Defense in depth: even an authorized team admin's request must target their own team's
  // directory — a client bug (or a malicious caller) can't redirect the write elsewhere by
  // passing a different path while claiming a valid teamSlug. A plain startsWith prefix check
  // isn't enough on its own — "src/teams/dempsey/../../teams.json" still satisfies it as a
  // literal string — so path segments are checked explicitly to rule out any ".."/"." traversal.
  const teamPrefix = `src/teams/${teamSlug}/`;
  const hasTraversalSegment = path.split('/').some((segment) => segment === '.' || segment === '..');
  if (!path.startsWith(teamPrefix) || hasTraversalSegment) {
    return json({ error: 'path must be under the requested team\'s own directory' }, 400);
  }

  const username = await getCallerUsername(callerToken);
  if (!username) return json({ error: 'Invalid or expired GitHub token' }, 401);

  let teams;
  try {
    teams = await getTeamsJson(env);
  } catch (err) {
    return json({ error: 'Could not load teams.json' }, 500);
  }

  const team = teams[teamSlug];
  if (!team || !team.adminUsernames.includes(username)) {
    return json({ error: `${username} is not an admin for team "${teamSlug}"` }, 403);
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
// Worker holds a powerful credential (GITHUB_PAT), so an unthrottled public endpoint in front of
// it is worth guarding even at this project's small scale.
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
      const body = await request.json();
      return relayDeviceFlow(GITHUB_DEVICE_CODE_URL, { client_id: body.client_id });
    }
    return new Response('Not found', { status: 404, headers: CORS_HEADERS });
  },
};
