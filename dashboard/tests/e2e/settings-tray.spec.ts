/**
 * settings-tray.spec.ts
 *
 * Tests the settings tray — the panel that appears below the header when the
 * keyword input is focused. Covers open/close triggers and field behaviour.
 */

import { test, expect } from "@playwright/test";
import {
  mockAPIs, goto,
  EMPTY_CONFIG, CONFIG_WITH_BOTH, MOCK_SEARCH_EMPTY,
} from "./helpers";

test.describe("Settings tray", () => {
  test("opens when the keyword input is focused", async ({ page }) => {
    await mockAPIs(page, { config: EMPTY_CONFIG, searches: [] });
    await goto(page);

    await expect(page.locator("#settings-tray")).not.toBeAttached();
    await page.locator("#input-keyword").click();
    await expect(page.locator("#settings-tray")).toBeVisible();
  });

  test("closes when clicking outside the tray and keyword input", async ({ page }) => {
    await mockAPIs(page, { config: EMPTY_CONFIG, searches: [] });
    await goto(page);

    await page.locator("#input-keyword").click();
    await expect(page.locator("#settings-tray")).toBeVisible();

    // Click somewhere in the content area (outside the header/tray).
    await page.locator("#dashboard-content").click({ position: { x: 100, y: 100 } });
    await expect(page.locator("#settings-tray")).not.toBeAttached();
  });

  test("does not close while the Add Location dialog is open", async ({ page }) => {
    await mockAPIs(page, { config: EMPTY_CONFIG, searches: [] });
    await goto(page);

    await page.locator("#input-keyword").click();
    await expect(page.locator("#settings-tray")).toBeVisible();

    await page.locator("#button-add-tab").click();
    // Backdrop click (simulates clicking the dimmed area behind the dialog)
    await page.mouse.click(10, 10);
    // Tray should still be visible because the dialog was open.
    await expect(page.locator("#settings-tray")).toBeVisible();
  });

  test("closes when the search button is clicked", async ({ page }) => {
    await mockAPIs(page, { config: CONFIG_WITH_BOTH, searches: [MOCK_SEARCH_EMPTY] });
    await goto(page);

    await page.locator("#input-keyword").click();
    await expect(page.locator("#settings-tray")).toBeVisible();

    await page.locator("#button-search").click();
    await expect(page.locator("#settings-tray")).not.toBeAttached();
  });

  test("clicking the search button while the tray is open triggers the search", async ({ page }) => {
    let searchRequestCount = 0;

    await mockAPIs(page, {
      config: CONFIG_WITH_BOTH,
      searches: [MOCK_SEARCH_EMPTY],
      onSearchesRequest: () => {
        searchRequestCount++;
        return [MOCK_SEARCH_EMPTY];
      },
    });
    await goto(page);

    const countBefore = searchRequestCount;
    await page.locator("#input-keyword").click();
    await expect(page.locator("#settings-tray")).toBeVisible();

    await page.locator("#button-search").click();

    // Wait for the button to re-enable (search completed).
    await expect(page.locator("#button-search")).toBeEnabled();
    expect(searchRequestCount).toBeGreaterThan(countBefore);
  });

  test("field values persist when the tray is closed and reopened", async ({ page }) => {
    await mockAPIs(page, { config: EMPTY_CONFIG, searches: [] });
    await goto(page);

    // Open tray and change the title-includes field.
    await page.locator("#input-keyword").click();
    await page.locator("#input-include").fill("Product Designer");

    // Close the tray.
    await page.locator("#dashboard-content").click({ position: { x: 100, y: 100 } });
    await expect(page.locator("#settings-tray")).not.toBeAttached();

    // Reopen — the value should still be there.
    await page.locator("#input-keyword").click();
    await expect(page.locator("#input-include")).toHaveValue("Product Designer");
  });

  test("tray close button closes the tray", async ({ page }) => {
    await mockAPIs(page, { config: EMPTY_CONFIG, searches: [] });
    await goto(page);

    await page.locator("#input-keyword").click();
    await expect(page.locator("#settings-tray")).toBeVisible();

    await page.locator("#settings-tray-close").click();
    await expect(page.locator("#settings-tray")).not.toBeAttached();
  });

  test("site selection is reflected in the tray", async ({ page }) => {
    await mockAPIs(page, { config: EMPTY_CONFIG, searches: [] });
    await goto(page);

    await page.locator("#input-keyword").click();
    // The default sites are LinkedIn, Indeed, Glassdoor — check the select trigger shows them.
    const siteTrigger = page.locator("#select-job-sites");
    await expect(siteTrigger).toContainText("LinkedIn");
  });

  test("config-loaded values populate tray fields", async ({ page }) => {
    const config = {
      ...EMPTY_CONFIG,
      titleIncludes: ["Product Designer", "UX Designer"],
      titleExcludes: ["Senior", "Lead"],
      employerBlacklist: ["DataAnnotation"],
    };
    await mockAPIs(page, { config, searches: [] });
    await goto(page);

    await page.locator("#input-keyword").click();
    await expect(page.locator("#input-include")).toHaveValue("Product Designer, UX Designer");
    await expect(page.locator("#input-exclude")).toHaveValue("Senior, Lead");
    await expect(page.locator("#input-blacklist")).toHaveValue("DataAnnotation");
  });
});
