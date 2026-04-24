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


