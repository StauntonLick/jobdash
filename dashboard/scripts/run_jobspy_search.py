import json
import sys
from typing import Any

import pandas as pd
from jobspy import scrape_jobs

from jobspy_patches import apply_glassdoor_partial_error_patch


apply_glassdoor_partial_error_patch()


def _sanitize_value(value: Any) -> Any:
    if isinstance(value, float) and pd.isna(value):
        return None
    return value


def main() -> int:
    try:
        raw = sys.stdin.read().strip()
        criteria = json.loads(raw) if raw else {}

        jobs = scrape_jobs(**criteria)
        sanitized = jobs.where(pd.notna(jobs), None)
        records = [
            {key: _sanitize_value(val) for key, val in row.items()}
            for row in sanitized.to_dict(orient="records")
        ]

        # JobSpy can include date/datetime objects; serialize non-JSON types safely.
        print(json.dumps({"results": records, "count": len(records)}, default=str))
        return 0
    except Exception as exc:
        print(json.dumps({"error": str(exc)}))
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
