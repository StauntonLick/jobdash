# JobDash History

This file is a dated running history of project changes and key decisions discussed in the repository.

## 2026-05-18

- Fixed an age fallback regression in `dashboard/src/app/page.tsx` where date-only `date_posted` rows were always using `first_seen_at`, making many rows appear as ~1 hour old.
- Updated age fallback hierarchy to:
  1) JobSpy timestamp when present in `date_posted`
  2) Combined timestamp using JobSpy date (`date_posted`) + retrieval time (`first_seen_at`)
  3) Raw `first_seen_at` timestamp as final fallback

- Fixed age calculation precision for newly found jobs in `dashboard/src/lib/jobspy-service.ts` and `dashboard/src/app/page.tsx`:
  - Added persistent `first_seen_at` timestamps during result merging so each job tracks when JobDash first observed it.
  - Updated age rendering and result sorting to use `first_seen_at` when `date_posted` is date-only (no time component), while continuing to use `date_posted` when a real timestamp is present.
  - This avoids unrealistic "all jobs are N hours old" clusters caused by midnight-normalized date-only `date_posted` values.

- Updated LinkedIn remote fallback labeling so rows accepted via fallback with empty `location` are tagged with `work_mode: "Likely Remote"` in `dashboard/src/lib/jobspy-service.ts`, and the sidebar now renders this as `Likely Remote` in `dashboard/src/app/page.tsx` instead of defaulting those rows to `In-Person`.

- Fixed production deployment failure caused by stale deploy path instructions and strict TypeScript inference in `dashboard/src/lib/jobspy-service.ts`:
  - Correct deploy working directory confirmed as `/Users/jonny/Coding Projects/JobDash/dashboard` (not the old `/Users/jonny/Documents/...` path).
  - Resolved build error `Property 'job_url' does not exist on type '{ site: string; }'` by explicitly typing `combined` as `Record<string, unknown>` in `mergeResults`.
  - Deployed successfully using `npm run build` and `npx pm2 restart jobdash`; verified PM2 process `jobdash` is `online`.

- Implemented bounded per-search site parallelism in `dashboard/src/lib/jobspy-service.ts` for resilient refreshes: site scrapes now run with a configurable concurrency cap (`JOBDASH_SITE_PARALLELISM`, default `2`) instead of strict serial execution, while preserving existing LinkedIn multi-pass and Glassdoor retry behavior.

- Refactored search refresh behavior in `dashboard/src/lib/jobspy-service.ts` to improve reliability and consistency across all searches:
  - Refreshes now run per site with an incremental `hours_old` window based on time since last refresh plus a 4-hour overlap.
  - Glassdoor now retries when it returns zero results only if prior cached runs contained Glassdoor rows, with up to 4 retry attempts and progressive backoff.
  - LinkedIn now always runs two passes, then conditionally runs a third pass only when the previous pass added new unique jobs (attempt limits are defined as constants for easy tuning).
  - Cache writes now upsert new rows into existing cached rows (duplicate-aware merge) instead of replacing the entire search cache on each refresh.
  - Added strict 14-day retention for active cache entries based on `date_posted`; older/invalid-date rows are moved into per-search archive files under `dashboard/.cache/searches-archive/`.

- Diagnosed missing LinkedIn `date_posted` values in dashboard rows to a JobSpy parser selector mismatch: some LinkedIn cards now use `time.job-search-card__listdate--new` instead of `time.job-search-card__listdate`, causing parsed dates to be dropped for those cards.
- Updated `dashboard/scripts/jobspy_patches.py` in `apply_linkedin_pagination_patch()` to also patch `LinkedIn._process_job` with a date fallback extractor that checks both LinkedIn time class variants and then falls back to any `time[datetime]` node in the metadata card.
- Added robust datetime parsing fallbacks for LinkedIn `datetime` attribute formats (`%Y-%m-%d`, common ISO datetime variants, and `fromisoformat` with `Z` handling), then backfills `job_post.date_posted` only when the original parser returned `None`.

## 2026-05-16

## 2026-05-15

- Diagnosed production refresh hangs to long-running `run_jobspy_search.py` child processes spawned by `dashboard/src/lib/jobspy-service.ts` with no hard timeout; observed multiple workers running for 5-50+ minutes and stale orphan workers from previous interrupted refreshes.
- Added a hard timeout guard in `dashboard/src/lib/jobspy-service.ts` for Python search workers (`JOBDASH_PYTHON_SEARCH_TIMEOUT_MS`, default `180000`), with `SIGTERM` then `SIGKILL` fallback cleanup to prevent indefinite API hangs and worker buildup.

## 2026-05-14

- Built the dashboard production bundle with `npm run build` in `dashboard/`, started it via `npm run start:prod`, and verified it serves successfully on `http://localhost:3001` (HTTP 200).
- Adjusted the desktop filter-summary footer placement in `dashboard/src/app/page.tsx` so it is inside the table `ScrollArea` content (appears at the end of the table scroll) rather than outside the scroll container.
- Added a per-search footer line under each desktop results table in `dashboard/src/app/page.tsx` showing `[y] jobs hidden by filters` (muted semantic color, italic body style), where `y = rawResultCount - resultCount`.
- Updated `dashboard/src/lib/jobspy-service.ts` and `dashboard/src/app/page.tsx` so the refresh button hover hint now shows `Last updated dd/mm/yyyy. [x] jobs found, [y] after filters applied.` where `[x]` is the raw JobSpy total across searches/sites and `[y]` is the post-filter total shown in the dashboard.
- Switched `linkedin_fetch_description` to `False` in `CONFIG.MD` so search refreshes no longer block on per-job LinkedIn description fetches.
- Added a permanent job-description cache at `.cache/job-descriptions.json` in `dashboard/src/lib/jobspy-service.ts` and now hydrate result rows from that cache before returning data.
- Added a background description queue in `dashboard/src/lib/jobspy-service.ts` that begins after JobDash filters/dedupe are applied, so only user-visible jobs are fetched and cached.
- Added `dashboard/scripts/fetch_job_description.py` to fetch and parse job descriptions from job posting HTML by site selector with safe fallbacks.
- Added `dashboard/src/app/api/job-descriptions/route.ts` for on-demand sidebar description requests; it reuses the same permanent cache and fetcher.
- Updated `dashboard/src/app/page.tsx` sidebar behavior to fetch missing descriptions on open and show a centered muted loading spinner while the request is in progress.
- Updated `dashboard/scripts/fetch_job_description.py` so Glassdoor descriptions are fetched via Glassdoor's GraphQL `JobDetailQuery` endpoint (matching JobSpy's full-description approach) instead of relying on teaser text from public page HTML metadata.
- Updated `dashboard/scripts/fetch_job_description.py` so LinkedIn descriptions are extracted from `.show-more-less-html__markup`, converted to markdown, and returned with structural formatting preserved (matching JobSpy's markdown pipeline).
- Cleared the persisted job description cache by resetting `dashboard/.cache/job-descriptions.json` to `{}` so stale truncated/plain descriptions are removed.

## 2026-05-11

- Updated the refresh-button tooltip format in `dashboard/src/app/page.tsx` to include time after the date: `Last updated dd/mm/yyyy at hh:mm. [x] jobs found, [y] after filters applied.`
- Separated dev and production server ports: dev server runs on port 3000 (default `next dev`), production server (pm2) now runs on port 3001 via a new `start:prod` script in `package.json`. pm2 was re-registered to use `npm run start:prod`. Updated `next.config.ts` to add `100.*.*.*` to `allowedDevOrigins` so Tailscale-connected devices can access the dev server without being blocked by Next.js's cross-origin protection.
- Updated the sidebar job-details header in `dashboard/src/app/page.tsx` to truncate displayed location values at the first comma (for example, `Livingston, Scotland` now displays as `Livingston`).
- Set up pm2 to run the Next.js app as a persistent background service that auto-starts at login. The production build is served at `http://localhost:3000`. Use `pm2 stop jobdash` / `pm2 start jobdash` to control it, and rebuild with `npm run build` in `dashboard/` when you want the always-on version to reflect latest changes.
- Added a mobile-specific result list in `dashboard/src/app/page.tsx` that replaces the data table on small screens (`md` breakpoint). Each entry is a two-column card: left side shows the job title (H3, primary colour) and a metadata row with company, industry, and age separated by 2 px dot separators; right side shows the status dropdown with its chevron permanently visible. The list has `p-4` padding and `my-2` dividers between entries. Tapping the title opens the sidebar as normal.

## 2026-05-09

- Restored `linkedin_fetch_description=True` in `CONFIG.MD` so LinkedIn listings fetch full descriptions again in the sidebar.
- Updated sidebar header controls in `dashboard/src/app/page.tsx`: status trigger now stays white across all status values, its chevron is always visible, and the `Apply` action now includes an external-link icon to the right of the label.
- Fixed a regression in `dashboard/src/app/page.tsx` by scoping the white status trigger and always-visible chevron to the sidebar header only; table status controls use per-status colors again.

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

## 2026-05-05

### LinkedIn pagination bug — investigation and fix

- Investigated why a manual LinkedIn search for "UX Designer", remote UK, posted within 7 days returned 54 results, while JobSpy's equivalent query returned only 30.
- Traced through the installed JobSpy source (`python-jobspy 1.1.82`) to identify root causes.

**Findings:**

- **Posting time filter (f_TPR) is applied correctly.** JobSpy computes `hours_old × 3600` to get seconds and sets `f_TPR=r{seconds_old}` on the LinkedIn request. For `hours_old=168`, this produces `f_TPR=r604800` — identical to the manual URL.
- **GeoID is not used.** LinkedIn's guest API supports a `geoId` parameter (the manual search uses `geoId=101165590` for the UK). JobSpy does not resolve or send `geoId`; it passes the raw `location` string as plain text instead. This may reduce search precision compared to a logged-in browser session but is not a fixable gap without patching upstream.
- **"UK" is not confused with Ukraine.** `Country.from_string()` uses exact token matching against comma-separated aliases. `UK` is listed as `"uk,united kingdom"` and `UKRAINE` as `"ukraine"`, so there is no collision.
- **`country_indeed` is irrelevant for LinkedIn scoping.** The LinkedIn scraper hardcodes `self.country = "worldwide"` and never reads `scraper_input.country` when constructing request parameters. Country scoping relies entirely on the `location` text string.
- **Confirmed pagination offset bug in `LinkedIn.scrape`.** The result window advances with `start += len(job_list)`, where `job_list` is the cumulative total of all results collected so far. This causes exponential drift: `0, 10, 30, 60 …` instead of the correct linear `0, 10, 20, 30 …`, skipping entire pages of LinkedIn results after page 2.

**Fix — LinkedIn pagination patch** (`dashboard/scripts/jobspy_patches.py`, `dashboard/scripts/run_jobspy_search.py`):

- Added `apply_linkedin_pagination_patch()` to `jobspy_patches.py`, following the same monkey-patch guard pattern as the existing Glassdoor patch.
- The patched `scrape` method is identical to the original except for one line: `start += len(job_list)` → `start += len(job_cards)`, which advances by the current page's card count instead of the running total.
- Called `apply_linkedin_pagination_patch()` in `run_jobspy_search.py` alongside the existing Glassdoor patch.
- Result: the same UX Designer remote UK 7-day query returned **41 jobs** after the fix, up from **30** — recovering 11 previously skipped results.
- Decision: the remaining gap vs. the 54 manual results is expected. LinkedIn's unauthenticated guest API surfaces fewer results than a logged-in browser session; this is a fundamental limitation of the scraping approach and not addressable within the project.

### Search performance — parallel site scraping and LinkedIn throttle reduction

**Problem:** Refreshing a single search tab was taking over 80 seconds.

**Root causes identified:**

- **LinkedIn inter-page throttle.** JobSpy's LinkedIn scraper sleeps 3–7 seconds between every page of results. At 100 results wanted, this means ~10 pages × up to 7s = potentially 70s for LinkedIn alone.
- **Sequential site execution inside the Python runner.** Although JobSpy's own `scrape_jobs()` uses a thread pool internally, our wrapper called it once with all three sites, which does not expose the right parallelism surface for controlling per-site result budgets.
- **Over-large result target.** `results_wanted=100` was requested per site but the Edinburgh UX query is source-limited around ~50 results anyway, so the extra pages were wasted wait time.

**Changes made (`dashboard/scripts/run_jobspy_search.py`, `dashboard/scripts/jobspy_patches.py`):**

- **LinkedIn delay tuning** — reduced default page delay from 3–7s to 1–2.5s (1s base, 1.5s band). Values are env-configurable via `JOBDASH_LINKEDIN_DELAY_SECONDS` / `JOBDASH_LINKEDIN_BAND_DELAY_SECONDS`.
- **Explicit per-site parallel execution** — when multiple sites are configured, the runner now spawns one thread per site (capped at 4), each calling `scrape_jobs` for a single site. This makes the total wall time roughly equal to the slowest individual site rather than their sum, and tolerates partial failures without losing results from other sites.
- **Added runtime timing metadata** — the runner now includes `duration_seconds` in its JSON output for profiling.
- **Set `results_wanted` to 60 per site** in `CONFIG.MD` — benchmarking showed result counts plateau at ~52 for the Edinburgh query regardless of cap, so 60 per site was the sweet spot with no missed results.

**Benchmark results (Edinburgh UX, 3 sites, hours_old=336):**

| `results_wanted` per site | Returned count | Duration |
|---|---|---|
| 60 | 52 | ~11.6s |
| 80 | 52 | ~11.8s |
| 100 | 52 | ~12.9s |
| 120 | 52 | ~12.5s |

- Decision: count plateaus at 52, so the query is source-limited. Setting 60 per site retains full coverage with slightly less overhead.
- Decision: `results_wanted=60` is now the default in `CONFIG.MD`.
- Overall improvement: refresh time reduced from ~80s to ~12s.

## 2026-05-07

### Figma v1 design sync, implementation pass, and manual spacing handoff

- Connected to Figma MCP and pulled `Design (v1 Final)` context for implementation reference.
- Reworked dashboard visual styling to match the new design direction:
  - Updated `dashboard/src/app/globals.css` semantic colors to the new palette (navy/cream/orange system).
  - Switched root HTML out of forced dark mode in `dashboard/src/app/layout.tsx` so the page can render with light backgrounds as intended.
  - Refactored `dashboard/src/app/page.tsx` structure and utility classes to match the Figma-style composition (header, tabs, and table spacing/containers).
  - Updated status color mapping in `dashboard/src/app/page.tsx` to align with the new status palette.
- Added design token infrastructure for Figma round-trip workflows:
  - Added `dashboard/src/design/tokens/jobdash.tokens.json` as a token source file.
  - Added `dashboard/scripts/export_figma_csv.mjs` token exporter.
  - Generated `dashboard/src/design/tokens/jobdash.figma.token-importer.no-header.csv` from token definitions.
- Iterated on layout bugs requested during review:
  - Header-only blue region vs cream body behavior.
  - Tabs overflow/height and left alignment behavior.
  - Table container height and scroll behavior.
- During later comparison passes, Figma MCP screenshot calls hit plan rate limits; validation continued using previously fetched design context plus live browser snapshots.
- Final workflow decision for this session: pause automatic pixel-tuning and hand off spacing polish for manual adjustment, with exact file/line guidance provided for editing.

### Manual dashboard polish, local font integration, and table refinements

- Added stable `id` attributes across the main dashboard layout in `dashboard/src/app/page.tsx` to make header, tabs, content, and per-search table sections easier to inspect manually in browser devtools.
- Investigated Tailwind inspector behavior and confirmed the app only serves generated utilities that appear in source files; manual Firefox inspector class edits do not work for utilities that have not been compiled.
- Refined the dashboard height/scroll layout so the results area becomes the primary scroll region instead of the full page, and removed the shared table wrapper's extra overflow container so sticky header behavior can work against the intended scroll viewport.
- Updated shared UI styling for the latest design pass:
  - Inactive tab hover state now uses the primary color in `dashboard/src/components/ui/tabs.tsx`.
  - Table rows no longer show hover/selected state styling in `dashboard/src/components/ui/table.tsx`.
  - Status color mapping in `dashboard/src/app/page.tsx` now uses `#172542` for `New` and `#C7C3BE` for `Skipped`, with other status colors unchanged.
- Switched typography to `Poppins` for body text and a local `Rubik One` font for headings:
  - Added `dashboard/src/app/fonts/RubikOne-Regular.ttf` and loaded it with `next/font/local` in `dashboard/src/app/layout.tsx`.
  - Updated `dashboard/src/app/globals.css` font variables so `font-sans` resolves to `Poppins` and `font-heading` resolves to the local Rubik One font.
  - Decision: serve Rubik One locally because it is not available in Google Fonts, instead of approximating it with a different hosted family.
- Reworked header controls in `dashboard/src/app/page.tsx`:
  - Moved the refresh button onto the same row as the tab bar and aligned it to the right.
  - Removed the visible `Last updated` label and exposed it as the button's hover tooltip.
  - Shortened the button label to `Refresh`.
  - Changed the refresh button background to white at 20% opacity.
- Tightened results-table structure and content presentation in `dashboard/src/app/page.tsx`:
  - Removed the `location` column from the visible results table.
  - Increased the `title` column width/max-width from `240px` to `480px`.
  - Constrained the `company` column to `240px` max-width and added truncation with ellipsis plus hover title text.
  - Applied `font-bold` to the status dropdown trigger in the status column.

  ## 2026-05-09

  ### Results table UX cleanup

  - Added a 6px white circular indicator to the right of job titles for rows whose status is `New` in `dashboard/src/app/page.tsx`.
  - Decision: keep the new-job marker lightweight and inline with the title so it reads as a subtle status cue rather than a separate badge.
  - Removed sticky header behavior from the results table and made the header static.
  - Moved scrolling so only the `search-results-body` section scrolls, preventing the scrollbar from running behind the header.
  - Decision: preserve header/body column alignment with a split static-header + scrollable-body table layout instead of relying on sticky positioning.

  ### Figma token re-import sync

  - Updated `dashboard/src/app/globals.css` so `:root` now sources color variables from the latest re-exported token set.
  - Kept existing app-facing semantic variables (`--primary`, `--secondary`, `--card`, etc.) as aliases to the imported Figma token variables to preserve Tailwind utility usage.
  - Updated secondary alias mapping to use semantic tokens directly: `--secondary -> --color-semantic-secondary` and `--secondary-foreground -> --color-semantic-secondary-foreground`.

  ### Tailwind line-height token wiring

  - Added Tailwind `leading-*` theme variables in `dashboard/src/app/globals.css` that map to the imported Figma line-height tokens so app typography can use the re-exported values directly.

### Temporary token import cleanup

- Removed remaining references to the temporary token-import stylesheet from repository content.

  ### Sidebar posting date display update

  - Updated the job details sidebar in `dashboard/src/app/page.tsx` to show the posting date in `dd/mm/yy` format instead of the relative age text (`hours`/`days`).
  - Updated the sidebar header date rendering so missing/invalid posting dates display as empty (no `-`) and the adjacent separator dot is hidden when no date is available.

  ### Tab bar color token fix

  - Fixed the dashboard tab list background class in `dashboard/src/app/page.tsx` by replacing invalid `bg-muted-background` with `bg-muted`.
  - Updated tab trigger colors to restore visible contrast in the header: inactive text now uses `text-foreground/70`, hover uses `bg-secondary` + `text-secondary-foreground`, and active state uses `bg-background` + `text-foreground`.


