// Cloudflare Worker: pure relay for GitHub's OAuth device-flow endpoints.
//
// Why this exists: GitHub's /login/device/code and access-token endpoints don't send CORS
// headers, so a static site's browser JS can't call them directly. This Worker just forwards
// the two requests server-side and adds CORS headers to the response. It holds no secrets — the
// GitHub App's device flow doesn't require a client secret, only the public client_id.
//
// Deploy: `wrangler deploy` (or paste into the Cloudflare dashboard's Quick Edit) under the same
// Cloudflare account that manages mswd.us DNS. See docs/auth-and-publishing.md for full setup.

const GITHUB_DEVICE_CODE_URL = 'https://github.com/login/device/code';
const GITHUB_TOKEN_URL = 'https://github.com/login/oauth/access_token';

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
};

async function relay(githubUrl, body) {
  const res = await fetch(githubUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify(body),
  });
  const data = await res.json();
  return new Response(JSON.stringify(data), {
    status: res.status,
    headers: { 'Content-Type': 'application/json', ...CORS_HEADERS },
  });
}

export default {
  async fetch(request) {
    if (request.method === 'OPTIONS') {
      return new Response(null, { headers: CORS_HEADERS });
    }
    if (request.method !== 'POST') {
      return new Response('Method not allowed', { status: 405, headers: CORS_HEADERS });
    }

    const url = new URL(request.url);
    const body = await request.json();

    if (url.pathname === '/device/code') {
      return relay(GITHUB_DEVICE_CODE_URL, { client_id: body.client_id });
    }
    if (url.pathname === '/token') {
      return relay(GITHUB_TOKEN_URL, {
        client_id: body.client_id,
        device_code: body.device_code,
        grant_type: 'urn:ietf:params:oauth:grant-type:device_code',
      });
    }
    return new Response('Not found', { status: 404, headers: CORS_HEADERS });
  },
};
