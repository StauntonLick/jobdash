/**
 * seniority-column.spec.ts
 *
 * Tests for the Seniority column in the job results table:
 * - Column header is "Seniority" (salary column is gone)
 * - Inferred seniority label is rendered in the cell
 * - Clicking the cell opens a dropdown with all 7 levels
 * - Selecting a level POSTs to /api/job-seniorities and updates the cell
 */

import { test, expect } from "@playwright/test";
import {
  mockAPIs,
  goto,
  CONFIG_WITH_BOTH,
  MOCK_SEARCH_WITH_RESULTS,
  MOCK_JOB_ROW,
} from "./helpers";

const SENIORITY_LEVELS = ["Intern", "Junior", "Mid", "Senior", "Principal", "Lead", "Manager"];

test.describe("Seniority column", () => {
  test("shows Seniority header instead of Salary", async ({ page }) => {
    await mockAPIs(page, {
      config: CONFIG_WITH_BOTH,
      searches: [MOCK_SEARCH_WITH_RESULTS],
    });
    await goto(page);

    const headers = page.locator("th");
    await expect(headers.filter({ hasText: "Seniority" })).toHaveCount(1);
    await expect(headers.filter({ hasText: "Salary" })).toHaveCount(0);
  });

  test("renders inferred seniority label from mock data", async ({ page }) => {
    await mockAPIs(page, {
      config: CONFIG_WITH_BOTH,
      searches: [MOCK_SEARCH_WITH_RESULTS],
    });
    await goto(page);

    // MOCK_JOB_ROW has seniority_label: "Senior"
    await expect(page.locator("td").filter({ hasText: "Senior" }).first()).toBeVisible();
  });

  test("clicking seniority cell opens dropdown with all 7 levels", async ({ page }) => {
    await mockAPIs(page, {
      config: CONFIG_WITH_BOTH,
      searches: [MOCK_SEARCH_WITH_RESULTS],
    });
    await goto(page);

    // The seniority trigger button contains exactly "Senior" — use a regex to
    // avoid matching the title cell which contains "Senior UX Designer".
    const seniorityTrigger = page
      .locator("#search-result-row-edinburgh-0 td button")
      .filter({ hasText: /^Senior$/ });
    await seniorityTrigger.click();

    for (const level of SENIORITY_LEVELS) {
      await expect(page.locator(`[role="menuitem"]`).filter({ hasText: level })).toBeVisible();
    }
  });

  test("selecting a seniority level POSTs to /api/job-seniorities and updates cell", async ({ page }) => {
    const requests: { statusKey: string; seniority: string }[] = [];

    await mockAPIs(page, {
      config: CONFIG_WITH_BOTH,
      searches: [MOCK_SEARCH_WITH_RESULTS],
    });

    // Intercept after mockAPIs so we can capture the body
    await page.route("/api/job-seniorities", async (route) => {
      const body = route.request().postDataJSON() as { statusKey: string; seniority: string };
      requests.push(body);
      await route.fulfill({ json: { success: true } });
    });

    await goto(page);

    // Open seniority dropdown and pick "Lead"
    const seniorityTrigger = page
      .locator("#search-result-row-edinburgh-0 td button")
      .filter({ hasText: /^Senior$/ });
    await seniorityTrigger.click();
    await page.locator(`[role="menuitem"]`).filter({ hasText: /^Lead$/ }).click();

    // API should have been called with the correct payload
    expect(requests).toHaveLength(1);
    expect(requests[0].statusKey).toBe(MOCK_JOB_ROW.status_key);
    expect(requests[0].seniority).toBe("Lead");

    // Cell should now show "Lead"
    await expect(
      page.locator("#search-result-row-edinburgh-0 td button").filter({ hasText: /^Lead$/ })
    ).toBeVisible();
  });
});
