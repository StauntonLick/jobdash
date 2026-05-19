#!/usr/bin/env python3
"""Benchmark LinkedIn delay profiles for speed and reliability.

The script reruns a few higher-volume LinkedIn searches under multiple delay
profiles and compares result counts, runtime, and any obvious block signals.
"""

from __future__ import annotations

import ast
import json
import os
import re
import sys
import time
from pathlib import Path
from statistics import mean

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


def load_definitions() -> list[tuple[str, dict]]:
    lines = CONFIG.read_text(encoding="utf-8").splitlines()
    top = None
    location_sub = None
    basic: dict = {}
    in_person: list[str] = []
    remote: list[str] = []

    for raw_line in lines:
        line = raw_line.strip()
        if re.match(r"^##\s+BASIC SETTINGS\s*$", line, re.I):
            top = "basic"
            location_sub = None
            continue
        if re.match(r"^##\s+LOCATIONS\s*$", line, re.I):
            top = "locations"
            location_sub = None
            continue
        if re.match(r"^##\s+FILTERS\s*$", line, re.I):
            top = "filters"
            location_sub = None
            continue
        if top == "locations":
            if re.match(r"^###\s+In-Person", line, re.I):
                location_sub = "inperson"
                continue
            if re.match(r"^###\s+Remote Only", line, re.I):
                location_sub = "remote"
                continue

        match = re.match(r"^-\s+(.+)$", line)
        if not match:
            continue
        item = match.group(1).strip()

        if top == "basic" and "=" in item:
            key, raw_value = item.split("=", 1)
            basic[key.strip()] = parse_scalar(raw_value.strip())
        elif top == "locations":
            if location_sub == "inperson":
                in_person.append(item)
            elif location_sub == "remote":
                remote.append(item)

    definitions: list[tuple[str, dict]] = []
    for item in in_person:
        parts = [part.strip() for part in item.split(",")]
        if len(parts) < 3:
            continue
        location, country, distance = parts[0], parts[1], int(parts[2])
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
        definitions.append((location, criteria))

    for item in remote:
        region = item.strip()
        if not region:
            continue
        criteria = dict(basic)
        criteria.update(
            {
                "location": region,
                "country_indeed": region,
                "is_remote": True,
                "site_name": "linkedin",
            }
        )
        definitions.append((f"{region} Remote", criteria))

    return definitions


def run_once(criteria: dict, delay: float, band_delay: float) -> dict:
    os.environ["JOBDASH_LINKEDIN_DELAY_SECONDS"] = str(delay)
    os.environ["JOBDASH_LINKEDIN_BAND_DELAY_SECONDS"] = str(band_delay)
    apply_linkedin_pagination_patch()
    LinkedIn.delay = float(delay)
    LinkedIn.band_delay = float(band_delay)

    started = time.perf_counter()
    error = None
    count = 0
    try:
        jobs = scrape_jobs(**criteria)
        count = int(len(jobs.index)) if hasattr(jobs, "index") else 0
    except Exception as exc:
        error = str(exc)
    elapsed = time.perf_counter() - started

    return {
        "seconds": round(elapsed, 2),
        "count": count,
        "error": error,
        "bot_signal": bool(error and ("429" in error or "blocked" in error.lower())),
    }


def summarize(runs: list[dict]) -> dict:
    seconds = [run["seconds"] for run in runs]
    counts = [run["count"] for run in runs]
    return {
        "runs": len(runs),
        "avg_seconds": round(mean(seconds), 2),
        "min_seconds": round(min(seconds), 2),
        "max_seconds": round(max(seconds), 2),
        "avg_count": round(mean(counts), 1),
        "min_count": min(counts),
        "max_count": max(counts),
        "error_runs": sum(1 for run in runs if run["error"]),
        "bot_signal_runs": sum(1 for run in runs if run["bot_signal"]),
    }


def main() -> int:
    targets = {"Scotland", "London", "UK Remote"}
    selected = [(title, criteria) for title, criteria in load_definitions() if title in targets]
    profiles = [
        {"name": "current", "delay": 1.0, "band": 1.5},
        {"name": "candidate_safe_min", "delay": 0.5, "band": 1.0},
        {"name": "aggressive_check", "delay": 0.3, "band": 0.7},
    ]
    iterations = 3

    report = {"iterations": iterations, "locations": [], "overall": {}}

    for title, criteria in selected:
        location_record = {"title": title, "profiles": {}}
        for profile in profiles:
            runs = [run_once(criteria, profile["delay"], profile["band"]) for _ in range(iterations)]
            location_record["profiles"][profile["name"]] = {
                "delay": profile["delay"],
                "band": profile["band"],
                "summary": summarize(runs),
                "runs": runs,
            }
        report["locations"].append(location_record)

    for profile_name in ["candidate_safe_min", "aggressive_check"]:
        current_seconds: list[float] = []
        current_counts: list[int] = []
        candidate_seconds: list[float] = []
        candidate_counts: list[int] = []
        current_errors = 0
        current_bot_signals = 0
        candidate_errors = 0
        candidate_bot_signals = 0

        for location in report["locations"]:
            current_runs = location["profiles"]["current"]["runs"]
            candidate_runs = location["profiles"][profile_name]["runs"]
            current_seconds.extend(run["seconds"] for run in current_runs)
            current_counts.extend(run["count"] for run in current_runs)
            candidate_seconds.extend(run["seconds"] for run in candidate_runs)
            candidate_counts.extend(run["count"] for run in candidate_runs)
            current_errors += sum(1 for run in current_runs if run["error"])
            current_bot_signals += sum(1 for run in current_runs if run["bot_signal"])
            candidate_errors += sum(1 for run in candidate_runs if run["error"])
            candidate_bot_signals += sum(1 for run in candidate_runs if run["bot_signal"])

        report["overall"][profile_name] = {
            "avg_seconds_current": round(mean(current_seconds), 2),
            "avg_seconds_candidate": round(mean(candidate_seconds), 2),
            "speedup_seconds": round(mean(current_seconds) - mean(candidate_seconds), 2),
            "speedup_percent": round(
                ((mean(current_seconds) - mean(candidate_seconds)) / mean(current_seconds)) * 100,
                1,
            ),
            "avg_count_current": round(mean(current_counts), 1),
            "avg_count_candidate": round(mean(candidate_counts), 1),
            "count_delta": round(mean(candidate_counts) - mean(current_counts), 1),
            "error_runs_current": current_errors,
            "error_runs_candidate": candidate_errors,
            "bot_signal_runs_current": current_bot_signals,
            "bot_signal_runs_candidate": candidate_bot_signals,
        }

    print(json.dumps(report, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
