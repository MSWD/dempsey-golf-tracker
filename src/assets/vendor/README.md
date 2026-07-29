# Vendored dependencies

## chart.min.js

Chart.js **4.5.1** UMD build, downloaded from
`https://cdn.jsdelivr.net/npm/chart.js@4.5.1/dist/chart.umd.min.js` and committed as-is
(SHA-256: `48444a82d4edcb5bec0f1965faacdde18d9c17db3063d042abada2f705c9f54a`).

Vendored instead of loaded from a CDN at runtime so a compromised/updated CDN package can't run
arbitrary JS on an origin that holds a GitHub token in `localStorage`, and so the app's
`script-src 'self'` CSP doesn't need a third-party exception. See `js/ui-charts.js` for usage
(`new Chart(...)`).

### Upgrading

1. Pick a new 4.x version and download its UMD build:
   `curl -o chart.min.js https://cdn.jsdelivr.net/npm/chart.js@<version>/dist/chart.umd.min.js`
2. Confirm the banner comment at the top of the file shows the expected version.
3. Update the version and hash noted above.
4. Smoke-test the Charts tab for a team with rounds logged.
