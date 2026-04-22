import fs from "node:fs/promises";
import path from "node:path";
import { spawn } from "node:child_process";

import type { SearchDefinition, SearchFilters } from "@/lib/search-config";

export type SearchResult = {
  slug: string;
  title: string;
  criteria: SearchDefinition["criteria"];
  results: Array<Record<string, unknown>>;
  resultCount: number;
  lastUpdated: string;
  error?: string;
};

const CACHE_DIR = path.resolve(process.cwd(), ".cache", "searches");
const PYTHON_PATH = path.resolve(process.cwd(), "../venv/bin/python");
const SCRIPT_PATH = path.resolve(process.cwd(), "scripts", "run_jobspy_search.py");
const CACHE_MAX_AGE_MS = 4 * 60 * 60 * 1000;

const INDUSTRY_RULES: Array<{ label: string; keywords: string[] }> = [
  { label: "AI", keywords: ["artificial intelligence", "machine learning", "llm", "large language model", "generative ai", "prompt engineering", "neural network"] },
  { label: "Videogames", keywords: ["video game", "videogame", "gaming", "game studio", "gameplay", "unity", "unreal engine","AAA"] },
  { label: "Gambling", keywords: ["gambling", "sports betting", "sportsbook", "betting", "casino", "igaming", "wagering"] },
  { label: "Government", keywords: ["civil service", "government", "public sector", "regulatory agency", "ministry", "council"] },
  { label: "Healthcare", keywords: ["healthcare", "hospital", "patient", "medical", "clinical", "pharma", "medicine"] },
  { label: "Finance", keywords: ["bank", "banking", "financial", "insurance", "retirement", "wealth", "pension"] },
  { label: "Travel", keywords: ["travel", "travelling","airline", "loyalty", "holiday", "aviation", "destination"] },
  { label: "Retail", keywords: ["retail", "e-commerce", "ecommerce", "shopper", "merchandise", "consumer goods"] },
  { label: "Logistics", keywords: ["logistics", "fulfilment", "fulfillment", "delivery", "shipping", "supply chain"] },
  { label: "Education", keywords: ["education", "university", "student", "learning", "school", "academic"] },
  { label: "Consulting", keywords: ["consulting", "consultancy", "advisory", "client engagements", "professional services"] },
  { label: "Media", keywords: ["media", "publishing", "journalism", "newsroom", "editorial", "broadcast"] },
  { label: "Telecom", keywords: ["telecom", "telecommunications", "mobile network", "broadband", "connectivity"] },
  { label: "Energy", keywords: ["energy", "utilities", "power grid", "renewable", "electricity", "oil and gas"] },
  { label: "Tech", keywords: ["software", "saas", "platform", "developer tools", "cloud", "technology", "product engineering"] },
];

async function ensureCacheDir(): Promise<void> {
  await fs.mkdir(CACHE_DIR, { recursive: true });
}

function getCachePath(slug: string): string {
  return path.join(CACHE_DIR, `${slug}.json`);
}

async function readCache(slug: string): Promise<SearchResult | null> {
  try {
    const content = await fs.readFile(getCachePath(slug), "utf8");
    return JSON.parse(content) as SearchResult;
  } catch {
    return null;
  }
}

async function writeCache(payload: SearchResult): Promise<void> {
  await ensureCacheDir();
  await fs.writeFile(getCachePath(payload.slug), JSON.stringify(payload, null, 2), "utf8");
}

function isCacheStale(lastUpdated: string): boolean {
  const updatedAt = new Date(lastUpdated).getTime();
  if (Number.isNaN(updatedAt)) {
    return true;
  }

  return Date.now() - updatedAt > CACHE_MAX_AGE_MS;
}

function normalizeText(value: unknown): string {
  return String(value ?? "")
    .trim()
    .replace(/\s+/g, " ")
    .toLowerCase();
}

function dedupeResults(results: Array<Record<string, unknown>>): Array<Record<string, unknown>> {
  const merged = new Map<string, Record<string, unknown>>();

  for (const row of results) {
    const key = `${normalizeText(row.title)}::${normalizeText(row.company)}`;
    const existing = merged.get(key);
    const site = String(row.site ?? "").trim();
    const url = String(row.job_url ?? "").trim();
    const location = String(row.location ?? "").trim();

    if (!existing) {
      const jobLinks = site && url ? [{ site, url, location }] : [];
      merged.set(key, {
        ...row,
        site,
        job_url: jobLinks,
      });
      continue;
    }

    const currentLinks = Array.isArray(existing.job_url)
      ? (existing.job_url as Array<Record<string, string>>)
      : [];
    const hasLink = currentLinks.some((link) => link.site === site && link.url === url);

    if (!hasLink && site && url) {
      currentLinks.push({ site, url, location });
    }

    const existingDescriptionLength = normalizeText(existing.description).length;
    const incomingDescriptionLength = normalizeText(row.description).length;
    const shouldPromoteIncoming = incomingDescriptionLength > existingDescriptionLength;

    const siteNames = new Set(
      [
        ...String(existing.site ?? "")
          .split(",")
          .map((value) => value.trim())
          .filter(Boolean),
        site,
      ].filter(Boolean)
    );

    if (shouldPromoteIncoming) {
      Object.assign(existing, row);
    }

    existing.site = Array.from(siteNames).join(", ");
    existing.job_url = currentLinks;
  }

  return Array.from(merged.values());
}

function applyTitleFilters(
  results: Array<Record<string, unknown>>,
  filters: SearchFilters
): Array<Record<string, unknown>> {
  const includeTerms = filters.includeTitleTerms.map((term) => term.toLowerCase());
  const excludeTerms = filters.excludeTitleTerms.map((term) => term.toLowerCase());

  return results.filter((row) => {
    const title = String(row.title ?? "").toLowerCase();

    if (!title) {
      return false;
    }

    const matchesInclude =
      includeTerms.length === 0 || includeTerms.some((term) => title.includes(term));
    const matchesExclude = excludeTerms.some((term) => title.includes(term));

    return matchesInclude && !matchesExclude;
  });
}

function shouldEnforceRemoteOnly(criteria: SearchDefinition["criteria"]): boolean {
  const remoteSetting = criteria.is_remote;
  if (typeof remoteSetting === "boolean") {
    return remoteSetting;
  }

  return String(remoteSetting ?? "").toLowerCase() === "true";
}

function isRemoteResult(row: Record<string, unknown>): boolean {
  const remoteValue = row.is_remote;
  if (typeof remoteValue === "boolean") {
    return remoteValue;
  }

  const normalized = String(remoteValue ?? "").trim().toLowerCase();
  return normalized === "true" || normalized === "1" || normalized === "yes";
}

function inferIndustryLabel(row: Record<string, unknown>): string {
  const haystack = [
    row.description,
    row.company_description,
    row.company_industry,
    row.title,
    row.company,
  ]
    .map((value) => normalizeText(value))
    .filter(Boolean)
    .join(" \n ");

  if (!haystack) {
    return "";
  }

  for (const rule of INDUSTRY_RULES) {
    if (rule.keywords.some((keyword) => haystack.includes(keyword))) {
      return rule.label;
    }
  }

  return "";
}

function annotateDerivedFields(results: Array<Record<string, unknown>>): Array<Record<string, unknown>> {
  return results.map((row) => ({
    ...row,
    industry_label: inferIndustryLabel(row),
  }));
}

function presentSearchResult(payload: SearchResult, filters: SearchFilters): SearchResult {
  const remoteFilteredResults = shouldEnforceRemoteOnly(payload.criteria)
    ? payload.results.filter((row) => isRemoteResult(row))
    : payload.results;
  const enrichedResults = annotateDerivedFields(remoteFilteredResults);
  const titleFilteredResults = applyTitleFilters(enrichedResults, filters);
  const dedupedResults = dedupeResults(titleFilteredResults);

  return {
    ...payload,
    results: dedupedResults,
    resultCount: dedupedResults.length,
  };
}

async function runPythonSearch(criteria: SearchDefinition["criteria"]): Promise<{
  results: Array<Record<string, unknown>>;
  count: number;
}> {
  return new Promise((resolve, reject) => {
    const child = spawn(PYTHON_PATH, [SCRIPT_PATH], {
      stdio: ["pipe", "pipe", "pipe"],
    });

    let stdout = "";
    let stderr = "";

    child.stdout.on("data", (chunk: Buffer) => {
      stdout += chunk.toString();
    });

    child.stderr.on("data", (chunk: Buffer) => {
      stderr += chunk.toString();
    });

    child.on("error", (error) => reject(error));

    child.on("close", (code) => {
      if (code !== 0) {
        reject(new Error(stderr || stdout || `JobSpy process exited with code ${code}`));
        return;
      }

      try {
        const parsed = JSON.parse(stdout) as {
          results?: Array<Record<string, unknown>>;
          count?: number;
          error?: string;
        };

        if (parsed.error) {
          reject(new Error(parsed.error));
          return;
        }

        resolve({
          results: parsed.results ?? [],
          count: parsed.count ?? 0,
        });
      } catch (error) {
        reject(new Error(`Invalid JSON from JobSpy runner: ${String(error)}`));
      }
    });

    child.stdin.write(JSON.stringify(criteria));
    child.stdin.end();
  });
}

export async function loadOrRunSearch(
  definition: SearchDefinition,
  forceRefresh = false,
  filters: SearchFilters = { includeTitleTerms: [], excludeTitleTerms: [] }
): Promise<SearchResult> {
  let cached: SearchResult | null = null;

  if (!forceRefresh) {
    cached = await readCache(definition.slug);
    if (cached && !isCacheStale(cached.lastUpdated)) {
      return presentSearchResult(cached, filters);
    }
  }

  try {
    const { results, count } = await runPythonSearch(definition.criteria);
    const payload: SearchResult = {
      slug: definition.slug,
      title: definition.title,
      criteria: definition.criteria,
      results,
      resultCount: count,
      lastUpdated: new Date().toISOString(),
    };
    await writeCache(payload);
    return presentSearchResult(payload, filters);
  } catch (error) {
    if (cached) {
      return presentSearchResult(
        {
        ...cached,
        error: String(error),
        },
        filters
      );
    }

    return presentSearchResult({
      slug: definition.slug,
      title: definition.title,
      criteria: definition.criteria,
      results: [],
      resultCount: 0,
      lastUpdated: new Date().toISOString(),
      error: String(error),
    }, filters);
  }
}
