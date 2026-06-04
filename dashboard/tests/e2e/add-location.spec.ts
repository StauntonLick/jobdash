/**
 * add-location.spec.ts
 *
 * Tests the Add Location dialog and its effect on the tab bar, config, and
 * search button state.
 */

import { test, expect } from "@playwright/test";
import {
  mockAPIs, goto,
  EMPTY_CONFIG, CONFIG_WITH_KEYWORD, MOCK_SEARCH_EMPTY,
} from "./helpers";

test.describe("Add Location dialog", () => {
  test("opens when the + Add Location button is clicked", async ({ page }) => {
    await mockAPIs(page, { config: EMPTY_CONFIG, searches: [] });
    await goto(page);

    await page.locator("#button-add-location").click();
    await expect(page.getByRole("heading", { name: "Add Location" })).toBeVisible();
  });

  test("closes when Cancel is clicked", async ({ page }) => {
    await mockAPIs(page, { config: EMPTY_CONFIG, searches: [] });
    await goto(page);

    await page.locator("#button-add-location").click();
    await page.getByRole("button", { name: "Cancel" }).click();
    await expect(page.getByRole("heading", { name: "Add Location" })).not.toBeAttached();
  });

  test("closes when the backdrop is clicked", async ({ page }) => {
    await mockAPIs(page, { config: EMPTY_CONFIG, searches: [] });
    await goto(page);

    await page.locator("#button-add-location").click();
    await expect(page.getByRole("heading", { name: "Add Location" })).toBeVisible();
    // Click the top-left corner of the screen — outside the dialog card.
    await page.mouse.click(10, 10);
    await expect(page.getByRole("heading", { name: "Add Location" })).not.toBeAttached();
  });

  test("creates a draft tab immediately after submitting", async ({ page }) => {
    let configSaved = false;
    await mockAPIs(page, {
      config: CONFIG_WITH_KEYWORD,
      searches: [],
      onConfigMutate: (_method, body) => {
        configSaved = true;
        return { ...CONFIG_WITH_KEYWORD, ...body };
      },
    });
    await goto(page);

    await page.locator("#button-add-location").click();
    await page.locator("#dialog-city").fill("Edinburgh");
    await page.locator("#button-dialog-add-location").click();

    // Draft tab should appear in the tab list straight away.
    await expect(page.locator("#dashboard-tab-list")).toContainText("Edinburgh");
  });

  test("does NOT auto-run a search after a location is added", async ({ page }) => {
    let searchCallCount = 0;
    await mockAPIs(page, {
      config: CONFIG_WITH_KEYWORD,
      searches: [],
      onSearchesRequest: () => {
        searchCallCount++;
        return [];
      },
    });
    await goto(page);

    const countAfterLoad = searchCallCount;

    await page.locator("#button-add-location").click();
    await page.locator("#dialog-city").fill("Edinburgh");
    await page.locator("#button-dialog-add-location").click();

    // Give any spurious async calls time to fire.
    await page.waitForTimeout(500);
    expect(searchCallCount).toBe(countAfterLoad);
  });

  test("saves the keyword alongside the new location in the PATCH call", async ({ page }) => {
    const savedBodies: object[] = [];
    await mockAPIs(page, {
      config: CONFIG_WITH_KEYWORD,
      searches: [],
      onConfigMutate: (_method, body) => {
        savedBodies.push(body);
        return { ...CONFIG_WITH_KEYWORD, ...body };
      },
    });
    await goto(page);

    // Ensure keyword is set (config loaded it, but let's be explicit).
    await page.locator("#input-keyword").fill("UX Designer");

    await page.locator("#button-add-location").click();
    await page.locator("#dialog-city").fill("Edinburgh");
    await page.locator("#button-dialog-add-location").click();

    // Wait for the config save to happen.
    await page.waitForTimeout(300);

    // The PATCH body must include the keyword.
    const patchBody = savedBodies.find((b) =>
      Array.isArray((b as Record<string, unknown>).keywords)
    ) as Record<string, unknown> | undefined;

    expect(patchBody).toBeDefined();
    expect(patchBody?.keywords).toContain("UX Designer");
  });

  test("enables the search button after a location is added (when keyword already present)", async ({ page }) => {
    await mockAPIs(page, {
      config: CONFIG_WITH_KEYWORD,
      searches: [],
      onConfigMutate: (_method, body) => ({ ...CONFIG_WITH_KEYWORD, ...body }),
    });
    await goto(page);

    await expect(page.locator("#button-search")).toBeDisabled();

    await page.locator("#button-add-location").click();
    await page.locator("#dialog-city").fill("Edinburgh");
    await page.locator("#button-dialog-add-location").click();

    // Once the config save completes and savedConfig is updated, the button enables.
    await expect(page.locator("#button-search")).toBeEnabled();
  });

  test("hybrid location shows city and radius fields", async ({ page }) => {
    await mockAPIs(page, { config: EMPTY_CONFIG, searches: [] });
    await goto(page);

    await page.locator("#button-add-location").click();
    // Hybrid is the default — city and radius inputs should be visible.
    await expect(page.locator("#dialog-city")).toBeVisible();
    await expect(page.locator("#dialog-radius")).toBeVisible();
    await expect(page.locator("#dialog-country")).not.toBeAttached();
  });

  test("remote location shows country selector, not city/radius", async ({ page }) => {
    await mockAPIs(page, { config: EMPTY_CONFIG, searches: [] });
    await goto(page);

    await page.locator("#button-add-location").click();
    // Switch to Remote.
    await page.getByRole("button", { name: /remote/i }).click();
    await expect(page.locator("#dialog-country")).toBeVisible();
    await expect(page.locator("#dialog-city")).not.toBeAttached();
    await expect(page.locator("#dialog-radius")).not.toBeAttached();
  });
});
