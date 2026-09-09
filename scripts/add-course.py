#!/usr/bin/env python3
"""Add one or more courses (e.g. transcribed from a scanned scorecard) into a season JSON file,
producing a new file rather than editing the original in place.

A "course draft" is a small JSON object/array shaped like:

  {
    "name": "Royal American Links",
    "holePars": [5,4,3,4,5,4,3,4,4, 5,4,4,3,4,4,4,3,5],
    "teeSets": [
      {"name": "Black", "holeYardages": [...18 numbers...], "rating": 73.2, "slope": 133},
      {"name": "Blue",  "holeYardages": [...18 numbers...], "rating": 70.7, "slope": 132}
    ],
    "defaultTeeSetName": "Gold"
  }

This mirrors src/js/models.js's newCourse/newTeeSet shapes and is validated against the same
rules as src/js/data-store.js's validateCourse/validateTeeSet (structural checks only — this repo
deliberately doesn't enforce referential integrity, see data-store.js's comment on that).

Stdlib only, no pip install needed. This script never runs git for you.

Usage:
  scripts/add-course.py --draft new-course.json --season season.json --out season-with-course.json
  scripts/add-course.py --draft new-course.json --season season.json --out out.json --update-id royalamerican
"""
import argparse
import json
import random
import string
import sys
import time
from pathlib import Path


def make_id(prefix):
    ts = base36(int(time.time() * 1000))
    rand = "".join(random.choice(string.ascii_lowercase + string.digits) for _ in range(6))
    return f"{prefix}_{ts}_{rand}"


def base36(n):
    digits = string.digits + string.ascii_lowercase
    if n == 0:
        return "0"
    out = []
    while n:
        n, r = divmod(n, 36)
        out.append(digits[r])
    return "".join(reversed(out))


def fail(msg):
    print(f"error: {msg}", file=sys.stderr)
    sys.exit(1)


def is_number_array(v, length_options=(9, 18)):
    return isinstance(v, list) and len(v) in length_options and all(isinstance(x, (int, float)) and not isinstance(x, bool) for x in v)


def build_tee_set(draft, hole_count):
    if "name" not in draft or not isinstance(draft["name"], str) or not draft["name"]:
        fail("teeSet.name must be a non-empty string")
    if not is_number_array(draft.get("holeYardages"), (hole_count,)):
        fail(f"teeSet '{draft['name']}'.holeYardages must be an array of {hole_count} numbers")
    hpo = draft.get("holeParsOverride")
    if hpo is not None and not is_number_array(hpo, (hole_count,)):
        fail(f"teeSet '{draft['name']}'.holeParsOverride must be null or an array of {hole_count} numbers")
    slope = draft.get("slope")
    rating = draft.get("rating")
    if slope is not None and not isinstance(slope, (int, float)):
        fail(f"teeSet '{draft['name']}'.slope must be null or a number")
    if rating is not None and not isinstance(rating, (int, float)):
        fail(f"teeSet '{draft['name']}'.rating must be null or a number")
    return {
        "id": make_id("tee"),
        "name": draft["name"],
        "holeYardages": draft["holeYardages"],
        "holeParsOverride": hpo,
        "slope": slope,
        "rating": rating,
    }


def build_course(draft, existing_id=None):
    if "name" not in draft or not isinstance(draft["name"], str) or not draft["name"]:
        fail("course.name must be a non-empty string")
    hole_pars = draft.get("holePars")
    if not is_number_array(hole_pars):
        fail("course.holePars must be an array of 9 or 18 numbers")
    hole_count = len(hole_pars)

    tee_sets = [build_tee_set(t, hole_count) for t in draft.get("teeSets", [])]

    default_id = None
    default_name = draft.get("defaultTeeSetName")
    if default_name:
        match = next((t for t in tee_sets if t["name"] == default_name), None)
        if match is None:
            fail(f"defaultTeeSetName '{default_name}' does not match any teeSet name")
        default_id = match["id"]

    return {
        "id": existing_id or make_id("course"),
        "name": draft["name"],
        "holePars": hole_pars,
        "totalPar": sum(hole_pars),
        "teeSets": tee_sets,
        "defaultTeeSetId": default_id,
        "verified": bool(draft.get("verified", False)),
    }


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--draft", required=True, help="Path to a course draft JSON file (single object or array of objects)")
    ap.add_argument("--season", required=True, help="Path to the season JSON file to merge into")
    ap.add_argument("--out", required=True, help="Path to write the merged season JSON file to (must not already exist)")
    ap.add_argument("--update-id", help="If set, replace the existing course with this id instead of appending a new one (single-draft only)")
    args = ap.parse_args()

    draft_path = Path(args.draft)
    season_path = Path(args.season)
    out_path = Path(args.out)

    if not draft_path.exists():
        fail(f"draft file not found: {draft_path}")
    if not season_path.exists():
        fail(f"season file not found: {season_path}")
    if out_path.exists():
        fail(f"refusing to overwrite existing file: {out_path}")

    draft_raw = json.loads(draft_path.read_text())
    drafts = draft_raw if isinstance(draft_raw, list) else [draft_raw]

    if args.update_id and len(drafts) != 1:
        fail("--update-id only supports a single-course draft")

    season = json.loads(season_path.read_text())
    if "courses" not in season or not isinstance(season["courses"], list):
        fail("season file has no 'courses' array")

    existing_ids = {c["id"] for c in season["courses"]}
    existing_names = {c["name"].strip().lower() for c in season["courses"]}

    new_courses = []
    for draft in drafts:
        if args.update_id:
            if args.update_id not in existing_ids:
                fail(f"--update-id '{args.update_id}' not found in season.courses")
            course = build_course(draft, existing_id=args.update_id)
        else:
            course = build_course(draft)
            if course["name"].strip().lower() in existing_names:
                print(f"warning: a course named '{course['name']}' already exists in this season file", file=sys.stderr)
        new_courses.append(course)

    if args.update_id:
        season["courses"] = [new_courses[0] if c["id"] == args.update_id else c for c in season["courses"]]
    else:
        season["courses"] = season["courses"] + new_courses

    out_path.write_text(json.dumps(season, indent=2) + "\n")
    for c in new_courses:
        tee_names = ", ".join(t["name"] for t in c["teeSets"]) or "none"
        print(f"added '{c['name']}' (id={c['id']}, {len(c['holePars'])} holes, par {c['totalPar']}, tees: {tee_names}) -> {out_path}")


if __name__ == "__main__":
    main()
