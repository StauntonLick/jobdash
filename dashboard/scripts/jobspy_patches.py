from __future__ import annotations

import os
import time
from typing import Any
from urllib.parse import quote


def apply_glassdoor_location_lookup_patch() -> None:
    """
    Fix two bugs in Glassdoor._get_location that cause HTTP 400 for US city searches.

    Bug 1 — double-slash URL:
        base_url is stored as "https://www.glassdoor.com/" (trailing slash), and
        _get_location constructs f"{self.base_url}/findPopularLocationAjax.htm",
        which produces "https://www.glassdoor.com//findPopularLocationAjax.htm".
        The TLS client used by Glassdoor does not normalise // in URL paths the
        way browsers do, so the double slash is sent literally. www.glassdoor.com
        returns 400 for this path; non-US Glassdoor endpoints are more lenient.

    Bug 2 — no session warmup:
        The existing flow visits only /Job/computer-science-jobs.htm to get the
        CSRF token, but skips the homepage. www.glassdoor.com requires cookies
        set by the homepage before the location-lookup AJAX endpoint will respond
        with 200. Non-US endpoints are again more lenient on this.

    The patch:
        • Strips the trailing slash from base_url before constructing the URL.
        • Visits the Glassdoor homepage to seed session cookies before the first
          location lookup on each Glassdoor instance.
        • Retries up to 2 times on non-200 / non-429 responses, with a brief
          delay and a fresh homepage visit between attempts.
        • URL-encodes the location term explicitly (requests already does this,
          but being explicit avoids any tls_client edge-cases).
    """
    try:
        import jobspy.glassdoor as glassdoor_module
        from jobspy.glassdoor import Glassdoor
    except Exception:
        return

    if getattr(Glassdoor, "_location_lookup_patch_applied", False):
        return

    log = glassdoor_module.log

    def _patched_get_location(
        self: Any, location: str, is_remote: bool
    ) -> tuple[Any, Any]:
        if not location or is_remote:
            return "11047", "STATE"  # unchanged — remote/no-location fast-path

        base = self.base_url.rstrip("/")  # fix Bug 1: strip trailing slash
        url = f"{base}/findPopularLocationAjax.htm?maxLocationsToReturn=10&term={quote(location)}"

        for attempt in range(3):
            # Bug 2 fix: seed cookies with a homepage visit on first attempt and
            # each retry.  A real browser always loads the root page first.
            try:
                self.session.get(f"{base}/", timeout=10)
            except Exception:
                pass  # don't abort — proceed and let the real request fail loudly

            if attempt > 0:
                delay = attempt * 3  # 3 s, 6 s
                log.info(f"Glassdoor location lookup retry {attempt}/2 in {delay}s")
                time.sleep(delay)

            try:
                res = self.session.get(url)
            except Exception as exc:
                log.error(f"Glassdoor location lookup request error: {exc}")
                if attempt == 2:
                    return None, None
                continue

            if res.status_code == 200:
                try:
                    items = res.json()
                except Exception:
                    log.error("Glassdoor: location response was not valid JSON")
                    if attempt == 2:
                        return None, None
                    continue

                if not items:
                    raise ValueError(f"Location '{location}' not found on Glassdoor")

                raw_type = items[0]["locationType"]
                location_type = {"C": "CITY", "S": "STATE", "N": "COUNTRY"}.get(
                    raw_type, raw_type
                )
                return int(items[0]["locationId"]), location_type

            elif res.status_code == 429:
                log.error("429 Response — Glassdoor: too many requests")
                return None, None

            else:
                log.warning(
                    f"Glassdoor location lookup: HTTP {res.status_code} "
                    f"(attempt {attempt + 1}/3)"
                )

        log.error("Glassdoor: location not parsed after 3 attempts")
        return None, None

    Glassdoor._get_location = _patched_get_location  # type: ignore[assignment]
    Glassdoor._location_lookup_patch_applied = True


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


def apply_indeed_structured_work_mode_patch() -> None:
    """Patch Indeed scraping to derive remote status from structured work-mode attributes."""
    try:
        import jobspy.indeed as indeed_module
        import jobspy.indeed.util as indeed_util_module
        from jobspy.indeed import Indeed
    except Exception:
        return

    if getattr(Indeed, "_structured_work_mode_patch_applied", False):
        return

    remote_key = "DSQF7"
    hybrid_key = "PAXZC"
    in_person_key = "SWG7T"

    def _infer_structured_work_mode(job: dict[str, Any]) -> str | None:
        attributes = job.get("attributes") or []
        keys = {
            str(attribute.get("key", "")).strip().upper()
            for attribute in attributes
            if isinstance(attribute, dict)
        }

        if hybrid_key in keys:
            return "hybrid"
        if remote_key in keys:
            return "remote"
        if in_person_key in keys:
            return "in_person"
        return None

    def _is_job_remote_from_structured_fields(job: dict[str, Any], description: str) -> bool:
        del description
        return _infer_structured_work_mode(job) == "remote"

    indeed_util_module.is_job_remote = _is_job_remote_from_structured_fields
    indeed_module.is_job_remote = _is_job_remote_from_structured_fields
    Indeed._structured_work_mode_patch_applied = True


def apply_linkedin_pagination_patch() -> None:
    """
    Fix a pagination offset bug in JobSpy's LinkedIn scraper.

    The original code advances the result window with `start += len(job_list)`,
    where job_list is the *cumulative* total of all results so far.  This causes
    the offset to grow exponentially (0, 10, 30, 60 …) instead of linearly
    (0, 10, 20, 30 …), skipping entire pages of results.

    The fix is to advance by the number of job cards returned on the *current*
    page (`len(job_cards)`) rather than the running total.
    """
    try:
        from datetime import date, datetime
        import math
        import random
        import time
        from typing import Optional

        from bs4 import BeautifulSoup

        import jobspy.linkedin as linkedin_module
        from jobspy.linkedin import LinkedIn
        from jobspy.linkedin.util import job_type_code
        from jobspy.model import JobPost, JobResponse, ScraperInput
        from jobspy.linkedin.constant import headers
        from jobspy.exception import LinkedInException
    except Exception:
        return

    if getattr(LinkedIn, "_pagination_patch_applied", False):
        return

    # JobSpy defaults to a 3-7 second page delay on LinkedIn, which dominates
    # refresh time for larger result targets. Keep a smaller jitter by default
    # and allow override via env vars.
    linked_in_delay = float(os.getenv("JOBDASH_LINKEDIN_DELAY_SECONDS", "0.5"))
    linked_in_band_delay = float(os.getenv("JOBDASH_LINKEDIN_BAND_DELAY_SECONDS", "1.0"))
    LinkedIn.delay = max(0.0, linked_in_delay)
    LinkedIn.band_delay = max(0.0, linked_in_band_delay)

    original_process_job = LinkedIn._process_job

    def _extract_linkedin_date_posted(job_card: Any) -> date | None:
        metadata_card = job_card.find("div", class_="base-search-card__metadata")
        if metadata_card is None:
            return None

        # LinkedIn uses both the legacy and "new" listdate class names.
        datetime_tag = metadata_card.find("time", class_="job-search-card__listdate")
        if datetime_tag is None:
            datetime_tag = metadata_card.find("time", class_="job-search-card__listdate--new")
        if datetime_tag is None:
            datetime_tag = metadata_card.find("time", attrs={"datetime": True})

        if datetime_tag is None or "datetime" not in datetime_tag.attrs:
            return None

        datetime_str = str(datetime_tag["datetime"]).strip()
        if not datetime_str:
            return None

        for fmt in ("%Y-%m-%d", "%Y-%m-%dT%H:%M:%S", "%Y-%m-%dT%H:%M:%S%z"):
            try:
                return datetime.strptime(datetime_str, fmt).date()
            except ValueError:
                continue

        try:
            parsed = datetime.fromisoformat(datetime_str.replace("Z", "+00:00"))
            return parsed.date()
        except ValueError:
            return None

    def _patched_process_job(
        self: Any, job_card: Any, job_id: str, full_descr: bool
    ) -> Any:
        job_post = original_process_job(self, job_card, job_id, full_descr)
        if job_post is None:
            return None

        if getattr(job_post, "date_posted", None) is None:
            fallback_date = _extract_linkedin_date_posted(job_card)
            if fallback_date is not None:
                job_post.date_posted = fallback_date

        return job_post

    LinkedIn._process_job = _patched_process_job  # type: ignore[assignment]

    def _patched_scrape(self: Any, scraper_input: ScraperInput) -> JobResponse:
        self.scraper_input = scraper_input
        job_list: list[JobPost] = []
        seen_ids: set[str] = set()
        start = scraper_input.offset // 10 * 10 if scraper_input.offset else 0
        request_count = 0
        seconds_old = (
            scraper_input.hours_old * 3600 if scraper_input.hours_old else None
        )
        continue_search = (
            lambda: len(job_list) < scraper_input.results_wanted and start < 1000
        )
        while continue_search():
            request_count += 1
            linkedin_module.log.info(
                f"search page: {request_count} / {math.ceil(scraper_input.results_wanted / 10)}"
            )
            params = {
                "keywords": scraper_input.search_term,
                "location": scraper_input.location,
                "distance": scraper_input.distance,
                "f_WT": 2 if scraper_input.is_remote else None,
                "f_JT": (
                    job_type_code(scraper_input.job_type)
                    if scraper_input.job_type
                    else None
                ),
                "pageNum": 0,
                "start": start,
                "f_AL": "true" if scraper_input.easy_apply else None,
                "f_C": (
                    ",".join(map(str, scraper_input.linkedin_company_ids))
                    if scraper_input.linkedin_company_ids
                    else None
                ),
            }
            if seconds_old is not None:
                params["f_TPR"] = f"r{seconds_old}"

            params = {k: v for k, v in params.items() if v is not None}
            try:
                response = self.session.get(
                    f"{self.base_url}/jobs-guest/jobs/api/seeMoreJobPostings/search?",
                    params=params,
                    timeout=10,
                )
                if response.status_code not in range(200, 400):
                    if response.status_code == 429:
                        err = "429 Response - Blocked by LinkedIn for too many requests"
                    else:
                        err = f"LinkedIn response status code {response.status_code}"
                        err += f" - {response.text}"
                    linkedin_module.log.error(err)
                    return JobResponse(jobs=job_list)
            except Exception as e:
                if "Proxy responded with" in str(e):
                    linkedin_module.log.error("LinkedIn: Bad proxy")
                else:
                    linkedin_module.log.error(f"LinkedIn: {str(e)}")
                return JobResponse(jobs=job_list)

            soup = BeautifulSoup(response.text, "html.parser")
            job_cards = soup.find_all("div", class_="base-search-card")
            if len(job_cards) == 0:
                return JobResponse(jobs=job_list)

            for job_card in job_cards:
                href_tag = job_card.find("a", class_="base-card__full-link")
                if href_tag and "href" in href_tag.attrs:
                    href = href_tag.attrs["href"].split("?")[0]
                    job_id = href.split("-")[-1]

                    if job_id in seen_ids:
                        continue
                    seen_ids.add(job_id)

                    try:
                        fetch_desc = scraper_input.linkedin_fetch_description
                        job_post = self._process_job(job_card, job_id, fetch_desc)
                        if job_post:
                            job_list.append(job_post)
                        if not continue_search():
                            break
                    except Exception as e:
                        raise LinkedInException(str(e))

            if continue_search():
                time.sleep(random.uniform(self.delay, self.delay + self.band_delay))
                # FIX: advance by this page's card count, not the cumulative total.
                # The original `start += len(job_list)` grows exponentially
                # (0, 10, 30, 60 …), skipping entire pages of results.
                start += len(job_cards)

        job_list = job_list[: scraper_input.results_wanted]
        return JobResponse(jobs=job_list)

    LinkedIn.scrape = _patched_scrape  # type: ignore[method-assign]
    LinkedIn._pagination_patch_applied = True
