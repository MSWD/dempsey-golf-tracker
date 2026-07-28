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
// Deploy: `wrangler deploy` (or paste into the Cloudflare dashboard's Quick Edit) under the same
// Cloudflare account that manages mswd.us DNS. Requires env vars/secrets: GITHUB_PAT (secret),
// GITHUB_OWNER, GITHUB_REPO, GITHUB_BRANCH. See docs/auth-and-publishing.md for full setup.

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

    const body = await request.json();
    if (url.pathname === '/device/code') {
      return relayDeviceFlow(GITHUB_DEVICE_CODE_URL, { client_id: body.client_id });
    }
    if (url.pathname === '/token') {
      return relayDeviceFlow(GITHUB_TOKEN_URL, {
        client_id: body.client_id,
        device_code: body.device_code,
        grant_type: 'urn:ietf:params:oauth:grant-type:device_code',
      });
    }
    return new Response('Not found', { status: 404, headers: CORS_HEADERS });
  },
};
