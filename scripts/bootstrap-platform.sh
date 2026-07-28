#!/usr/bin/env bash
# One-time platform bootstrap — run exactly once, not per team. Automates what's genuinely
# scriptable (Cloudflare DNS + Worker deploy, GitHub Pages source/domain config) and prints the
# manual steps that aren't (GitHub App registration, waiting for domain/TLS verification).
#
# Requires: curl, jq. Prompts for GITHUB_TOKEN (a PAT with repo admin rights, used only here —
# NOT the Worker's own runtime secret) and CLOUDFLARE_API_TOKEN if not already set in your shell.
set -uo pipefail

DOMAIN="middle-school-golf-tracker.mswd.us"
DNS_ZONE_NAME="mswd.us"
DNS_RECORD_NAME="middle-school-golf-tracker"
GITHUB_OWNER="MSWD"
GITHUB_REPO="dempsey-golf-tracker"

command -v jq >/dev/null || { echo "jq is required. Install it (e.g. 'brew install jq') and re-run." >&2; exit 1; }

# Runs a curl request and prints the HTTP status + response body on failure instead of failing
# silently. Prints the response body (on success) to stdout for callers that need it.
# Usage: api_call METHOD URL DATA HEADER1 [HEADER2]  (pass DATA as "" for GET requests)
api_call() {
  local method="$1" url="$2" data="$3" header1="$4" header2="${5:-}"
  local resp code body
  local curl_args=(-s -w '\n%{http_code}' -X "$method" -H "$header1")
  [ -n "$header2" ] && curl_args+=(-H "$header2")
  [ -n "$data" ] && curl_args+=(-d "$data")

  resp=$(curl "${curl_args[@]}" "$url")
  code=$(echo "$resp" | tail -n1)
  body=$(echo "$resp" | sed '$d')

  if [ "$code" -lt 200 ] || [ "$code" -ge 300 ]; then
    echo "  HTTP $code from $method $url:" >&2
    echo "$body" | (jq . 2>/dev/null || cat) >&2
    return 1
  fi
  echo "$body"
  return 0
}

if [ -z "${GITHUB_TOKEN:-}" ]; then
  read -rsp "GitHub PAT (repo admin rights, used only for this one-time setup): " GITHUB_TOKEN
  echo
fi
if [ -z "${CLOUDFLARE_API_TOKEN:-}" ]; then
  read -rsp "Cloudflare API token (Zone:DNS:Edit + Workers:Edit): " CLOUDFLARE_API_TOKEN
  echo
fi

GH_AUTH="Authorization: Bearer $GITHUB_TOKEN"
GH_ACCEPT="Accept: application/vnd.github+json"

echo
echo "== GitHub Pages: configure Actions-based build + custom domain =="
# Legacy branch-based Pages only allows a source path of "/" or "/docs" — not "/src" — so this
# platform deploys via a GitHub Actions workflow instead (.github/workflows/deploy-pages.yml),
# which uploads src/ as the Pages artifact regardless of its path. That workflow runs on a
# published Release, not on every push — the site won't actually go live until you cut one.
if api_call POST "https://api.github.com/repos/$GITHUB_OWNER/$GITHUB_REPO/pages" \
  '{"build_type": "workflow"}' "$GH_AUTH" "$GH_ACCEPT" >/dev/null; then
  echo "  Pages enabled (build type: workflow)."
else
  echo "  ^ Create call failed — see error above. If it says Pages already exists, that's fine;"
  echo "    continuing to the domain-set step. Any other error means the domain-set step below"
  echo "    will likely fail too — read the message above before re-running."
fi

if api_call PUT "https://api.github.com/repos/$GITHUB_OWNER/$GITHUB_REPO/pages" \
  "$(jq -n --arg cname "$DOMAIN" '{cname: $cname}')" "$GH_AUTH" "$GH_ACCEPT" >/dev/null; then
  echo "  Custom domain set to $DOMAIN."
  echo "  The site won't be live until the deploy workflow runs — cut a GitHub Release (or run"
  echo "  the 'Deploy to GitHub Pages' workflow manually) to trigger the first deploy."
  echo "  Domain verification + TLS cert issuance happen asynchronously on GitHub's side."
else
  echo "  ^ Setting the custom domain failed — see error above. Fix that before continuing;" >&2
  echo "    everything below this point doesn't depend on it, so it's safe to keep going and" >&2
  echo "    come back to Settings > Pages in the repo to set the domain manually." >&2
fi

echo
echo "== Cloudflare: DNS CNAME record =="
zone_resp=$(api_call GET "https://api.cloudflare.com/client/v4/zones?name=$DNS_ZONE_NAME" "" \
  "Authorization: Bearer $CLOUDFLARE_API_TOKEN")
zone_id=$(echo "$zone_resp" | jq -r '.result[0].id // empty')
if [ -z "$zone_id" ]; then
  echo "  Could not find zone $DNS_ZONE_NAME in this Cloudflare account. Skipping DNS record." >&2
else
  dns_body=$(jq -n --arg name "$DNS_RECORD_NAME" --arg content "$GITHUB_OWNER.github.io" \
    '{type: "CNAME", name: $name, content: $content, proxied: false}')
  if api_call POST "https://api.cloudflare.com/client/v4/zones/$zone_id/dns_records" "$dns_body" \
    "Authorization: Bearer $CLOUDFLARE_API_TOKEN" "Content-Type: application/json" >/dev/null; then
    echo "  Created CNAME $DNS_RECORD_NAME.$DNS_ZONE_NAME -> $GITHUB_OWNER.github.io (DNS only, not proxied)."
  else
    echo "  ^ DNS record creation failed — see error above (a common cause: the record already" >&2
    echo "    exists from a previous run — check the Cloudflare dashboard before re-running)." >&2
  fi
fi

echo
echo "== Cloudflare Worker deploy =="
if command -v wrangler >/dev/null; then
  (cd "$(dirname "$0")/../worker" && CLOUDFLARE_API_TOKEN="$CLOUDFLARE_API_TOKEN" wrangler deploy)
  echo "  Deployed. Set its GITHUB_PAT secret separately (not this GITHUB_TOKEN — see"
  echo "  docs/auth-and-publishing.md):  wrangler secret put GITHUB_PAT"
else
  echo "  wrangler CLI not found — install it ('npm install -g wrangler') and run" >&2
  echo "  'wrangler deploy' from worker/ manually." >&2
fi

echo
echo "== Manual steps that can't be automated from a bare token =="
echo "  1. Register the GitHub App (Settings > Developer settings > GitHub Apps > New GitHub App)."
echo "     Enable Device Flow, grant Contents: Read & write, install it on $GITHUB_OWNER/$GITHUB_REPO."
echo "     Copy its Client ID into every team's team-config.js (githubApp.clientId)."
echo "  2. Wait for GitHub's domain verification + TLS cert (Settings > Pages in the repo)."
echo "  See docs/auth-and-publishing.md for full detail on both."
