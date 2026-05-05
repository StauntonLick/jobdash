import json
import sys
import time
from concurrent.futures import ThreadPoolExecutor, as_completed
from typing import Any

import pandas as pd
from jobspy import scrape_jobs

from jobspy_patches import apply_glassdoor_partial_error_patch, apply_linkedin_pagination_patch


apply_glassdoor_partial_error_patch()
apply_linkedin_pagination_patch()


def _sanitize_value(value: Any) -> Any:
    if isinstance(value, float) and pd.isna(value):
        return None
    return value


def _normalize_sites(raw_site_name: Any) -> list[str]:
    if raw_site_name is None:
        return []
    if isinstance(raw_site_name, list):
        return [str(site) for site in raw_site_name if str(site).strip()]
    text = str(raw_site_name).strip()
    return [text] if text else []


def main() -> int:
    try:
        started = time.perf_counter()
        raw = sys.stdin.read().strip()
        criteria = json.loads(raw) if raw else {}

        sites = _normalize_sites(criteria.get("site_name"))
        requested_per_site = int(criteria.get("results_wanted", 15) or 15)

        if len(sites) <= 1:
            jobs = scrape_jobs(**criteria)
        else:
            max_workers = min(len(sites), 4)

            def _scrape_single_site(site: str) -> pd.DataFrame:
                site_criteria = {
                    **criteria,
                    "site_name": site,
                    "results_wanted": requested_per_site,
                }
                return scrape_jobs(**site_criteria)

            dataframes: list[pd.DataFrame] = []
            with ThreadPoolExecutor(max_workers=max_workers) as pool:
                futures = {pool.submit(_scrape_single_site, site): site for site in sites}
                for future in as_completed(futures):
                    try:
                        site_df = future.result()
                        if site_df is not None and not site_df.empty:
                            dataframes.append(site_df)
                    except Exception:
                        # Keep partial results from other sites even if one fails.
                        continue

            jobs = pd.concat(dataframes, ignore_index=True) if dataframes else pd.DataFrame()

        sanitized = jobs.where(pd.notna(jobs), None)
        records = [
            {key: _sanitize_value(val) for key, val in row.items()}
            for row in sanitized.to_dict(orient="records")
        ]

        duration_seconds = round(time.perf_counter() - started, 2)

        # JobSpy can include date/datetime objects; serialize non-JSON types safely.
        print(json.dumps({"results": records, "count": len(records), "duration_seconds": duration_seconds}, default=str))
        return 0
    except Exception as exc:
        print(json.dumps({"error": str(exc)}))
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
