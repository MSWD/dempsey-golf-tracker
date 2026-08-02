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

  // Optional — highlights the top N ranked players on the rankings screen (Dempsey always plays
  // its top 3 in matches). Omit this field for teams that don't want the highlight.
  rankHighlightCount: 3,

  // Optional — extra rankings columns (tryout avg, personal best, 9-hole HCP) plus red/yellow/
  // green shading on the rounds-played count, so the coach can see at a glance who still needs
  // rounds toward the coach's own 6-round target. Omit this field (or set enabled: false) for
  // teams that don't want it.
  extendedRankingStats: {
    enabled: true,
    roundsThresholds: { yellow: 4, green: 6 }, // red below yellow, yellow up to (not incl.) green
  },
};
