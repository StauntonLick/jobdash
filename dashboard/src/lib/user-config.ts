/**
 * user-config.ts
 *
 * Owns the UserConfig type — the single source of truth for everything the
 * user has configured through the UI.  Persisted as JSON in the per-environment
 * cache directory (controlled by JOBDASH_CACHE_DIR).
 *
 * Dev:  dashboard/.cache-dev/user-config.json
 * Prod: dashboard/.cache/user-config.json
 */

import fs from "node:fs/promises";
import path from "node:path";

export { INDEED_COUNTRIES } from "@/lib/location-constants";
export type { IndeedCountry } from "@/lib/location-constants";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** A hybrid / in-person location tab. */
export type HybridLocation = {
  id: string;
  type: "hybrid";
  /** Display label used as the tab title (e.g. "Edinburgh"). */
  label: string;
  /** City / region string passed to JobSpy (e.g. "Edinburgh"). */
  city: string;
  /** Search radius in kilometres. */
  radiusKm: number;
  /** Indeed country code (e.g. "UK"). */
  country: string;
};

/** A remote-only location tab. */
export type RemoteLocation = {
  id: string;
  type: "remote";
  /** Display label used as the tab title (e.g. "UK Remote"). */
  label: string;
  /** Indeed country name (e.g. "United Kingdom"). */
  country: string;
};

export type UserLocation = HybridLocation | RemoteLocation;

/**
 * The full user configuration object.  All fields have defaults so the app
 * works out-of-the-box with an empty config file.
 */
export type UserConfig = {
  /**
   * Free-text search keywords.  Joined into a quoted OR expression when
   * passed to JobSpy (e.g. ["UX Designer", "Product Designer"]).
   */
  keywords: string[];
  /**
   * Job board sites to search.
   * Valid values: "indeed" | "linkedin" | "glassdoor" | "zip_recruiter" | "google"
   */
  sites: string[];
  /** How far back to search, in days (converted to hours_old for JobSpy). */
  daysOld: number;
  /** Maximum results to request per site per search. */
  resultsWanted: number;
  /** Job title terms — only jobs whose title contains at least one will appear. */
  titleIncludes: string[];
  /** Job title terms — jobs whose title contains any of these are hidden. */
  titleExcludes: string[];
  /** Company names to suppress from all results. */
  employerBlacklist: string[];
  /** Ordered list of location tabs shown in the UI. */
  locations: UserLocation[];
};


// ---------------------------------------------------------------------------
// Defaults
// ---------------------------------------------------------------------------

export const DEFAULT_CONFIG: UserConfig = {
  keywords: [],
  sites: ["linkedin", "indeed", "glassdoor"],
  daysOld: 14,
  resultsWanted: 60,
  titleIncludes: [],
  titleExcludes: [],
  employerBlacklist: [],
  locations: [],
};

// ---------------------------------------------------------------------------
// Storage
// ---------------------------------------------------------------------------

const CACHE_BASE = path.resolve(
  process.cwd(),
  process.env.JOBDASH_CACHE_DIR ?? ".cache"
);
const CONFIG_PATH = path.join(CACHE_BASE, "user-config.json");

function isUserConfig(value: unknown): value is Partial<UserConfig> {
  return typeof value === "object" && value !== null;
}

/**
 * Load the persisted UserConfig, merging over the defaults so that new
 * fields added in future releases always have a safe fallback.
 */
export async function loadUserConfig(): Promise<UserConfig> {
  try {
    const raw = await fs.readFile(CONFIG_PATH, "utf8");
    const parsed = JSON.parse(raw);
    if (!isUserConfig(parsed)) return { ...DEFAULT_CONFIG };
    return { ...DEFAULT_CONFIG, ...parsed } as UserConfig;
  } catch {
    // Missing file or parse error → start from defaults.
    return { ...DEFAULT_CONFIG };
  }
}

/**
 * Persist the full UserConfig to disk.
 * Callers are responsible for merging first if they only want a partial update.
 */
export async function saveUserConfig(config: UserConfig): Promise<void> {
  await fs.mkdir(CACHE_BASE, { recursive: true });
  await fs.writeFile(CONFIG_PATH, JSON.stringify(config, null, 2), "utf8");
}

/**
 * Convenience wrapper: load → merge → save → return the new config.
 */
export async function updateUserConfig(
  update: Partial<UserConfig>
): Promise<UserConfig> {
  const current = await loadUserConfig();
  const next: UserConfig = { ...current, ...update };
  await saveUserConfig(next);
  return next;
}
