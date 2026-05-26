# This file contains rules, guidelines and best practices for Copilot to follow when generating code for JobDash.

## General Guidelines

- This is a personal project and will be shared for free on Github, so all code should be open-source friendly and free of any proprietary or licensed content.
- Ask clarifying questions before following a command if there is key information missing from the prompt or context.
- After carrying out an action, add a record of it to HISTORY.MD. If the change is rolled back, remove that record.
- Always ask questions prior to carrying out an action if you are unsure of the request. Do not guess.

## Design

- I am a designer and am particular about the UI and UX. 
- I want a good level of control over the UI, and the ability to polish (either via the agent or by hand)
- When I ask you to implement a design from Figma, run a check post-implementation against the design file to ensure the build matches the design.
- When implementing small design tweaks do not ask permission before continuing - just implement as per the Figma design.

## Code

- I am not a developer, so I want the code to be as simple and readable as possible, with comments where necessary to explain what is going on.
- Give all high-level HTML elements a human-readable semantic ID to aid with code readability.
- Before implementing any code, provide a brief summary of what you are planning to do.
- Do not update the build (on port 3001) without permission. Only update the dev server (on 3000).
- To update the live build: 
    cd "/Users/jonny/Coding Projects/JobDash/dashboard"
    npm run build
    npx pm2 restart jobdash

## Tests

Playwright E2E tests live in `dashboard/tests/e2e/`. There is one spec file per feature area:

| File | Covers |
|---|---|
| `search-button.spec.ts` | Search button enabled/disabled logic |
| `settings-tray.spec.ts` | Tray open/close triggers and field behaviour |
| `add-location.spec.ts` | Add Location dialog, draft tabs, config save |
| `search-execution.spec.ts` | Triggering searches, API calls, results rendering |
| `debug-reset.spec.ts` | Reset button clearing UI and backend |

Shared mock data and route helpers are in `tests/e2e/helpers.ts`.

**Running tests:**
```bash
cd dashboard
npm test               # headless, all tests
npm run test:ui        # interactive Playwright UI (great for debugging)
npm run test:report    # open the HTML report from the last run
```

**Rules for agents:**
- Whenever a new user-facing feature is added, add corresponding tests to the relevant spec file (or create a new spec file if the feature doesn't fit any existing one).
- Whenever existing behaviour is changed, update or remove any tests that covered the old behaviour and add tests for the new behaviour.
- Tests use API route mocking via `mockAPIs()` in `helpers.ts` — no real Python searches are triggered during a test run. If a new API route is added, add a stub for it in `mockAPIs()`.
- Use the `id` attributes on elements for selectors (e.g. `#button-search`) — they are stable and exist specifically to support testing. Avoid brittle text or class selectors where an id is available.
- New mock data shapes (e.g. a new config field or a new API response) belong in `helpers.ts`, not inline in the spec file, so they can be reused.
