/**
 * search-config.ts
 *
 * Derives the runtime search definitions used by jobspy-service.ts from
 * the persisted UserConfig (user-config.ts).
 *
 * The exported types (SearchDefinition, SearchFilters, SearchConfig) and the
 * loadSearchConfig / loadSearchDefinitions entry-points are unchanged so that
 * existing API routes and service code require no modification.
 */

import type { UserConfig, HybridLocation, RemoteLocation } from "@/lib/user-config";
import { loadUserConfig } from "@/lib/user-config";

// ---------------------------------------------------------------------------
// Types (kept stable — consumed by jobspy-service.ts and the API routes)
// ---------------------------------------------------------------------------

export type SearchCriteriaValue = string | number | boolean | string[];

export type SearchDefinition = {
  slug: string;
  title: string;
  criteria: Record<string, SearchCriteriaValue>;
};

export type SearchFilters = {
  includeTitleTerms: string[];
  excludeTitleTerms: string[];
  blacklistCompanies: string[];
};

export type SearchConfig = {
  definitions: SearchDefinition[];
  filters: SearchFilters;
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function slugify(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

/**
 * Build the `search_term` string JobSpy expects from the user's keyword list.
 * Multiple keywords are joined with OR.  Keywords are intentionally NOT
 * wrapped in double-quotes: quoted phrase syntax ("UX Designer") causes
 * LinkedIn's guest API to silently fall back to returning all local jobs
 * when it cannot match the exact phrase, whereas unquoted keywords trigger
 * LinkedIn's semantic matching (which is what we want — allowing through
 * "Product Designer", "UX Researcher", "User-Centred Designer", etc.).
 * Returns an empty string if there are no keywords.
 */
function buildSearchTerm(keywords: string[]): string {
  const clean = keywords.map((k) => k.trim()).filter(Boolean);
  if (clean.length === 0) return "";
  if (clean.length === 1) return clean[0];
  return clean.join(" OR ");
}

/**
 * Build the shared base criteria from top-level UserConfig fields.
 * These are merged into every per-location search.
 */
function buildBaseCriteria(
  config: UserConfig
): Record<string, SearchCriteriaValue> {
  return {
    site_name: config.sites,
    search_term: buildSearchTerm(config.keywords),
    results_wanted: config.resultsWanted,
    hours_old: config.daysOld * 24,
    linkedin_fetch_description: false,
  };
}

function hybridToDefinition(
  loc: HybridLocation,
  base: Record<string, SearchCriteriaValue>
): SearchDefinition {
  return {
    slug: slugify(loc.label),
    title: loc.label,
    criteria: {
      ...base,
      location: loc.city,
      distance: loc.radiusKm,
      country_indeed: loc.country,
      is_remote: false,
    },
  };
}

function remoteToDefinition(
  loc: RemoteLocation,
  base: Record<string, SearchCriteriaValue>
): SearchDefinition {
  return {
    slug: slugify(loc.label),
    title: loc.label,
    criteria: {
      ...base,
      location: loc.country,
      country_indeed: loc.country,
      is_remote: true,
    },
  };
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export async function loadSearchConfig(): Promise<SearchConfig> {
  const config = await loadUserConfig();
  const base = buildBaseCriteria(config);

  const definitions: SearchDefinition[] = config.locations.map((loc) =>
    loc.type === "hybrid"
      ? hybridToDefinition(loc, base)
      : remoteToDefinition(loc, base)
  );

  return {
    definitions,
    filters: {
      includeTitleTerms: config.titleIncludes,
      excludeTitleTerms: config.titleExcludes,
      blacklistCompanies: config.employerBlacklist,
    },
  };
}

export async function loadSearchDefinitions(): Promise<SearchDefinition[]> {
  const config = await loadSearchConfig();
  return config.definitions;
}
