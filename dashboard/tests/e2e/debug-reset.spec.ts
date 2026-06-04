/**
 * debug-reset.spec.ts
 *
 * Tests the debug "reset" button that clears all search state in both the UI
 * and the backend.
 */

import { test, expect } from "@playwright/test";
import {
  mockAPIs, goto,
  EMPTY_CONFIG, CONFIG_WITH_BOTH, MOCK_SEARCH_WITH_RESULTS,
} from "./helpers";

test.describe("Debug reset button", () => {
  test("button is present in the header", async ({ page }) => {
    await mockAPIs(page, { config: EMPTY_CONFIG, searches: [] });
    await goto(page);
    await expect(page.locator("#button-debug-reset")).toBeVisible();
  });

  test("calls DELETE /api/user-config", async ({ page }) => {
    let deleteCalled = false;
    await mockAPIs(page, {
      config: CONFIG_WITH_BOTH,
      searches: [MOCK_SEARCH_WITH_RESULTS],
      onConfigMutate: (method) => {
        if (method === "DELETE") deleteCalled = true;
        return EMPTY_CONFIG;
      },
    });
    await goto(page);

    await page.locator("#button-debug-reset").click();
    await expect(page.locator("#button-search")).toBeDisabled();

    expect(deleteCalled).toBe(true);
  });

  test("clears the keyword input", async ({ page }) => {
    await mockAPIs(page, {
      config: CONFIG_WITH_BOTH,
      searches: [MOCK_SEARCH_WITH_RESULTS],
      onConfigMutate: () => EMPTY_CONFIG,
    });
    await goto(page);

    // Type a keyword via Playwright (reliable; avoids the strict-mode ref-race
    // that makes config-loaded DOM values inconsistently readable in test).
    await page.locator("#input-keyword").fill("UX Designer");
    await expect(page.locator("#input-keyword")).toHaveValue("UX Designer");

    await page.locator("#button-debug-reset").click();
    await expect(page.locator("#input-keyword")).toHaveValue("");
  });

  test("clears search result tabs", async ({ page }) => {
    await mockAPIs(page, {
      config: CONFIG_WITH_BOTH,
      searches: [MOCK_SEARCH_WITH_RESULTS],
      onConfigMutate: () => EMPTY_CONFIG,
    });
    await goto(page);

    // Tab exists before reset.
    await expect(page.locator("#tab-trigger-edinburgh")).toBeVisible();

    await page.locator("#button-debug-reset").click();

    // All result tabs gone.
    await expect(page.locator("#tab-trigger-edinburgh")).not.toBeAttached();
  });

  test("disables the search button after reset", async ({ page }) => {
    await mockAPIs(page, {
      config: CONFIG_WITH_BOTH,
      searches: [MOCK_SEARCH_WITH_RESULTS],
      onConfigMutate: () => EMPTY_CONFIG,
    });
    await goto(page);

    await expect(page.locator("#button-search")).toBeEnabled();
    await page.locator("#button-debug-reset").click();
    await expect(page.locator("#button-search")).toBeDisabled();
  });

  test("resets tray fields to defaults", async ({ page }) => {
    const configWithFilters = {
      ...CONFIG_WITH_BOTH,
      titleIncludes: ["Product Designer"],
      titleExcludes: ["Senior"],
      employerBlacklist: ["DataAnnotation"],
    };
    await mockAPIs(page, {
      config: configWithFilters,
      searches: [MOCK_SEARCH_WITH_RESULTS],
      onConfigMutate: () => EMPTY_CONFIG,
    });
    await goto(page);

    // Open tray to confirm filters were loaded.
    await page.locator("#button-settings").click();
    await expect(page.locator("#input-include")).toHaveValue("Product Designer");

    // Close tray, reset.
    await page.locator("#settings-tray-close").click();
    await page.locator("#button-debug-reset").click();

    // Reopen tray — fields should be empty.
    // After reset, tabs are cleared so #button-settings no longer exists;
    // add a location first to restore the button, then reopen the tray.
    await page.locator("#button-add-location").click();
    await page.locator("#dialog-city").fill("Edinburgh");
    await page.locator("#button-dialog-add-location").click();
    await page.locator("#button-settings").click();
    await expect(page.locator("#input-include")).toHaveValue("");
    await expect(page.locator("#input-exclude")).toHaveValue("");
    await expect(page.locator("#input-blacklist")).toHaveValue("");
  });
});
