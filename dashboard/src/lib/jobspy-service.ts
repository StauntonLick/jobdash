import fs from "node:fs/promises";
import path from "node:path";
import { spawn } from "node:child_process";

import type { SearchDefinition, SearchFilters } from "@/lib/search-config";
import { INDUSTRY_LABELS } from "@/lib/industry-labels";

export type SearchResult = {
  slug: string;
  title: string;
  criteria: SearchDefinition["criteria"];
  results: Array<Record<string, unknown>>;
  resultCount: number;
  lastUpdated: string;
  error?: string;
  debug?: SearchDebugStats;
};

type SearchDebugStats = {
  rawCount: number;
  remoteFilteredCount: number;
  titleFilteredCount: number;
  dedupedCount: number;
  finalCount: number;
  excludedByRemoteFilter: number;
  excludedByTitleFilter: number;
  removedByDedupe: number;
  includedByLinkedInRemoteFallback: number;
};

const CACHE_DIR = path.resolve(process.cwd(), ".cache", "searches");
const STATUS_STORE_PATH = path.resolve(process.cwd(), ".cache", "job-statuses.json");
const INDUSTRY_OVERRIDE_STORE_PATH = path.resolve(process.cwd(), ".cache", "job-industry-overrides.json");
const SCRIPT_PATH = path.resolve(process.cwd(), "scripts", "run_jobspy_search.py");
const CACHE_MAX_AGE_MS = 4 * 60 * 60 * 1000;
const PYTHON_PATH_CANDIDATES = [
  process.env.JOBDASH_PYTHON,
  path.resolve(process.cwd(), "../venv/bin/python"),
  path.resolve(process.cwd(), "../.venv/bin/python"),
  path.resolve(process.cwd(), "venv/bin/python"),
  path.resolve(process.cwd(), ".venv/bin/python"),
  "python3",
  "python",
].filter((value): value is string => Boolean(value && value.trim()));

let resolvedPythonPath: string | null = null;

export const JOB_STATUS_VALUES = ["New", "Skipped", "Applied", "Shortlist", "Longlist"] as const;
export type JobStatus = (typeof JOB_STATUS_VALUES)[number];

const INDUSTRY_RULES: Array<{ label: string; keywords: string[] }> = [
  { label: "AI", keywords: ["artificial intelligence", "machine learning", "llm", "large language model", "generative ai", "prompt engineering", "neural network"] },
  { label: "Videogames", keywords: ["video game", "videogame", "gaming", "game studio", "gameplay", "unity", "unreal engine","AAA"] },
  { label: "Gambling", keywords: ["gambling", "sports betting", "sportsbook", "betting", "casino", "igaming", "wagering"] },
  { label: "Government", keywords: ["civil service", "government", "public sector", "regulatory agency", "ministry", "council"] },
  { label: "Healthcare", keywords: ["healthcare", "hospital", "patient", "medical", "clinical", "pharma", "medicine"] },
  { label: "Finance", keywords: ["bank", "banking", "financial", "insurance", "retirement", "wealth", "pension"] },
  { label: "Travel", keywords: ["travel", "travelling","airline", "loyalty", "holiday", "aviation", "destination","transport","bus","train"] },
  { label: "Retail", keywords: ["retail", "e-commerce", "ecommerce", "shopper", "merchandise", "consumer goods"] },
  { label: "Logistics", keywords: ["logistics", "fulfilment", "fulfillment", "delivery", "shipping", "supply chain"] },
  { label: "Education", keywords: ["education", "university", "student", "learning", "school", "academic"] },
  { label: "Consulting", keywords: ["consulting", "consultancy", "advisory","clients","client","client engagements", "professional services","agency"] },
  { label: "Media", keywords: ["media", "publishing", "journalism", "newsroom", "editorial", "broadcast"] },
  { label: "Telecom", keywords: ["telecom", "telecommunications", "mobile network", "broadband", "connectivity"] },
  { label: "Energy", keywords: ["energy", "utilities", "power grid", "renewable", "electricity", "oil and gas"] },
  { label: "Tech", keywords: ["software", "saas", "platform", "developer tools", "cloud", "technology", "product engineering"] },
];

export { INDUSTRY_LABELS };

const INDUSTRY_SCORE_WEIGHTS = {
  companyIndustry: 6,
  companyDescription: 4,
  title: 3,
  description: 1,
} as const;

const MIN_INDUSTRY_SCORE = 3;
const MIN_INDUSTRY_MARGIN = 2;

const BENEFITS_SECTION_HINTS = [
  "benefits",
  "perks",
  "what we offer",
  "compensation",
  "health insurance",
  "private healthcare",
  "medical insurance",
  "pension",
  "retirement plan",
  "wellness",
];

const LINKEDIN_REMOTE_HINTS = [
  "remote",
  "uk remote",
  "work from home",
  "wfh",
  "home based",
  "anywhere in the uk",
  "united kingdom (remote)",
];

async function ensureCacheDir(): Promise<void> {
  await fs.mkdir(CACHE_DIR, { recursive: true });
}

function isJobStatus(value: unknown): value is JobStatus {
  return JOB_STATUS_VALUES.includes(value as JobStatus);
}

function buildStatusKey(row: Record<string, unknown>): string {
  return `${normalizeText(row.title)}::${normalizeText(row.company)}`;
}

async function readStatusStore(): Promise<Record<string, JobStatus>> {
  try {
    const content = await fs.readFile(STATUS_STORE_PATH, "utf8");
    const parsed = JSON.parse(content) as Record<string, unknown>;

    const normalized: Record<string, JobStatus> = {};
    for (const [key, value] of Object.entries(parsed)) {
      if (isJobStatus(value)) {
        normalized[key] = value;
      }
    }

    return normalized;
  } catch {
    return {};
  }
}

async function writeStatusStore(statuses: Record<string, JobStatus>): Promise<void> {
  await ensureCacheDir();
  await fs.writeFile(STATUS_STORE_PATH, JSON.stringify(statuses, null, 2), "utf8");
}

export async function saveJobStatus(statusKey: string, status: JobStatus): Promise<void> {
  const normalizedKey = normalizeText(statusKey);
  if (!normalizedKey || !isJobStatus(status)) {
    throw new Error("Invalid status payload.");
  }

  const currentStatuses = await readStatusStore();
  currentStatuses[normalizedKey] = status;
  await writeStatusStore(currentStatuses);
}

function isValidIndustryLabel(value: unknown): value is string {
  const normalized = String(value ?? "").trim();
  return INDUSTRY_LABELS.includes(normalized as typeof INDUSTRY_LABELS[number]);
}

async function readIndustryOverrideStore(): Promise<Record<string, string>> {
  try {
    const content = await fs.readFile(INDUSTRY_OVERRIDE_STORE_PATH, "utf8");
    return JSON.parse(content) as Record<string, string>;
  } catch {
    return {};
  }
}

async function writeIndustryOverrideStore(overrides: Record<string, string>): Promise<void> {
  await ensureCacheDir();
  await fs.writeFile(INDUSTRY_OVERRIDE_STORE_PATH, JSON.stringify(overrides, null, 2), "utf8");
}

export async function saveIndustryOverride(statusKey: string, industry: string | null): Promise<void> {
  const normalizedKey = normalizeText(statusKey);
  if (!normalizedKey) {
    throw new Error("Invalid status key.");
  }

  if (industry !== null && !isValidIndustryLabel(industry)) {
    throw new Error("Invalid industry label.");
  }

  const currentOverrides = await readIndustryOverrideStore();
  
  if (industry === null) {
    delete currentOverrides[normalizedKey];
  } else {
    currentOverrides[normalizedKey] = industry;
  }
  
  await writeIndustryOverrideStore(currentOverrides);
}

async function canAccessPath(filePath: string): Promise<boolean> {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}

async function hasRequiredPythonDeps(pythonExecutable: string): Promise<boolean> {
  return new Promise((resolve) => {
    const child = spawn(
      pythonExecutable,
      ["-c", "import jobspy; import pandas"],
      { stdio: "ignore" }
    );

    child.on("error", () => resolve(false));
    child.on("close", (code) => resolve(code === 0));
  });
}

function uniqueValues(values: string[]): string[] {
  const seen = new Set<string>();
  const unique: string[] = [];

  for (const value of values) {
    const normalized = value.trim();
    if (!normalized || seen.has(normalized)) {
      continue;
    }
    seen.add(normalized);
    unique.push(normalized);
  }

  return unique;
}

async function resolvePythonPath(): Promise<string> {
  if (resolvedPythonPath) {
    return resolvedPythonPath;
  }

  const checkedCandidates: string[] = [];

  for (const candidate of uniqueValues(PYTHON_PATH_CANDIDATES)) {
    if (path.isAbsolute(candidate)) {
      const exists = await canAccessPath(candidate);
      if (!exists) {
        continue;
      }
    }

    checkedCandidates.push(candidate);

    const hasDeps = await hasRequiredPythonDeps(candidate);
    if (!hasDeps) {
      continue;
    }

    resolvedPythonPath = candidate;
    return candidate;
  }

  throw new Error(
    [
      "Unable to find a working Python interpreter for JobDash.",
      `Checked: ${checkedCandidates.join(", ") || "(none)"}`,
      "Expected packages: python-jobspy, pandas.",
      "Run ../scripts/setup-python.sh from the dashboard folder, or set JOBDASH_PYTHON to a Python executable with those packages installed.",
    ].join(" ")
  );
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

function matchesWholeKeyword(haystack: string, keyword: string): boolean {
  const normalizedKeyword = normalizeText(keyword);
  if (!normalizedKeyword) {
    return false;
  }

  // Split haystack into words and check for exact matches
  // This avoids regex complexity and is more reliable
  const words = haystack.split(/[^a-z0-9]+/).filter(Boolean);
  
  // For multi-word phrases, check if the haystack contains the phrase with word boundaries
  if (normalizedKeyword.includes(" ")) {
    // Use regex with properly escaped special chars for phrase matching
    const escapedKeyword = normalizedKeyword.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    try {
      const pattern = new RegExp(`(?:^|[^a-z0-9])${escapedKeyword}(?:[^a-z0-9]|$)`);
      return pattern.test(haystack);
    } catch {
      // If regex fails, fall back to substring check
      return haystack.includes(normalizedKeyword);
    }
  }
  
  // For single words, check if it's in the word list
  return words.includes(normalizedKeyword);
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

// Remove any jobs from companies that appear in the blacklist (case-insensitive).
function applyCompanyBlacklist(
  results: Array<Record<string, unknown>>,
  filters: SearchFilters
): Array<Record<string, unknown>> {
  const blacklist = (filters.blacklistCompanies ?? []).map((name) => name.toLowerCase());
  if (blacklist.length === 0) return results;

  return results.filter((row) => {
    const company = String(row.company ?? "").toLowerCase();
    return !blacklist.some((name) => company.includes(name));
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

function isLinkedInResult(row: Record<string, unknown>): boolean {
  return normalizeText(row.site) === "linkedin";
}

function isLikelyLinkedInRemote(row: Record<string, unknown>): boolean {
  if (!isLinkedInResult(row)) {
    return false;
  }

  const normalizedLocation = normalizeText(row.location);
  // LinkedIn often returns remote jobs with no explicit location text.
  if (!normalizedLocation) {
    return true;
  }

  const searchableText = [
    row.title,
    row.location,
    row.description,
    row.job_type,
    row.work_from_home_type,
  ]
    .map((value) => normalizeText(value))
    .filter(Boolean)
    .join(" ");

  if (!searchableText) {
    return false;
  }

  return LINKEDIN_REMOTE_HINTS.some((hint) => searchableText.includes(hint));
}

function normalizeSearchCriteria(
  criteria: SearchDefinition["criteria"]
): SearchDefinition["criteria"] {
  const normalized = { ...criteria };
  const isRemote = shouldEnforceRemoteOnly(normalized);

  if (isRemote) {
    const countryIndeed = String(normalized.country_indeed ?? "").trim().toLowerCase();

    // JobSpy expects a valid country name/code; "remote" is not accepted.
    if (countryIndeed === "remote" || countryIndeed === "") {
      normalized.country_indeed = "UK";
    }
  }

  return normalized;
}

function inferIndustryLabel(row: Record<string, unknown>): string {
  const title = normalizeText(row.title);
  const company = normalizeText(row.company);
  const companyIndustry = normalizeText(row.company_industry);
  const companyDescription = normalizeText(row.company_description);
  const descriptionRaw = String(row.description ?? "");

  // Keep source line boundaries so benefits filtering only removes relevant lines.
  const descriptionWithoutBenefits = descriptionRaw
    .split("\n")
    .map((line) => normalizeText(line))
    .filter((line) =>
      line.length > 0 &&
      !BENEFITS_SECTION_HINTS.some((hint) => line.includes(hint))
    )
    .join(" \n ");

  if (!title && !company && !companyIndustry && !companyDescription && !descriptionWithoutBenefits) {
    return "";
  }

  const scoredRules = INDUSTRY_RULES.map((rule) => {
    const titleMatches = rule.keywords.filter((keyword) => matchesWholeKeyword(title, keyword)).length;
    const companyMatches = rule.keywords.filter((keyword) => matchesWholeKeyword(company, keyword)).length;
    const companyIndustryMatches = rule.keywords.filter((keyword) => matchesWholeKeyword(companyIndustry, keyword)).length;
    const companyDescriptionMatches = rule.keywords.filter((keyword) => matchesWholeKeyword(companyDescription, keyword)).length;
    const descriptionMatches = rule.keywords.filter((keyword) => matchesWholeKeyword(descriptionWithoutBenefits, keyword)).length;

    const score =
      titleMatches * INDUSTRY_SCORE_WEIGHTS.title +
      companyMatches * INDUSTRY_SCORE_WEIGHTS.title +
      companyIndustryMatches * INDUSTRY_SCORE_WEIGHTS.companyIndustry +
      companyDescriptionMatches * INDUSTRY_SCORE_WEIGHTS.companyDescription +
      descriptionMatches * INDUSTRY_SCORE_WEIGHTS.description;

    return {
      label: rule.label,
      score,
    };
  }).sort((a, b) => b.score - a.score);

  const top = scoredRules[0];
  const second = scoredRules[1];

  if (!top || top.score < MIN_INDUSTRY_SCORE) {
    return "";
  }

  const margin = second ? top.score - second.score : top.score;
  if (margin < MIN_INDUSTRY_MARGIN) {
    return "";
  }

  return top.label;
}

function annotateDerivedFields(results: Array<Record<string, unknown>>): Array<Record<string, unknown>> {
  return results.map((row) => ({
    ...row,
    status_key: buildStatusKey(row),
    industry_label: inferIndustryLabel(row),
  }));
}

function applyStoredStatuses(
  results: Array<Record<string, unknown>>,
  statuses: Record<string, JobStatus>
): Array<Record<string, unknown>> {
  return results.map((row) => {
    const statusKey = String(row.status_key ?? buildStatusKey(row));
    const storedStatus = statuses[statusKey];

    return {
      ...row,
      status_key: statusKey,
      job_status: storedStatus ?? "New",
    };
  });
}

function applyStoredIndustryOverrides(
  results: Array<Record<string, unknown>>,
  overrides: Record<string, string>
): Array<Record<string, unknown>> {
  return results.map((row) => {
    const statusKey = String(row.status_key ?? buildStatusKey(row));
    const storedOverride = overrides[statusKey];

    return {
      ...row,
      industry_label: storedOverride ?? row.industry_label,
    };
  });
}

async function presentSearchResult(
  payload: SearchResult,
  filters: SearchFilters,
  includeDebug = false
): Promise<SearchResult> {
  let linkedInRemoteFallbackCount = 0;
  const rawResults = payload.results;
  const remoteFilteredResults = shouldEnforceRemoteOnly(payload.criteria)
    ? rawResults.filter((row) => {
        if (isRemoteResult(row)) {
          return true;
        }

        if (isLikelyLinkedInRemote(row)) {
          linkedInRemoteFallbackCount += 1;
          return true;
        }

        return false;
      })
    : rawResults;
  const enrichedResults = annotateDerivedFields(remoteFilteredResults);
  const titleFilteredResults = applyTitleFilters(enrichedResults, filters);
  const blacklistFilteredResults = applyCompanyBlacklist(titleFilteredResults, filters);
  const dedupedResults = dedupeResults(blacklistFilteredResults);
  const statuses = await readStatusStore();
  const resultsWithStatus = applyStoredStatuses(dedupedResults, statuses);
  const industryOverrides = await readIndustryOverrideStore();
  const resultsWithIndustry = applyStoredIndustryOverrides(resultsWithStatus, industryOverrides);

  const debug: SearchDebugStats | undefined = includeDebug
    ? {
        rawCount: rawResults.length,
        remoteFilteredCount: remoteFilteredResults.length,
        titleFilteredCount: titleFilteredResults.length,
        dedupedCount: dedupedResults.length,
        finalCount: resultsWithIndustry.length,
        excludedByRemoteFilter: rawResults.length - remoteFilteredResults.length,
        excludedByTitleFilter: remoteFilteredResults.length - titleFilteredResults.length,
        removedByDedupe: blacklistFilteredResults.length - dedupedResults.length,
        includedByLinkedInRemoteFallback: linkedInRemoteFallbackCount,
      }
    : undefined;

  return {
    ...payload,
    results: resultsWithIndustry,
    resultCount: resultsWithIndustry.length,
    ...(debug ? { debug } : {}),
  };
}

async function runPythonSearch(criteria: SearchDefinition["criteria"]): Promise<{
  results: Array<Record<string, unknown>>;
  count: number;
}> {
  const pythonPath = await resolvePythonPath();
  const normalizedCriteria = normalizeSearchCriteria(criteria);

  return new Promise((resolve, reject) => {
    const child = spawn(pythonPath, [SCRIPT_PATH], {
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

    child.stdin.write(JSON.stringify(normalizedCriteria));
    child.stdin.end();
  });
}

export async function loadOrRunSearch(
  definition: SearchDefinition,
  forceRefresh = false,
  filters: SearchFilters = { includeTitleTerms: [], excludeTitleTerms: [], blacklistCompanies: [] },
  includeDebug = false
): Promise<SearchResult> {
  let cached: SearchResult | null = null;

  if (!forceRefresh) {
    cached = await readCache(definition.slug);
    if (cached && !isCacheStale(cached.lastUpdated)) {
      return await presentSearchResult(cached, filters, includeDebug);
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
    return await presentSearchResult(payload, filters, includeDebug);
  } catch (error) {
    if (cached) {
      return await presentSearchResult(
        {
        ...cached,
        error: String(error),
        },
        filters,
        includeDebug
      );
    }

    return await presentSearchResult({
      slug: definition.slug,
      title: definition.title,
      criteria: definition.criteria,
      results: [],
      resultCount: 0,
      lastUpdated: new Date().toISOString(),
      error: String(error),
    }, filters, includeDebug);
  }
}
