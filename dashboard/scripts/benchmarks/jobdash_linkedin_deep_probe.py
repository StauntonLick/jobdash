#!/usr/bin/env python3
"""Profile LinkedIn scrape time by sub-stage.

This script instruments the patched JobSpy LinkedIn scraper to estimate how much
runtime is spent in network requests, inter-page sleep, and per-card processing.
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

from bs4 import BeautifulSoup
from jobspy import scrape_jobs
from jobspy_patches import apply_linkedin_pagination_patch

os.environ.setdefault("JOBDASH_LINKEDIN_DELAY_SECONDS", "0.5")
os.environ.setdefault("JOBDASH_LINKEDIN_BAND_DELAY_SECONDS", "1.0")

apply_linkedin_pagination_patch()

from jobspy.linkedin import LinkedIn


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


def run_probe_for(criteria: dict) -> dict:
    metrics = {
        "request_count": 0,
        "request_seconds": 0.0,
        "page_card_counts": [],
        "sleep_calls": 0,
        "sleep_seconds": 0.0,
        "process_calls": 0,
        "process_seconds": 0.0,
        "process_none_count": 0,
        "errors": [],
    }

    original_init = LinkedIn.__init__
    original_process = LinkedIn._process_job
    original_sleep = time.sleep

    def traced_sleep(seconds: float):
        metrics["sleep_calls"] += 1
        metrics["sleep_seconds"] += float(seconds)
        return original_sleep(seconds)

    def traced_init(self, *args, **kwargs):
        original_init(self, *args, **kwargs)
        original_get = self.session.get

        def traced_get(url, *args, **kwargs):
            started = time.perf_counter()
            response = original_get(url, *args, **kwargs)
            elapsed = time.perf_counter() - started
            if "seeMoreJobPostings/search" in str(url):
                metrics["request_count"] += 1
                metrics["request_seconds"] += elapsed
                try:
                    soup = BeautifulSoup(response.text, "html.parser")
                    metrics["page_card_counts"].append(
                        len(soup.find_all("div", class_="base-search-card"))
                    )
                except Exception as exc:
                    metrics["errors"].append(f"parse_cards: {exc}")
            return response

        self.session.get = traced_get

    def traced_process(self, job_card, job_id, full_descr):
        started = time.perf_counter()
        result = original_process(self, job_card, job_id, full_descr)
        elapsed = time.perf_counter() - started
        metrics["process_calls"] += 1
        metrics["process_seconds"] += elapsed
        if result is None:
            metrics["process_none_count"] += 1
        return result

    LinkedIn.__init__ = traced_init
    LinkedIn._process_job = traced_process
    time.sleep = traced_sleep

    try:
        run_criteria = dict(criteria)
        run_criteria["site_name"] = "linkedin"
        started = time.perf_counter()
        jobs = scrape_jobs(**run_criteria)
        total_seconds = time.perf_counter() - started
        job_count = int(len(jobs.index)) if hasattr(jobs, "index") else 0
        return {
            "total_seconds": round(total_seconds, 2),
            "job_count": job_count,
            "request_count": metrics["request_count"],
            "request_seconds": round(metrics["request_seconds"], 2),
            "avg_request_seconds": round(metrics["request_seconds"] / metrics["request_count"], 3)
            if metrics["request_count"]
            else 0,
            "page_card_counts": metrics["page_card_counts"],
            "sleep_calls": metrics["sleep_calls"],
            "sleep_seconds": round(metrics["sleep_seconds"], 2),
            "process_calls": metrics["process_calls"],
            "process_seconds": round(metrics["process_seconds"], 2),
            "avg_process_seconds": round(metrics["process_seconds"] / metrics["process_calls"], 4)
            if metrics["process_calls"]
            else 0,
            "process_none_count": metrics["process_none_count"],
            "unattributed_seconds": round(
                total_seconds
                - metrics["request_seconds"]
                - metrics["sleep_seconds"]
                - metrics["process_seconds"],
                2,
            ),
            "errors": metrics["errors"],
            "configured_delay_seconds": float(os.environ["JOBDASH_LINKEDIN_DELAY_SECONDS"]),
            "configured_band_delay_seconds": float(os.environ["JOBDASH_LINKEDIN_BAND_DELAY_SECONDS"]),
        }
    finally:
        LinkedIn.__init__ = original_init
        LinkedIn._process_job = original_process
        time.sleep = original_sleep


def main() -> int:
    targets = {"Scotland", "Newcastle", "London", "UK Remote"}
    probes = []
    for title, criteria in parse_config():
        if title in targets:
            probes.append({"title": title, "metrics": run_probe_for(criteria)})

    print(json.dumps({"probes": probes}, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
