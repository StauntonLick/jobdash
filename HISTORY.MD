# JobDash History

This file is a dated running history of project changes and key decisions discussed in the repository.

## 2026-04-22

- Initial commit created the project foundation: `JobDashboard.py`, `jobs.csv`, `CONFIG.MD`, `pyproject.toml`, `poetry.lock`, and base repo config.
- Decision: keep a Python-first data source and config-driven search parameters (captured in `CONFIG.MD`).
- Dashboard source started as a single tracked directory entry (`dashboard`) before being expanded to normal files.
- Dashboard was then tracked as regular files, adding the Next.js app structure, API routes, UI components, scripts, and TypeScript/config files.
- Decision: use a Next.js dashboard frontend with API routes backed by Python search scripts.

## 2026-04-23

- `dashboard/src/app/page.tsx` was updated (commit message: "Some nondescript updates").
- Cleanup/refactor commit updated `dashboard/src/lib/jobspy-service.ts` and `pyproject.toml` while removing an older JobSpy folder setup.
- Major "up and running" pass added root-level `README.md` with setup and Python interpreter resolution behavior.
- Added root-level `AGENTS.md` with coding/design guidance for AI assistance.
- Added `requirements.txt` and `scripts/setup-python.sh` to simplify Python environment setup.
- Added API routes for industries and statuses.
- Added `dashboard/src/lib/industry-labels.ts`.
- Updated dashboard page, Next config, package scripts, and Python service integration logic.
- Decision: Python interpreter selection order is `JOBDASH_PYTHON` -> common venv paths -> `python3` -> `python`, and only interpreters with `jobspy` + `pandas` are accepted.
- Decision: the app should be fork-friendly and easy to start, with clear setup instructions and fallback behavior when Python dependencies are missing.
- Decision: keep code open-source friendly, simple, and readable, with UX quality and controllable UI as priorities.
- Updated Next.js dev config to allow LAN testing via `allowedDevOrigins` so remote-device dashboard access works during development.
- Restored tab-based search navigation and duplicate job-link dropdown behavior in the dashboard UI after a temporary compatibility-oriented change.
- Refactored industry inference in `dashboard/src/lib/jobspy-service.ts` from simple keyword matching to weighted field scoring with confidence thresholds.
- Decision: prioritize company metadata over freeform description text for industry inference to reduce noisy matches.
- Added benefits/perks section filtering in description-based industry matching.
- Fixed a classification bug where newline normalization caused benefits filtering to remove the full description context.
- Added persistent job status tracking (`New`, `Skipped`, `Applied`, `Shortlist`) with a new status column in the table.
- Added server persistence for statuses via `dashboard/src/app/api/job-statuses/route.ts` and `.cache/job-statuses.json`.
- Fixed status dropdown interaction bug by switching menu item handling to click-based selection.
- Added editable industry overrides in the dashboard table so users can correct missing/incorrect industry labels.
- Added server persistence for industry overrides via `dashboard/src/app/api/job-industries/route.ts` and `.cache/job-industry-overrides.json`.
- Added shared industry constants in `dashboard/src/lib/industry-labels.ts` to keep client imports free of server-only dependencies.
- Updated status and industry selectors to a lighter text+chevron control, with chevrons shown only on hover.
- Removed the industry menu's `Remove override` option per UX preference.
- Fixed industry keyword matching in `dashboard/src/lib/jobspy-service.ts` to use whole-word/phrase boundaries instead of raw substring matching (e.g. `unity` was incorrectly matching inside `opportunity`).
- Decision: single-word keywords are matched by splitting the haystack into tokens and checking for exact inclusion; multi-word phrases use boundary-aware regex with a substring fallback if the regex fails.

## 2026-04-24

- Created `HISTORY.MD` to keep a date-stamped, chronological record of project changes and key decisions for future context.
- Decision: continue appending to this file whenever project direction, architecture, or setup behavior changes.

## 2026-04-28

### UK Remote — LinkedIn missing results investigation

- Investigated why four specific LinkedIn jobs visible on linkedin.com were absent from the UK Remote dashboard tab:
  - Remote Product Experience Designer (UX/UI) — 4405217234 (VITA CV)
  - Senior Product Designer — 4404200248 (Tripadvisor)
  - Staff Product Designer — 4297893827 (Deel)
  - Product Designer — 4382100835 (Stravito)

- Root cause analysis identified two separate problems:
  1. **Remote-only filter dropping valid jobs**: Two jobs (4297893827, 4382100835) were returned by JobSpy but had `is_remote: false` despite being remote roles. The dashboard's `presentSearchResult` function discarded any result where `is_remote` was not truthy when the search is configured with `is_remote=True`, which is correct for Indeed but too strict for LinkedIn, which does not reliably set this field.
  2. **Query-level LinkedIn retrieval gaps**: The remaining two jobs (4405217234, 4404200248) were never returned by JobSpy under the broad `"UX" OR "Product Designer" OR "User Researcher"` query. Controlled JobSpy scrape tests showed these are returned by narrower/different queries. This is inherent to LinkedIn's search ranking and pagination cutoffs; JobSpy scrapes search result pages rather than querying by ID.

- Confirmed via direct Python JobSpy scrapes that retrieval is query-sensitive and partially non-deterministic for LinkedIn.

### Changes made

- **LinkedIn remote fallback heuristic** (`dashboard/src/lib/jobspy-service.ts`): Remote-only filter now accepts LinkedIn rows that have `is_remote: false` when any of the following are true:
  - The title, location, description, job_type, or work_from_home_type contains a remote hint keyword (e.g. "remote", "uk remote", "work from home").
  - The location field is blank (very common for LinkedIn remote postings where metadata is sparse).
  - Decision: apply this heuristic only to LinkedIn rows; Indeed/Glassdoor continue to use the strict `is_remote` flag.

- **UK Remote results_wanted increased to 100** (`CONFIG.MD`): Increased from 50 to allow more LinkedIn results per run, improving the chance of catching relevant postings.

- **Optional debug stats mode** (`dashboard/src/lib/jobspy-service.ts`, API routes): API endpoints now accept `?debug=true`. When enabled, each search result includes a `debug` object with per-stage counts:
  - `rawCount`, `remoteFilteredCount`, `titleFilteredCount`, `dedupedCount`, `finalCount`
  - `excludedByRemoteFilter`, `excludedByTitleFilter`, `removedByDedupe`, `includedByLinkedInRemoteFallback`
  - Decision: opt-in via query param only; normal responses are unchanged.

### Combined vs split query investigation

- Ran a controlled benchmark comparing combined `"UX" OR "Product Designer"` vs separate `"UX"` and `"Product Designer"` queries per site, merging and deduping split results by URL:
  - **Glassdoor**: returned 0 results in both modes (API errors in current environment; location parsing failures for `United Kingdom` and `London`).
  - **Indeed**: combined returned 120 unique jobs; split union returned 181 unique jobs (split recovered 61 extra, no combined-only losses).
  - **LinkedIn**: combined returned 120 unique jobs; split union returned 180 unique jobs — but with only 51 in common. Combined had 69 unique jobs that split missed; split had 129 unique jobs that combined missed.
- Decision: LinkedIn result sets are highly query-sensitive and partially non-overlapping between combined and split approaches. A fan-out/merge strategy would improve coverage but both approaches have blind spots. Held for a future session after resolving the UX question around result stability.

### Speed and UX discussion

- Discussed trade-offs of a LinkedIn fan-out strategy (multiple parallel queries, merged + deduped before returning to the user).
- Decision: do not implement a "serve stale cache immediately, update in background" model — this would be jarring UX if results change after the user has already refreshed.
- Fan-out and parallel-per-term scraping to be revisited as a future improvement, contingent on keeping the full merged result returned as a single response per refresh.

### Results table status update

- Added a new `Longlist` option to the results table status selector so jobs can be tracked between `New` and `Shortlist`.
- Updated status text styling so `Longlist` renders in `#FF6600` in the status column.
- Updated shared status validation/storage constants so API persistence accepts `Longlist` end-to-end.
- Decision: keep `Longlist` as a first-class persisted status value (not a UI-only label) to ensure consistency across table controls and API routes.


