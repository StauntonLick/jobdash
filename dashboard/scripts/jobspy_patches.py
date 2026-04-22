from __future__ import annotations

from typing import Any


def apply_glassdoor_partial_error_patch() -> None:
    """Patch Glassdoor scraping to tolerate partial GraphQL errors with valid job data."""
    try:
        import jobspy.glassdoor as glassdoor_module
        from jobspy.glassdoor import Glassdoor
    except Exception:
        return

    if getattr(Glassdoor, "_partial_error_patch_applied", False):
        return

    def _patched_fetch_jobs_page(
        self: Any,
        scraper_input: Any,
        location_id: int,
        location_type: str,
        page_num: int,
        cursor: str | None,
    ) -> tuple[list[Any], str | None]:
        jobs: list[Any] = []
        self.scraper_input = scraper_input
        try:
            payload = self._add_payload(location_id, location_type, page_num, cursor)
            response = self.session.post(
                f"{self.base_url}/graph",
                timeout_seconds=15,
                data=payload,
            )
            if response.status_code != 200:
                exc_msg = f"bad response status code: {response.status_code}"
                raise glassdoor_module.GlassdoorException(exc_msg)

            res_json = response.json()[0]
            if "errors" in res_json:
                has_jobs = bool(
                    res_json.get("data", {}).get("jobListings", {}).get("jobListings")
                )
                if not has_jobs:
                    raise ValueError("Error encountered in API response")
                glassdoor_module.log.warning(
                    "Glassdoor: API returned partial errors; continuing with available jobs"
                )
        except (
            glassdoor_module.requests.exceptions.ReadTimeout,
            glassdoor_module.GlassdoorException,
            ValueError,
            Exception,
        ) as exc:
            glassdoor_module.log.error(f"Glassdoor: {str(exc)}")
            return jobs, None

        jobs_data = res_json["data"]["jobListings"]["jobListings"]

        with glassdoor_module.ThreadPoolExecutor(max_workers=self.jobs_per_page) as executor:
            future_to_job_data = {
                executor.submit(self._process_job, job): job for job in jobs_data
            }
            for future in glassdoor_module.as_completed(future_to_job_data):
                try:
                    job_post = future.result()
                    if job_post:
                        jobs.append(job_post)
                except Exception as exc:
                    raise glassdoor_module.GlassdoorException(
                        f"Glassdoor generated an exception: {exc}"
                    )

        return jobs, glassdoor_module.get_cursor_for_page(
            res_json["data"]["jobListings"]["paginationCursors"], page_num + 1
        )

    Glassdoor._fetch_jobs_page = _patched_fetch_jobs_page  # type: ignore[assignment]
    Glassdoor._partial_error_patch_applied = True
