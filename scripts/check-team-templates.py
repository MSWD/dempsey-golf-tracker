#!/usr/bin/env python3
"""Fail if any team's scaffolded files have drifted from add-team.py's security-relevant template.

add-team.py writes each team's files once, at creation time; nothing re-applies template changes
afterward. Per-team customization (title, colors, admin list, ...) is expected and fine — what
this checks is the small set of things a security fix depends on: every team must vendor
chart.js locally (not load it from a CDN) and carry the CSP meta tag, and every team's
report-viewer.js/match-render.js/match-viewer.js must match the canonical copies add-team.py
duplicates them from (none of the three carry per-team data — anything team-specific comes from
team-config.js or the fetched report JSON at runtime).

Usage: scripts/check-team-templates.py
"""
import json
import re
import sys
from pathlib import Path

SRC = Path(__file__).resolve().parent.parent / "src"
CANONICAL_REPORTS_DIR = SRC / "teams" / "dempsey" / "reports"
CANONICAL_SHARED_SCRIPTS = ["report-viewer.js", "match-render.js", "match-viewer.js"]

VENDORED_CHART_SCRIPT = '<script src="../../assets/vendor/chart.min.js"></script>'
CSP_META_PATTERN = re.compile(r'<meta http-equiv="Content-Security-Policy"')
THIRD_PARTY_SCRIPT_PATTERN = re.compile(r'<script[^>]+src=["\']https?://', re.IGNORECASE)
LOCAL_SCRIPT_SRC_PATTERN = re.compile(r'<script src="([^"]+)"></script>')

# The app's own src/js/*.js files should be identical, in the same order, across every team's
# index.html (each is a plain global <script> tag, no modules/build step — see
# docs/architecture.md). Nothing re-applies scripts/add-team.py's INDEX_HTML_TEMPLATE after a team
# is scaffolded, so a script added to one team's page (or the template) but not the others would
# otherwise silently break that team's app with no CI signal — this check catches that drift.
CANONICAL_APP_SCRIPTS = [
    "team-config.js", "../../version.js", "../../js/html-utils.js", "../../js/models.js",
    "../../js/scoring-engine.js", "../../js/data-store.js", "../../js/ui-roster.js",
    "../../js/course-import.js", "../../js/ui-courses.js", "../../js/ui-rounds.js",
    "../../js/ui-charts.js", "../../js/ui-matches.js", "../../js/ui-help.js",
    "../../js/ui-maintenance.js", "../../js/google-auth.js", "../../js/github-publish.js",
    "../../js/app.js",
]


def check_html(path: Path, mismatches: list, require_vendored_chart: bool):
    if not path.exists():
        mismatches.append(f"{path} does not exist")
        return
    text = path.read_text()
    if THIRD_PARTY_SCRIPT_PATTERN.search(text):
        mismatches.append(f"{path} loads a script from a third-party origin (should be vendored under assets/vendor/)")
    if not CSP_META_PATTERN.search(text):
        mismatches.append(f"{path} is missing the Content-Security-Policy meta tag")
    if require_vendored_chart and VENDORED_CHART_SCRIPT not in text:
        mismatches.append(f"{path} does not reference the vendored {VENDORED_CHART_SCRIPT}")


def check_app_script_list(path: Path, mismatches: list):
    if not path.exists():
        return
    text = path.read_text()
    found = [m for m in LOCAL_SCRIPT_SRC_PATTERN.findall(text) if m in CANONICAL_APP_SCRIPTS or m.startswith("../../js/")]
    if found != CANONICAL_APP_SCRIPTS:
        mismatches.append(
            f"{path} script list {found} does not match the canonical app script list {CANONICAL_APP_SCRIPTS} "
            "(a src/js/*.js file was added/removed/reordered on one team's page but not applied everywhere)"
        )


def main():
    teams = json.loads((SRC / "teams.json").read_text())
    canonical_scripts = {
        name: (CANONICAL_REPORTS_DIR / name).read_text() for name in CANONICAL_SHARED_SCRIPTS
    }
    mismatches = []

    for slug in teams:
        team_dir = SRC / "teams" / slug
        check_html(team_dir / "index.html", mismatches, require_vendored_chart=True)
        check_app_script_list(team_dir / "index.html", mismatches)
        check_html(team_dir / "reports" / "index.html", mismatches, require_vendored_chart=False)
        check_html(team_dir / "reports" / "match.html", mismatches, require_vendored_chart=False)

        for name, canonical_text in canonical_scripts.items():
            script_path = team_dir / "reports" / name
            canonical_path = CANONICAL_REPORTS_DIR / name
            if script_path == canonical_path:
                continue
            if not script_path.exists():
                mismatches.append(f"{script_path} does not exist")
            elif script_path.read_text() != canonical_text:
                mismatches.append(
                    f"{script_path} has drifted from the canonical copy at {canonical_path}"
                )

    if mismatches:
        print("Team files have drifted from the security-relevant parts of the template:\n")
        for m in mismatches:
            print(f"  - {m}")
        print(
            "\nEither scripts/add-team.py's template changed after these teams were scaffolded, "
            "or a team's file was hand-edited. Re-apply the change to each team listed above."
        )
        sys.exit(1)

    print(f"All {len(teams)} team(s) match the security-relevant parts of the template.")


if __name__ == "__main__":
    main()
