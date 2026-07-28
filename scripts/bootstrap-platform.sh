#!/usr/bin/env bash
# One-time platform bootstrap — run exactly once, not per team. Automates what's genuinely
# scriptable (Cloudflare DNS + Worker deploy, GitHub Pages source/domain config) and prints the
# manual steps that aren't (GitHub App registration, waiting for domain/TLS verification).
#
# Requires: curl, jq. Prompts for GITHUB_TOKEN (a PAT with repo admin rights, used only here —
# NOT the Worker's own runtime secret) and CLOUDFLARE_API_TOKEN if not already set in your shell.
set -euo pipefail

DOMAIN="middle-school-golf-tracker.mswd.us"
DNS_ZONE_NAME="mswd.us"
DNS_RECORD_NAME="middle-school-golf-tracker"
GITHUB_OWNER="MSWD"
GITHUB_REPO="dempsey-golf-tracker"

command -v jq >/dev/null || { echo "jq is required. Install it (e.g. 'brew install jq') and re-run." >&2; exit 1; }

if [ -z "${GITHUB_TOKEN:-}" ]; then
  read -rsp "GitHub PAT (repo admin rights, used only for this one-time setup): " GITHUB_TOKEN
  echo
fi
if [ -z "${CLOUDFLARE_API_TOKEN:-}" ]; then
  read -rsp "Cloudflare API token (Zone:DNS:Edit + Workers:Edit): " CLOUDFLARE_API_TOKEN
  echo
fi

echo
echo "== GitHub Pages: configure Actions-based build + custom domain =="
# Legacy branch-based Pages only allows a source path of "/" or "/docs" — not "/src" — so this
# platform deploys via a GitHub Actions workflow instead (.github/workflows/deploy-pages.yml),
# which uploads src/ as the Pages artifact regardless of its path. That workflow runs on a
# published Release, not on every push — the site won't actually go live until you cut one.
curl -sf -X POST "https://api.github.com/repos/$GITHUB_OWNER/$GITHUB_REPO/pages" \
  -H "Authorization: Bearer $GITHUB_TOKEN" -H "Accept: application/vnd.github+json" \
  -d '{"build_type": "workflow"}' >/dev/null 2>&1 || echo "  (Pages may already be enabled — continuing)"

curl -sf -X PUT "https://api.github.com/repos/$GITHUB_OWNER/$GITHUB_REPO/pages" \
  -H "Authorization: Bearer $GITHUB_TOKEN" -H "Accept: application/vnd.github+json" \
  -d "$(jq -n --arg cname "$DOMAIN" '{cname: $cname}')" >/dev/null
echo "  Pages build type set to 'workflow', custom domain set to $DOMAIN."
echo "  The site won't be live until the deploy workflow runs — cut a GitHub Release (or run"
echo "  the 'Deploy to GitHub Pages' workflow manually) to trigger the first deploy."
echo "  Domain verification + TLS cert issuance happen asynchronously on GitHub's side — check"
echo "  Settings > Pages in the repo once the DNS record below has propagated AND a deploy has run."

echo
echo "== Cloudflare: DNS CNAME record =="
zone_id=$(curl -sf "https://api.cloudflare.com/client/v4/zones?name=$DNS_ZONE_NAME" \
  -H "Authorization: Bearer $CLOUDFLARE_API_TOKEN" | jq -r '.result[0].id')
if [ -z "$zone_id" ] || [ "$zone_id" = "null" ]; then
  echo "  Could not find zone $DNS_ZONE_NAME in this Cloudflare account. Skipping DNS record." >&2
else
  dns_body=$(jq -n --arg name "$DNS_RECORD_NAME" --arg content "$GITHUB_OWNER.github.io" \
    '{type: "CNAME", name: $name, content: $content, proxied: false}')
  curl -sf -X POST "https://api.cloudflare.com/client/v4/zones/$zone_id/dns_records" \
    -H "Authorization: Bearer $CLOUDFLARE_API_TOKEN" -H "Content-Type: application/json" \
    -d "$dns_body" >/dev/null
  echo "  Created CNAME $DNS_RECORD_NAME.$DNS_ZONE_NAME -> $GITHUB_OWNER.github.io (DNS only, not proxied)."
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
