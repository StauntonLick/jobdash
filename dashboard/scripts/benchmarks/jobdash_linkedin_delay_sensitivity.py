#!/usr/bin/env python3
"""Compare one LinkedIn search under two delay profiles.

This is a quick spot-check script. It uses the London CONFIG entry because it
usually produces enough pages to make the delay effect obvious.
"""

from __future__ import annotations

import ast
import json
import os
import re
import sys
import time
from pathlib import Path

ROOT = Path(__file__).resolve().parents[3]
DASHBOARD = ROOT / "dashboard"
CONFIG = ROOT / "CONFIG.MD"
sys.path.insert(0, str((DASHBOARD / "scripts").resolve()))

from jobspy import scrape_jobs
from jobspy.linkedin import LinkedIn
from jobspy_patches import apply_linkedin_pagination_patch


def parse_scalar(value: str):
    value = value.strip().rstrip(",")
    if value.startswith("[") and value.endswith("]"):
        try:
            return ast.literal_eval(value)
        except Exception:
            return [part.strip().strip("\"'") for part in value[1:-1].split(",") if part.strip()]
    if re.fullmatch(r"(?i)true|false", value):
        return value.lower() == "true"
    if re.fullmatch(r"-?\d+(\.\d+)?", value):
        return int(value) if re.fullmatch(r"-?\d+", value) else float(value)
    return value.strip("\"'")


def load_london_criteria() -> dict:
    lines = CONFIG.read_text(encoding="utf-8").splitlines()
    top = None
    location_sub = None
    basic: dict = {}
    in_person: list[str] = []

    for raw_line in lines:
        line = raw_line.strip()
        if re.match(r"^##\s+BASIC SETTINGS\s*$", line, re.I):
            top = "basic"
            continue
        if re.match(r"^##\s+LOCATIONS\s*$", line, re.I):
            top = "locations"
            location_sub = None
            continue
        if re.match(r"^##\s+FILTERS\s*$", line, re.I):
            top = "filters"
            continue
        if top == "locations" and re.match(r"^###\s+In-Person", line, re.I):
            location_sub = "inperson"
            continue
        match = re.match(r"^-\s+(.+)$", line)
        if not match:
            continue
        item = match.group(1).strip()
        if top == "basic" and "=" in item:
            key, raw_value = item.split("=", 1)
            basic[key.strip()] = parse_scalar(raw_value.strip())
        elif top == "locations" and location_sub == "inperson":
            in_person.append(item)

    for item in in_person:
        parts = [part.strip() for part in item.split(",")]
        if len(parts) < 3:
            continue
        location, country, distance = parts[0], parts[1], int(parts[2])
        if location.lower() == "london":
            criteria = dict(basic)
            criteria.update(
                {
                    "location": location,
                    "country_indeed": country,
                    "distance": distance,
                    "is_remote": False,
                    "site_name": "linkedin",
                }
            )
            return criteria
    raise RuntimeError("London criteria not found in CONFIG.MD")


def run_once(criteria: dict, delay: float, band_delay: float) -> dict:
    os.environ["JOBDASH_LINKEDIN_DELAY_SECONDS"] = str(delay)
    os.environ["JOBDASH_LINKEDIN_BAND_DELAY_SECONDS"] = str(band_delay)
    apply_linkedin_pagination_patch()
    LinkedIn.delay = float(delay)
    LinkedIn.band_delay = float(band_delay)

    started = time.perf_counter()
    jobs = scrape_jobs(**criteria)
    elapsed = time.perf_counter() - started
    count = int(len(jobs.index)) if hasattr(jobs, "index") else 0

    return {
        "delay": delay,
        "band_delay": band_delay,
        "seconds": round(elapsed, 2),
        "count": count,
    }


def main() -> int:
    criteria = load_london_criteria()
    results = [
        {"profile": "current-default", **run_once(criteria, 0.5, 1.0)},
        {"profile": "zero-delay", **run_once(criteria, 0.0, 0.0)},
    ]
    print(json.dumps(results, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
