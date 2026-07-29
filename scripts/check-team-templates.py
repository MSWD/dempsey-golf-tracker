#!/usr/bin/env python3
"""Fail if any team's scaffolded files have drifted from add-team.py's security-relevant template.

add-team.py writes each team's files once, at creation time; nothing re-applies template changes
afterward. Per-team customization (title, colors, admin list, ...) is expected and fine — what
this checks is the small set of things a security fix depends on: every team must vendor
chart.js locally (not load it from a CDN) and carry the CSP meta tag, and every team's
report-viewer.js must match the canonical copy add-team.py duplicates it from.

Usage: scripts/check-team-templates.py
"""
import json
import re
import sys
from pathlib import Path

SRC = Path(__file__).resolve().parent.parent / "src"
CANONICAL_REPORT_VIEWER = SRC / "teams" / "dempsey" / "reports" / "report-viewer.js"

VENDORED_CHART_SCRIPT = '<script src="../../assets/vendor/chart.min.js"></script>'
CSP_META_PATTERN = re.compile(r'<meta http-equiv="Content-Security-Policy"')
THIRD_PARTY_SCRIPT_PATTERN = re.compile(r'<script[^>]+src=["\']https?://', re.IGNORECASE)


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


def main():
    teams = json.loads((SRC / "teams.json").read_text())
    canonical_viewer = CANONICAL_REPORT_VIEWER.read_text()
    mismatches = []

    for slug in teams:
        team_dir = SRC / "teams" / slug
        check_html(team_dir / "index.html", mismatches, require_vendored_chart=True)
        check_html(team_dir / "reports" / "index.html", mismatches, require_vendored_chart=False)

        viewer_path = team_dir / "reports" / "report-viewer.js"
        if viewer_path != CANONICAL_REPORT_VIEWER:
            if not viewer_path.exists():
                mismatches.append(f"{viewer_path} does not exist")
            elif viewer_path.read_text() != canonical_viewer:
                mismatches.append(
                    f"{viewer_path} has drifted from the canonical copy at {CANONICAL_REPORT_VIEWER}"
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
