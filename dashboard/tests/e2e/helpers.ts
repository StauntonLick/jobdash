/**
 * helpers.ts
 *
 * Shared mock data and API-routing helpers used across all E2E test files.
 * All tests intercept the three API routes the app calls on mount so no real
 * Python searches are triggered during the test run.
 */

import type { Page } from "@playwright/test";

// ---------------------------------------------------------------------------
// Mock data
// ---------------------------------------------------------------------------

export const EMPTY_CONFIG = {
  keywords: [],
  sites: ["linkedin", "indeed", "glassdoor"],
  daysOld: 14,
  resultsWanted: 60,
  titleIncludes: [],
  titleExcludes: [],
  employerBlacklist: [],
  locations: [],
};

export const CONFIG_WITH_KEYWORD = {
  ...EMPTY_CONFIG,
  keywords: ["UX Designer"],
};

export const LOCATION_EDINBURGH = {
  id: "loc-1",
  type: "hybrid" as const,
  label: "Edinburgh",
  city: "Edinburgh",
  radiusKm: 30,
  country: "UK",
};

export const CONFIG_WITH_BOTH = {
  ...EMPTY_CONFIG,
  keywords: ["UX Designer"],
  locations: [LOCATION_EDINBURGH],
};

/** A search that returned no results — normal after a fresh search. */
export const MOCK_SEARCH_EMPTY = {
  slug: "edinburgh",
  title: "Edinburgh",
  criteria: { site_name: ["linkedin"], search_term: '"UX Designer"', hours_old: 336 },
  results: [],
  rawResultCount: 0,
  resultCount: 0,
  lastUpdated: new Date().toISOString(),
};

/** A job row representative enough to test table rendering. */
export const MOCK_JOB_ROW = {
  title: "Senior UX Designer",
  company: "Acme Corp",
  status_key: "senior ux designer::acme corp",
  job_status: "New",
  date_posted: "2026-05-20",
  first_seen_at: "2026-05-20T10:00:00Z",
  min_amount: 45000,
  max_amount: 65000,
  currency: "GBP",
  job_url: "https://example.com/job/1",
  industry_label: "Tech",
  seniority_label: "Senior",
};

/** A search that returned one job — tests table rendering. */
export const MOCK_SEARCH_WITH_RESULTS = {
  ...MOCK_SEARCH_EMPTY,
  results: [MOCK_JOB_ROW],
  rawResultCount: 1,
  resultCount: 1,
};

// ---------------------------------------------------------------------------
// Route helpers
// ---------------------------------------------------------------------------

type MockOptions = {
  /** Config returned by GET /api/user-config. Defaults to EMPTY_CONFIG. */
  config?: object;
  /** Searches returned by GET /api/searches. Defaults to []. */
  searches?: object[];
  /**
   * Called whenever a mutating request (PATCH / PUT / DELETE) is made to
   * /api/user-config. Return the JSON body to respond with, or undefined to
   * use the default (echo the merged config back).
   */
  onConfigMutate?: (method: string, body: object) => object | undefined;
  /**
   * Called whenever GET /api/searches is requested. Return the searches array
   * to respond with, or undefined to use the default mock searches.
   */
  onSearchesRequest?: () => object[] | undefined;
};

/**
 * Wire up route interception for all three API routes the app uses.
 * Must be called before page.goto('/').
 */
export async function mockAPIs(page: Page, opts: MockOptions = {}) {
  const config = opts.config ?? EMPTY_CONFIG;
  const searches = opts.searches ?? [];

  // /api/user-config — handles GET, PATCH, PUT, DELETE
  await page.route("/api/user-config", async (route) => {
    const method = route.request().method();

    if (method === "GET") {
      await route.fulfill({ json: config });
      return;
    }

    if (method === "DELETE") {
      const response = opts.onConfigMutate?.("DELETE", {}) ?? EMPTY_CONFIG;
      await route.fulfill({ json: response });
      return;
    }

    // PATCH / PUT — parse the body and merge / replace.
    let body: object = {};
    try {
      body = (route.request().postDataJSON() as object) ?? {};
    } catch {
      // Ignore parse errors — body stays empty.
    }

    const merged = method === "PUT" ? body : { ...config, ...body };
    const response = opts.onConfigMutate?.(method, body) ?? merged;
    await route.fulfill({ json: response });
  });

  // /api/searches — handles GET (query params vary; route glob covers all)
  await page.route("/api/searches**", async (route) => {
    const overridden = opts.onSearchesRequest?.();
    await route.fulfill({ json: { searches: overridden ?? searches } });
  });

  // /api/job-statuses — stub so status updates don't 500
  await page.route("/api/job-statuses", async (route) => {
    await route.fulfill({ json: { ok: true } });
  });

  // /api/job-industries — stub
  await page.route("/api/job-industries", async (route) => {
    await route.fulfill({ json: { ok: true } });
  });

  // /api/job-seniorities — stub
  await page.route("/api/job-seniorities", async (route) => {
    await route.fulfill({ json: { success: true } });
  });
}

/**
 * Navigate to the app and wait until the main UI is fully rendered.
 * The loading spinner disappears and #button-search becomes present in the DOM.
 */
export async function goto(page: Page) {
  await page.goto("/");
  // waitForLoadState("networkidle") ensures both the /api/searches and
  // /api/user-config effects have completed before assertions run.
  // Without this, the config effect (which sets the uncontrolled keyword
  // input value via ref) may not have fired yet.
  await page.waitForLoadState("networkidle");
  await page.waitForSelector("#button-search");
}
