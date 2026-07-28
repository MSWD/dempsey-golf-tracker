// Single source of truth for everything team-specific. Forking this app for another team means
// editing this file (+ swapping the logo + replacing seed_data.json) — no other file
// should hardcode a team name, colors, repo target, or domain.
const TEAM_CONFIG = {
  teamSlug: 'dempsey',
  teamName: 'Delaware Dempsey Pacers Golf',
  shortName: 'Dempsey Golf',
  siteTitle: 'Dempsey Golf Tracker',

  // Optional — omit to fall back to the shared golf-green-flag icon (see app.js).
  logoPath: '../../assets/branding/delaware-pacers-golf-logo.png',
  logoAlt: 'Delaware Pacers Golf logo',
  iconSpritePath: '../../assets/icons.svg',
  iconSymbolId: 'icon-golf-green',

  colors: {
    primary: '#d94f4f',   // pennant red
    secondary: '#3f8f3f', // green
    accent: '#e8801a',    // Pacers orange
    dark: '#1a1a1a',
  },

  github: {
    owner: 'MSWD',
    repo: 'dempsey-golf-tracker',
    defaultBranch: 'main',
  },

  // Filled in once the GitHub App + Cloudflare Worker relay are set up — see
  // docs/auth-and-publishing.md. Until then, admin login/publishing is unavailable and the app
  // stays in viewer mode, which is the safe default.
  githubApp: {
    clientId: 'Iv23lihwcQrIGaTeMaO4',
    deviceFlowWorkerUrl: 'https://middle-school-golf-tracker-auth.montgomery-software-and-web-development-account.workers.dev',
  },

  domain: 'https://middle-school-golf-tracker.mswd.us/teams/dempsey',
};
