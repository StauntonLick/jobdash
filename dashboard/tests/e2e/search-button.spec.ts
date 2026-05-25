/**
 * search-button.spec.ts
 *
 * Tests the enabled/disabled state of the Search button (#button-search).
 * The button should only be active once the user has provided both a keyword
 * and at least one location.
 */

import { test, expect } from "@playwright/test";
import {
  mockAPIs, goto,
  EMPTY_CONFIG, CONFIG_WITH_KEYWORD, CONFIG_WITH_BOTH,
  MOCK_SEARCH_EMPTY,
} from "./helpers";

test.describe("Search button state", () => {
  test("disabled on load with no keyword and no location", async ({ page }) => {
    await mockAPIs(page, { config: EMPTY_CONFIG, searches: [] });
    await goto(page);
    await expect(page.locator("#button-search")).toBeDisabled();
  });

  test("disabled when keyword is present but no location", async ({ page }) => {
    // Config has a keyword but no locations; searches returns nothing.
    await mockAPIs(page, { config: CONFIG_WITH_KEYWORD, searches: [] });
    await goto(page);
    await expect(page.locator("#button-search")).toBeDisabled();
  });

  test("disabled when location is present but no keyword", async ({ page }) => {
    const configNoKeyword = {
      ...EMPTY_CONFIG,
      locations: [{ id: "loc-1", type: "hybrid", label: "Edinburgh",
                    city: "Edinburgh", radiusKm: 30, country: "UK" }],
    };
    await mockAPIs(page, {
      config: configNoKeyword,
      searches: [{ ...MOCK_SEARCH_EMPTY, slug: "edinburgh", title: "Edinburgh" }],
    });
    await goto(page);
    await expect(page.locator("#button-search")).toBeDisabled();
  });

  test("enabled when both keyword and location are present in loaded config", async ({ page }) => {
    await mockAPIs(page, { config: CONFIG_WITH_BOTH, searches: [MOCK_SEARCH_EMPTY] });
    await goto(page);
    await expect(page.locator("#button-search")).toBeEnabled();
  });

  test("enables after user types a keyword when location already exists", async ({ page }) => {
    // Start with a location but no keyword.
    const configNoKeyword = {
      ...EMPTY_CONFIG,
      locations: [{ id: "loc-1", type: "hybrid", label: "Edinburgh",
                    city: "Edinburgh", radiusKm: 30, country: "UK" }],
    };
    await mockAPIs(page, {
      config: configNoKeyword,
      searches: [{ ...MOCK_SEARCH_EMPTY, slug: "edinburgh", title: "Edinburgh" }],
    });
    await goto(page);

    await expect(page.locator("#button-search")).toBeDisabled();
    await page.locator("#input-keyword").fill("UX Designer");
    await expect(page.locator("#button-search")).toBeEnabled();
  });

  test("disables again after keyword is cleared", async ({ page }) => {
    await mockAPIs(page, { config: CONFIG_WITH_BOTH, searches: [MOCK_SEARCH_EMPTY] });
    await goto(page);

    // Type a keyword via Playwright so onInput fires and keywordHasValue is set;
    // don't rely on the config-loaded ref assignment which races with strict-mode
    // double-mounting in development.
    await page.locator("#input-keyword").fill("UX Designer");
    await expect(page.locator("#button-search")).toBeEnabled();

    // fill("") triggers onInput with an empty value, disabling the button.
    await page.locator("#input-keyword").fill("");
    await expect(page.locator("#button-search")).toBeDisabled();
  });

  test("disabled while a search is in progress", async ({ page }) => {
    // Use a single route handler with a manual response trigger so we can
    // observe the disabled state while the search is in-flight.
    let respondToSearch!: () => void;
    const blocked = new Promise<void>((resolve) => { respondToSearch = resolve; });
    let callCount = 0;

    await mockAPIs(page, { config: CONFIG_WITH_BOTH, searches: [MOCK_SEARCH_EMPTY] });

    // Override the searches route: first call (mount) passes through immediately;
    // second call (button click) is held until we release it.
    await page.route("/api/searches**", async (route) => {
      callCount++;
      if (callCount === 1) {
        // Mount search — respond immediately.
        await route.fulfill({ json: { searches: [MOCK_SEARCH_EMPTY] } });
      } else {
        // Button-click search — hold until released.
        await blocked;
        await route.fulfill({ json: { searches: [MOCK_SEARCH_EMPTY] } });
      }
    });

    await goto(page);
    await expect(page.locator("#button-search")).toBeEnabled();

    await page.locator("#button-search").click();
    await expect(page.locator("#button-search")).toBeDisabled();

    respondToSearch();
    await expect(page.locator("#button-search")).toBeEnabled();
  });

  test("shows correct tooltip when keyword is missing", async ({ page }) => {
    await mockAPIs(page, { config: EMPTY_CONFIG, searches: [] });
    await goto(page);
    await expect(page.locator("#button-search")).toHaveAttribute(
      "title",
      "Enter a keyword to search"
    );
  });

  test("shows correct tooltip when location is missing", async ({ page }) => {
    await mockAPIs(page, { config: CONFIG_WITH_KEYWORD, searches: [] });
    await goto(page);
    await expect(page.locator("#button-search")).toHaveAttribute(
      "title",
      "Add a location to search"
    );
  });
});
