import fs from "node:fs/promises";
import path from "node:path";

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

// Points to the user-editable config file one level above the dashboard folder.
const CONFIG_PATH = path.resolve(process.cwd(), "../CONFIG.MD");

function slugify(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

// Parse a JSON-style array string (e.g. '["indeed", "linkedin"]') into a string array.
function parseArray(raw: string): string[] {
  const normalized = raw
    .replace(/'/g, '"')
    .replace(/True/g, "true")
    .replace(/False/g, "false");

  try {
    const parsed = JSON.parse(normalized);
    return Array.isArray(parsed) ? parsed.map((v) => String(v)) : [];
  } catch {
    return raw
      .replace(/^[\[]|[\]]$/g, "")
      .split(",")
      .map((part) => part.trim().replace(/^['\"]|['\"]$/g, ""))
      .filter(Boolean);
  }
}

// Convert a raw string value to the appropriate JS type (array, boolean, number, or string).
function parseScalar(raw: string): SearchCriteriaValue {
  const trimmed = raw.trim().replace(/,$/, "");

  if (trimmed.startsWith("[") && trimmed.endsWith("]")) {
    return parseArray(trimmed);
  }

  if (/^(True|False)$/i.test(trimmed)) {
    return /^True$/i.test(trimmed);
  }

  if (/^-?\d+(\.\d+)?$/.test(trimmed)) {
    return Number(trimmed);
  }

  // Strip surrounding quotes from string values.
  return trimmed
    .replace(/^['\"]+/, "")
    .replace(/['\"]+$/, "")
    .replace(/,$/, "")
    .trim();
}

// Parse the "## BASIC SETTINGS" section. Each line is a bullet like "- key=value".
function parseBasicSettings(lines: string[]): Record<string, SearchCriteriaValue> {
  const settings: Record<string, SearchCriteriaValue> = {};

  for (const rawLine of lines) {
    const bulletMatch = rawLine.trim().match(/^-\s+(.+)$/);
    if (!bulletMatch) continue;

    const item = bulletMatch[1].trim();
    const equalsAt = item.indexOf("=");
    if (equalsAt <= 0) continue;

    const key = item.slice(0, equalsAt).trim();
    const value = item.slice(equalsAt + 1).trim();
    if (key && value) {
      settings[key] = parseScalar(value);
    }
  }

  return settings;
}

export async function loadSearchConfig(): Promise<SearchConfig> {
  const content = await fs.readFile(CONFIG_PATH, "utf8");
  const lines = content.split(/\r?\n/);

  // Track which top-level section (##) and sub-section (###) we're currently in.
  type TopSection = "basic" | "locations" | "filters" | null;
  type LocationSub = "inperson" | "remote" | null;
  type FilterSub = "include" | "exclude" | "blacklist" | null;

  let topSection: TopSection = null;
  let locationSub: LocationSub = null;
  let filterSub: FilterSub = null;

  // Accumulate raw lines for basic settings, and items for each list.
  const basicLines: string[] = [];
  const inPersonItems: string[] = [];
  const remoteItems: string[] = [];
  const includeTitleTerms: string[] = [];
  const excludeTitleTerms: string[] = [];
  const blacklistCompanies: string[] = [];

  for (const rawLine of lines) {
    const line = rawLine.trim();

    // Detect top-level (##) section changes.
    if (/^##\s+BASIC SETTINGS\s*$/i.test(line)) {
      topSection = "basic"; locationSub = null; filterSub = null; continue;
    }
    if (/^##\s+LOCATIONS\s*$/i.test(line)) {
      topSection = "locations"; locationSub = null; filterSub = null; continue;
    }
    if (/^##\s+FILTERS\s*$/i.test(line)) {
      topSection = "filters"; locationSub = null; filterSub = null; continue;
    }

    // Detect sub-sections (###) within Locations.
    if (topSection === "locations") {
      if (/^###\s+In-Person/i.test(line)) { locationSub = "inperson"; continue; }
      if (/^###\s+Remote Only/i.test(line)) { locationSub = "remote"; continue; }
    }

    // Detect sub-sections (###) within Filters.
    if (topSection === "filters") {
      if (/^###\s+INCLUDE\s*$/i.test(line)) { filterSub = "include"; continue; }
      if (/^###\s+EXCLUDE\s*$/i.test(line)) { filterSub = "exclude"; continue; }
      if (/^###\s+BLACKLIST\s*$/i.test(line)) { filterSub = "blacklist"; continue; }
    }

    // Collect bullet list items (lines starting with "- ").
    const bulletMatch = line.match(/^-\s+(.+)$/);
    if (!bulletMatch) continue;
    const item = bulletMatch[1].trim();

    if (topSection === "basic") {
      basicLines.push(line); // Keep the full "- key=value" line for parseBasicSettings.
    } else if (topSection === "locations") {
      if (locationSub === "inperson") inPersonItems.push(item);
      else if (locationSub === "remote") remoteItems.push(item);
    } else if (topSection === "filters") {
      if (filterSub === "include") includeTitleTerms.push(item);
      else if (filterSub === "exclude") excludeTitleTerms.push(item);
      else if (filterSub === "blacklist") blacklistCompanies.push(item);
    }
  }

  // Parse the shared base criteria from Basic Settings.
  const basicSettings = parseBasicSettings(basicLines);

  const definitions: SearchDefinition[] = [];

  // Build one search definition per in-person/hybrid/remote location.
  // Each item has the format: "Location, Country, Distance"
  for (const item of inPersonItems) {
    const parts = item.split(",").map((p) => p.trim());
    if (parts.length < 3) continue;

    const [locationName, country, distanceStr] = parts;
    const distance = Number(distanceStr);

    definitions.push({
      slug: slugify(locationName),
      title: locationName,
      criteria: {
        ...basicSettings,
        location: locationName,
        distance: distance,
        country_indeed: country,
        is_remote: false,
      },
    });
  }

  // Build one search definition per remote-only region.
  // Each item is just a region name (e.g. "UK", "Europe").
  // The region name is used as both the location and country_indeed value.
  for (const item of remoteItems) {
    const region = item.trim();
    if (!region) continue;

    const title = `${region} Remote`;
    definitions.push({
      slug: slugify(title),
      title,
      criteria: {
        ...basicSettings,
        location: region,
        country_indeed: region,
        is_remote: true,
      },
    });
  }

  return {
    definitions,
    filters: { includeTitleTerms, excludeTitleTerms, blacklistCompanies },
  };
}

export async function loadSearchDefinitions(): Promise<SearchDefinition[]> {
  const config = await loadSearchConfig();
  return config.definitions;
}
