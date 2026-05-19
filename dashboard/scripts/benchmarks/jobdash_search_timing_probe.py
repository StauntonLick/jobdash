#!/usr/bin/env python3
"""Run a CONFIG-driven timing probe across all configured searches and sites.

This script mirrors the repo's CONFIG.MD parsing well enough to benchmark the
current search parameters without going through the Next.js API layer. It runs
Indeed and Glassdoor once per search definition, and LinkedIn three times per
search definition so you can inspect repeat-run variance.
"""

from __future__ import annotations

import ast
import json
import time
from pathlib import Path
from statistics import mean
import re
import subprocess

ROOT = Path(__file__).resolve().parents[3]
DASHBOARD = ROOT / "dashboard"
CONFIG = ROOT / "CONFIG.MD"
RUNNER = DASHBOARD / "scripts" / "run_jobspy_search.py"
PYTHON = ROOT / "venv" / "bin" / "python"


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


def parse_config() -> list[tuple[str, dict]]:
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
            }
        )
        definitions.append((f"{region} Remote", criteria))

    return definitions


def run_once(criteria: dict) -> dict:
    start = time.perf_counter()
    process = subprocess.run(
        [str(PYTHON), str(RUNNER)],
        input=json.dumps(criteria),
        capture_output=True,
        text=True,
        cwd=str(DASHBOARD),
        check=False,
    )
    wall_seconds = round(time.perf_counter() - start, 2)

    parsed: dict | None = None
    stdout = process.stdout.strip()
    if stdout:
        try:
            parsed = json.loads(stdout)
        except json.JSONDecodeError:
            parsed = {"error": stdout[:400]}

    return {
        "exit_code": process.returncode,
        "wall_seconds": wall_seconds,
        "runner_duration_seconds": parsed.get("duration_seconds") if parsed else None,
        "count": parsed.get("count") if parsed else None,
        "error": (parsed or {}).get("error") or process.stderr.strip() or None,
    }


def main() -> int:
    definitions = parse_config()
    sites = definitions[0][1].get("site_name", []) if definitions else []
    if isinstance(sites, str):
        sites = [sites]

    report = {
        "config": {
            "definitions": len(definitions),
            "sites": sites,
            "python": str(PYTHON),
        },
        "definitions": [],
        "summary": {},
    }

    site_totals: dict[str, list[float]] = {site: [] for site in sites}

    for title, base_criteria in definitions:
        definition_record = {"title": title, "sites": []}
        for site in sites:
            run_count = 3 if site == "linkedin" else 1
            runs = []
            for _ in range(run_count):
                criteria = dict(base_criteria)
                criteria["site_name"] = site
                result = run_once(criteria)
                runner_seconds = result.get("runner_duration_seconds")
                if isinstance(runner_seconds, (int, float)):
                    result["overhead_seconds"] = round(result["wall_seconds"] - float(runner_seconds), 2)
                else:
                    result["overhead_seconds"] = None
                runs.append(result)
                site_totals[site].append(result["wall_seconds"])

            definition_record["sites"].append({"site": site, "runs": runs})
        report["definitions"].append(definition_record)

    for site, values in site_totals.items():
        if not values:
            report["summary"][site] = {"runs": 0}
            continue
        report["summary"][site] = {
            "runs": len(values),
            "avg_wall_seconds": round(mean(values), 2),
            "min_wall_seconds": round(min(values), 2),
            "max_wall_seconds": round(max(values), 2),
        }

    print(json.dumps(report, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
