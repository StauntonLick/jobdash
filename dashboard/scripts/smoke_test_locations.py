#!/usr/bin/env python3
"""
smoke_test_locations.py — JobDash location/country smoke test.

Runs the full multi-site search path (same subprocess + resilience logic as
the TypeScript service) for a matrix of cities, remote regions, and keywords.
Reports result counts and wall-clock timings per site.

Usage (from the dashboard directory):
    python scripts/smoke_test_locations.py

Options (env vars):
    SMOKE_SITES        Comma-separated site list (default: indeed,linkedin,glassdoor)
    SMOKE_RESULTS      Results wanted per site per run  (default: 15)
    SMOKE_HOURS_OLD    Hours old passed to JobSpy       (default: 24)
    SMOKE_PARALLELISM  Max concurrent site searches     (default: 2)
    SMOKE_QUICK        Set to "1" to skip LinkedIn multi-run (default: off)
    SMOKE_DELAY        Seconds to wait between test cases (default: 0)
"""

from __future__ import annotations

import json
import os
import subprocess
import sys
import time
from concurrent.futures import ThreadPoolExecutor, as_completed
from pathlib import Path

# ── Config (mirrors TypeScript constants in jobspy-service.ts) ────────────────

SCRIPT = Path(__file__).parent / "run_jobspy_search.py"
PYTHON = sys.executable  # same env as us — guaranteed to have jobspy + pandas

SITES: list[str] = [
    s.strip()
    for s in os.environ.get("SMOKE_SITES", "indeed,linkedin,glassdoor").split(",")
    if s.strip()
]
RESULTS_WANTED: int = int(os.environ.get("SMOKE_RESULTS", "15") or 15)
HOURS_OLD: int = int(os.environ.get("SMOKE_HOURS_OLD", "24") or 24)
SITE_PARALLELISM: int = int(os.environ.get("SMOKE_PARALLELISM", "2") or 2)
QUICK_MODE: bool = os.environ.get("SMOKE_QUICK", "").strip() == "1"
INTER_CASE_DELAY: int = int(os.environ.get("SMOKE_DELAY", "0") or 0)

# Mirrors LINKEDIN_MIN_RUNS / LINKEDIN_MAX_RUNS in jobspy-service.ts
LINKEDIN_MIN_RUNS = 1 if QUICK_MODE else 2
LINKEDIN_MAX_RUNS = 1 if QUICK_MODE else 2

TIMEOUT_SECONDS = 180  # per individual Python subprocess call

# ── Search term ───────────────────────────────────────────────────────────────
#
# A broad OR query covering common white-collar / tech roles.
# Mirrors buildSearchTerm() in search-config.ts.

SEARCH_TERM = (
    '("Software Engineer" OR "Product Manager" OR "Product Designer" '
    'OR "Marketing Manager" OR "Data Scientist" OR "UX Designer" '
    'OR "Engineering Manager" OR "Data Engineer")'
)

# ── Test matrix ───────────────────────────────────────────────────────────────

TEST_CASES: list[dict] = [
    # ── Hybrid / in-office: major tech-job cities ──────────────────────────
    {
        "label": "San Francisco, US (hybrid)",
        "location": "San Francisco",
        "country_indeed": "United States",
        "is_remote": False,
        "distance": 50,
    },
    {
        "label": "New York, US (hybrid)",
        "location": "New York",
        "country_indeed": "United States",
        "is_remote": False,
        "distance": 50,
    },
    {
        "label": "Austin, US (hybrid)",
        "location": "Austin",
        "country_indeed": "United States",
        "is_remote": False,
        "distance": 50,
    },
    {
        "label": "Toronto, Canada (hybrid)",
        "location": "Toronto",
        "country_indeed": "Canada",
        "is_remote": False,
        "distance": 50,
    },
    {
        "label": "London, UK (hybrid)",
        "location": "London",
        "country_indeed": "United Kingdom",
        "is_remote": False,
        "distance": 50,
    },
    {
        "label": "Berlin, Germany (hybrid)",
        "location": "Berlin",
        "country_indeed": "Germany",
        "is_remote": False,
        "distance": 50,
    },
    {
        "label": "Amsterdam, Netherlands (hybrid)",
        "location": "Amsterdam",
        "country_indeed": "Netherlands",
        "is_remote": False,
        "distance": 50,
    },
    {
        "label": "Sydney, Australia (hybrid)",
        "location": "Sydney",
        "country_indeed": "Australia",
        "is_remote": False,
        "distance": 50,
    },
    # ── Remote searches ────────────────────────────────────────────────────
    # Mirrors remoteToDefinition(): location = country_indeed = country string.
    {
        "label": "Remote — United States",
        "location": "United States",
        "country_indeed": "United States",
        "is_remote": True,
    },
    {
        "label": "Remote — United Kingdom",
        "location": "United Kingdom",
        "country_indeed": "United Kingdom",
        "is_remote": True,
    },
    {
        "label": "Remote — France",
        "location": "France",
        "country_indeed": "France",
        "is_remote": True,
    },
]

# ── Subprocess wrapper ────────────────────────────────────────────────────────


def run_python_search(criteria: dict) -> tuple[list[dict], float, str | None]:
    """
    Invoke run_jobspy_search.py with the given criteria dict via stdin JSON.

    Returns (results, elapsed_seconds, error_message_or_None).
    """
    start = time.perf_counter()
    try:
        proc = subprocess.run(
            [PYTHON, str(SCRIPT)],
            input=json.dumps(criteria),
            capture_output=True,
            text=True,
            timeout=TIMEOUT_SECONDS,
        )
        elapsed = time.perf_counter() - start

        if proc.returncode != 0:
            err = (proc.stderr or proc.stdout or "").strip()
            return [], elapsed, f"exit {proc.returncode}: {err[:300]}"

        parsed = json.loads(proc.stdout)
        if "error" in parsed:
            return [], elapsed, str(parsed["error"])[:300]

        return parsed.get("results", []), elapsed, None

    except subprocess.TimeoutExpired:
        return [], time.perf_counter() - start, f"timeout after {TIMEOUT_SECONDS}s"
    except Exception as exc:
        return [], time.perf_counter() - start, str(exc)


# ── Per-site resilience logic (mirrors runResilientSearch in jobspy-service.ts) ──


def run_site(site: str, base_criteria: dict) -> tuple[str, list[dict], float, list[str]]:
    """
    Run a single-site search with site-specific resilience behaviour.

    Returns (site, results, total_elapsed, warnings).
    """
    criteria = {**base_criteria, "site_name": site, "results_wanted": RESULTS_WANTED}
    warnings: list[str] = []

    if site == "linkedin":
        # Mirror TS: always run LINKEDIN_MIN_RUNS, up to LINKEDIN_MAX_RUNS.
        # Merge results across runs; break early if a run produces nothing new.
        seen_keys: set[str] = set()
        merged: list[dict] = []
        total_elapsed = 0.0

        for run_idx in range(LINKEDIN_MAX_RUNS):
            results, elapsed, err = run_python_search(criteria)
            total_elapsed += elapsed

            if err:
                warnings.append(f"LinkedIn run {run_idx + 1}: {err}")
                if run_idx < LINKEDIN_MIN_RUNS - 1:
                    continue
                break

            added = 0
            for r in results:
                key = _result_key(r)
                if key not in seen_keys:
                    seen_keys.add(key)
                    merged.append(r)
                    added += 1

            # After minimum runs: stop if this run added nothing new.
            if run_idx >= LINKEDIN_MIN_RUNS - 1 and added == 0:
                break

        return site, merged, total_elapsed, warnings

    if site == "glassdoor":
        # Mirror TS: single run; retry up to GLASSDOOR_MAX_RETRIES_ON_ZERO only
        # if we previously had Glassdoor results (the smoke test has no prior
        # cache, so we just do one run and accept 0 results without retrying).
        results, elapsed, err = run_python_search(criteria)
        if err:
            warnings.append(f"Glassdoor: {err}")
        return site, results, elapsed, warnings

    # Default (indeed, and any other site): single run.
    results, elapsed, err = run_python_search(criteria)
    if err:
        warnings.append(f"{site}: {err}")
    return site, results, elapsed, warnings


# ── Deduplication ─────────────────────────────────────────────────────────────


def _result_key(row: dict) -> str:
    """Stable dedup key: normalised title + company (mirrors TS dedupeResults)."""
    title = (row.get("title") or "").strip().lower()
    company = (row.get("company") or "").strip().lower()
    return f"{title}::{company}"


def dedup(rows: list[dict]) -> list[dict]:
    seen: set[str] = set()
    out: list[dict] = []
    for r in rows:
        k = _result_key(r)
        if k not in seen:
            seen.add(k)
            out.append(r)
    return out


# ── Test-case runner ──────────────────────────────────────────────────────────


def run_test_case(case: dict) -> dict:
    """
    Run all sites concurrently for one test case.

    Returns a result dict with per-site counts, timings, and totals.
    """
    base_criteria: dict = {
        "search_term": SEARCH_TERM,
        "hours_old": HOURS_OLD,
        "location": case["location"],
        "country_indeed": case["country_indeed"],
        "is_remote": case["is_remote"],
        "linkedin_fetch_description": False,
    }
    if "distance" in case:
        base_criteria["distance"] = case["distance"]

    site_results: dict[str, tuple[list[dict], float, list[str]]] = {}
    all_warnings: list[str] = []
    case_start = time.perf_counter()

    with ThreadPoolExecutor(max_workers=SITE_PARALLELISM) as pool:
        futures = {
            pool.submit(run_site, site, base_criteria): site for site in SITES
        }
        for future in as_completed(futures):
            site_name, results, elapsed, warnings = future.result()
            site_results[site_name] = (results, elapsed, warnings)
            all_warnings.extend(warnings)

    case_elapsed = time.perf_counter() - case_start

    # Aggregate across sites
    all_rows: list[dict] = []
    for site in SITES:
        if site in site_results:
            all_rows.extend(site_results[site][0])

    deduped = dedup(all_rows)

    return {
        "label": case["label"],
        "total": len(deduped),
        "by_site": {
            site: len(site_results[site][0]) if site in site_results else -1
            for site in SITES
        },
        "site_timings": {
            site: site_results[site][1] if site in site_results else 0.0
            for site in SITES
        },
        "case_elapsed": case_elapsed,
        "warnings": all_warnings,
    }


# ── Formatting ────────────────────────────────────────────────────────────────

COL_LABEL = 36
COL_SITE = 10
COL_TOTAL = 7
COL_TIME = 8
SEPARATOR = "─" * (COL_LABEL + len(SITES) * COL_SITE + COL_TOTAL + COL_TIME + 8)


def fmt_time(seconds: float) -> str:
    if seconds >= 60:
        m, s = divmod(int(seconds), 60)
        return f"{m}m{s:02d}s"
    return f"{seconds:.1f}s"


def fmt_count(n: int) -> str:
    return "ERR" if n < 0 else str(n)


def print_summary(results: list[dict]) -> None:
    print()
    print("═" * len(SEPARATOR))

    # Header
    header = f"{'Location / Criteria':<{COL_LABEL}}"
    for site in SITES:
        header += f"{site.capitalize():>{COL_SITE}}"
    header += f"{'Total':>{COL_TOTAL}} {'Time':>{COL_TIME}}"
    print(header)
    print(SEPARATOR)

    for r in results:
        label = r["label"][:COL_LABEL - 2]
        status = "✓" if r["total"] > 0 else "✗"
        row = f"{status} {label:<{COL_LABEL - 2}}"
        for site in SITES:
            row += f"{fmt_count(r['by_site'].get(site, -1)):>{COL_SITE}}"
        row += f"{r['total']:>{COL_TOTAL}} {fmt_time(r['case_elapsed']):>{COL_TIME}}"
        print(row)

    print("═" * len(SEPARATOR))

    # Warnings
    all_warnings = [w for r in results for w in r.get("warnings", [])]
    if all_warnings:
        print(f"\n⚠  {len(all_warnings)} warning(s):")
        for w in all_warnings:
            print(f"   • {w}")

    # Failures
    failures = [r for r in results if r["total"] == 0]
    if failures:
        print(f"\n✗  {len(failures)} case(s) returned 0 results:")
        for r in failures:
            print(f"   • {r['label']}")
        print()
    else:
        print(f"\n✓  All {len(results)} cases returned results.\n")

    # Per-site timing breakdown
    print("Site timing breakdown (wall clock per search, not summed):")
    site_header = f"{'Location / Criteria':<{COL_LABEL}}"
    for site in SITES:
        site_header += f"{site.capitalize():>{COL_SITE}}"
    print(site_header)
    print(SEPARATOR)
    for r in results:
        label = r["label"][:COL_LABEL - 2]
        row = f"  {label:<{COL_LABEL - 2}}"
        for site in SITES:
            t = r["site_timings"].get(site, 0.0)
            row += f"{fmt_time(t):>{COL_SITE}}"
        print(row)
    print()


# ── Main ──────────────────────────────────────────────────────────────────────


def main() -> int:
    if not SCRIPT.exists():
        print(
            f"Error: {SCRIPT} not found.\n"
            "Run this script from the dashboard directory:\n"
            "  cd dashboard && python scripts/smoke_test_locations.py",
            file=sys.stderr,
        )
        return 1

    mode_note = " [QUICK — LinkedIn single-run]" if QUICK_MODE else ""
    print("JobDash Location Smoke Test")
    print(f"Search term : {SEARCH_TERM}")
    print(f"Hours old   : {HOURS_OLD}  │  Results per site: {RESULTS_WANTED}")
    print(f"Sites       : {', '.join(SITES)}{mode_note}")
    print(f"Test cases  : {len(TEST_CASES)}")
    print(f"LinkedIn    : {LINKEDIN_MIN_RUNS}–{LINKEDIN_MAX_RUNS} run(s) per case")
    if INTER_CASE_DELAY:
        print(f"Delay       : {INTER_CASE_DELAY}s between cases")
    print()

    all_results: list[dict] = []
    grand_start = time.perf_counter()

    for i, case in enumerate(TEST_CASES, 1):
        label = case["label"]
        print(f"[{i:2}/{len(TEST_CASES)}] {label}...", end=" ", flush=True)
        result = run_test_case(case)
        all_results.append(result)

        status = "✓" if result["total"] > 0 else "✗"
        by_site_str = "  ".join(
            f"{s[0].upper()}{s[1:3]}:{fmt_count(result['by_site'].get(s, -1))}"
            for s in SITES
        )
        print(
            f"{status} {result['total']} results  "
            f"({by_site_str})  "
            f"{fmt_time(result['case_elapsed'])}"
        )

        if result["warnings"]:
            for w in result["warnings"]:
                print(f"      ⚠  {w}")

        if INTER_CASE_DELAY and i < len(TEST_CASES):
            for remaining in range(INTER_CASE_DELAY, 0, -1):
                print(f"\r  (next case in {remaining}s…) ", end="", flush=True)
                time.sleep(1)
            print("\r" + " " * 24 + "\r", end="", flush=True)  # clear the line

    grand_elapsed = time.perf_counter() - grand_start
    print(f"\nTotal run time: {fmt_time(grand_elapsed)}")

    print_summary(all_results)

    failures = [r for r in all_results if r["total"] == 0]
    return 1 if failures else 0


if __name__ == "__main__":
    raise SystemExit(main())
