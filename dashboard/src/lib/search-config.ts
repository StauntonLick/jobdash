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
};

export type SearchConfig = {
  definitions: SearchDefinition[];
  filters: SearchFilters;
};

const SEARCH_PARAMS_PATH = path.resolve(process.cwd(), "../CONFIG.MD");

function slugify(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

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

  return trimmed
    .replace(/^['\"]+/, "")
    .replace(/['\"]+$/, "")
    .replace(/,$/, "")
    .trim();
}

function parseSection(lines: string[]): Record<string, SearchCriteriaValue> {
  const criteria: Record<string, SearchCriteriaValue> = {};

  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (!line) {
      continue;
    }

    const equalsAt = line.indexOf("=");
    if (equalsAt <= 0) {
      continue;
    }

    const key = line.slice(0, equalsAt).trim();
    const value = line.slice(equalsAt + 1).trim();

    if (!key || !value) {
      continue;
    }

    criteria[key] = parseScalar(value);
  }

  return criteria;
}

function parseFilters(lines: string[]): SearchFilters {
  const filters: SearchFilters = {
    includeTitleTerms: [],
    excludeTitleTerms: [],
  };

  let activeList: keyof SearchFilters | null = null;

  for (const rawLine of lines) {
    const line = rawLine.trim();

    if (/^Include jobs where the title includes/i.test(line)) {
      activeList = "includeTitleTerms";
      continue;
    }

    if (/^Exclude jobs where the title includes/i.test(line)) {
      activeList = "excludeTitleTerms";
      continue;
    }

    const bulletMatch = line.match(/^-\s+(.+)$/);
    if (activeList && bulletMatch) {
      filters[activeList].push(bulletMatch[1].trim());
    }
  }

  return filters;
}

export async function loadSearchConfig(): Promise<SearchConfig> {
  const content = await fs.readFile(SEARCH_PARAMS_PATH, "utf8");
  const lines = content.split(/\r?\n/);
  const filterSection = content.split(/^##\s+FILTERS\s*$/im)[1] ?? "";

  const sections: SearchDefinition[] = [];

  let currentTitle = "";
  let currentLines: string[] = [];
  let inSearchParameters = false;
  let inFilters = false;

  const flushSection = () => {
    if (!currentTitle) {
      return;
    }

    sections.push({
      slug: slugify(currentTitle),
      title: currentTitle,
      criteria: parseSection(currentLines),
    });

    currentLines = [];
  };

  for (const line of lines) {
    if (/^##\s+SEARCH PARAMETERS\s*$/i.test(line)) {
      flushSection();
      currentTitle = "";
      inSearchParameters = true;
      inFilters = false;
      continue;
    }

    if (/^##\s+FILTERS\s*$/i.test(line)) {
      flushSection();
      currentTitle = "";
      inSearchParameters = false;
      inFilters = true;
      continue;
    }

    const searchHeaderMatch = line.match(/^###\s+(.+)$/);
    if (inSearchParameters && searchHeaderMatch) {
      flushSection();
      currentTitle = searchHeaderMatch[1].trim();
      continue;
    }

    const legacyHeaderMatch = line.match(/^##\s+(.+)$/);
    if (!inSearchParameters && !inFilters && legacyHeaderMatch) {
      flushSection();
      currentTitle = legacyHeaderMatch[1].trim();
      continue;
    }

    if (inFilters) {
      continue;
    }

    if (currentTitle && inSearchParameters) {
      currentLines.push(line);
    } else if (currentTitle && !inFilters) {
      currentLines.push(line);
    }
  }

  flushSection();

  return {
    definitions: sections.filter((item) => Object.keys(item.criteria).length > 0),
    filters: parseFilters(filterSection.split(/\r?\n/)),
  };
}

export async function loadSearchDefinitions(): Promise<SearchDefinition[]> {
  const config = await loadSearchConfig();
  return config.definitions;
}
