import fs from "node:fs/promises";
import path from "node:path";
import { spawn } from "node:child_process";

import type { SearchDefinition } from "@/lib/search-config";
import { INDUSTRY_LABELS } from "@/lib/industry-labels";
import { SENIORITY_LABELS } from "@/lib/seniority-labels";
import type { SeniorityLabel } from "@/lib/seniority-labels";

export type SearchResult = {
  slug: string;
  title: string;
  criteria: SearchDefinition["criteria"];
  results: Array<Record<string, unknown>>;
  rawResultCount: number;
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

const CACHE_BASE = path.resolve(process.cwd(), process.env.JOBDASH_CACHE_DIR ?? ".cache");
const CACHE_DIR = path.join(CACHE_BASE, "searches");
const ARCHIVE_DIR = path.join(CACHE_BASE, "searches-archive");
const STATUS_STORE_PATH = path.join(CACHE_BASE, "job-statuses.json");
const INDUSTRY_OVERRIDE_STORE_PATH = path.join(CACHE_BASE, "job-industry-overrides.json");
const SENIORITY_OVERRIDE_STORE_PATH = path.join(CACHE_BASE, "job-seniority-overrides.json");
const SCRIPT_PATH = path.resolve(process.cwd(), "scripts", "run_jobspy_search.py");
const DESCRIPTION_FETCH_SCRIPT_PATH = path.resolve(process.cwd(), "scripts", "fetch_job_description.py");
const DESCRIPTION_CACHE_PATH = path.join(CACHE_BASE, "job-descriptions.json");
const CACHE_MAX_AGE_MS = 4 * 60 * 60 * 1000;
const CACHE_RETENTION_DAYS = 14;
const REFRESH_OVERLAP_HOURS = 4;
const GLASSDOOR_MAX_RETRIES_ON_ZERO = 4;
const GLASSDOOR_RETRY_BASE_DELAY_MS = 2000;
const LINKEDIN_MIN_RUNS = 2;
const LINKEDIN_MAX_RUNS = 2;
const SITE_PARALLELISM = Math.max(
  1,
  Number(process.env.JOBDASH_SITE_PARALLELISM ?? "2") || 2
);
const DESCRIPTION_FETCH_DELAY_MS = 500;
const PYTHON_SEARCH_TIMEOUT_MS = Number(process.env.JOBDASH_PYTHON_SEARCH_TIMEOUT_MS ?? "180000");
const PYTHON_SEARCH_KILL_GRACE_MS = 5000;
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
let descriptionCache: Record<string, string> | null = null;
let descriptionCacheWrite: Promise<void> = Promise.resolve();
let isDescriptionQueueRunning = false;
const descriptionQueue: Array<{ site: string; url: string }> = [];
const queuedDescriptionKeys = new Set<string>();
const inFlightDescriptionFetches = new Map<string, Promise<string>>();

export const JOB_STATUS_VALUES = ["New", "Skipped", "Applied", "Shortlist", "Longlist"] as const;
export type JobStatus = (typeof JOB_STATUS_VALUES)[number];

const INDUSTRY_RULES: Array<{ label: string; keywords: string[] }> = [
  { label: "AI", keywords: ["artificial intelligence", "machine learning", "llm", "large language model", "generative ai", "prompt engineering", "neural network", "AI companion"] },
  { label: "Videogames", keywords: ["video game", "videogame", "gaming", "game studio", "gameplay", "unity", "unreal engine","AAA", "godot", "player"] },
  { label: "Gambling", keywords: ["gambling", "sports betting", "sportsbook", "betting", "casino", "igaming", "wagering", "iGaming"] },
  { label: "Government", keywords: ["civil service", "government", "public sector", "regulatory agency", "ministry", "council", "HMRC"] },
  { label: "Healthcare", keywords: ["health", "healthcare", "hospital", "patient", "medical", "clinical", "pharma", "medicine", "dental", "dentist"] },
  { label: "Finance", keywords: ["money", "bank", "banking", "financial", "insurance", "retirement", "wealth", "pension"] },
  { label: "Travel", keywords: ["travel", "travelling","airline", "flights", "loyalty", "holiday", "aviation", "destination","transport","bus","train"] },
  { label: "Retail", keywords: ["retail", "e-commerce", "ecommerce", "shopper", "merchandise", "consumer goods"] },
  { label: "Logistics", keywords: ["logistics", "fulfilment", "fulfillment", "delivery", "shipping", "supply chain"] },
  { label: "Education", keywords: ["education", "university", "student", "learning", "school", "academic"] },
  { label: "Consulting", keywords: ["consulting", "consultancy", "advisory","clients","client","client engagements", "professional services","agency"] },
  { label: "Media", keywords: ["media", "publishing", "journalism", "newsroom", "editorial", "broadcast"] },
  { label: "Telecom", keywords: ["telecom", "telecommunications", "mobile network", "broadband", "connectivity"] },
  { label: "Energy", keywords: ["energy", "utilities", "power grid", "renewable", "electricity", "oil and gas", "green"] },
  { label: "Tech", keywords: ["software", "saas", "platform", "developer tools", "cloud", "technology", "product engineering"] },
  { label: "Property", keywords: ["real estate", "property", "housing", "residential", "proptech", "estate agency", "estate agencies", "letting", "lettings", "landlord", "tenant",],},
];

export { INDUSTRY_LABELS };
export { SENIORITY_LABELS };

const INDUSTRY_SCORE_WEIGHTS = {
  companyIndustry: 6,
  companyDescription: 4,
  title: 3,
  description: 1,
} as const;

const MIN_INDUSTRY_SCORE = 3;
const MIN_INDUSTRY_MARGIN = 2;

const SENIORITY_RULES: Array<{ label: SeniorityLabel; keywords: string[] }> = [
  { label: "Intern",    keywords: ["intern", "internship"] },
  { label: "Junior",    keywords: ["junior", "jnr", "associate"] },
  { label: "Mid",       keywords: ["mid", "mid-weight"] },
  { label: "Senior",    keywords: ["senior", "snr"] },
  { label: "Principal", keywords: ["principal"] },
  { label: "Lead",      keywords: ["lead"] },
  { label: "Manager",   keywords: ["director", "head of", "manager"] },
];

// Sentences containing these phrases are stripped from the description before
// seniority keyword matching, to avoid picking up team-structure descriptions
// like "reporting to a Senior Manager" or "working with Junior developers".
const SENIORITY_CONTEXT_EXCLUSION_PHRASES = [
  "reporting to",
  "reports to",
  "report to",
  "working with",
  "working alongside",
  "managed by",
  "you will work with",
  "you'll work with",
  "partnering with",
  "collaborating with",
  "works with",
];

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

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
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

function isValidSeniorityLabel(value: unknown): value is SeniorityLabel {
  const normalized = String(value ?? "").trim();
  return SENIORITY_LABELS.includes(normalized as SeniorityLabel);
}

async function readSeniorityOverrideStore(): Promise<Record<string, string>> {
  try {
    const content = await fs.readFile(SENIORITY_OVERRIDE_STORE_PATH, "utf8");
    return JSON.parse(content) as Record<string, string>;
  } catch {
    return {};
  }
}

async function writeSeniorityOverrideStore(overrides: Record<string, string>): Promise<void> {
  await ensureCacheDir();
  await fs.writeFile(SENIORITY_OVERRIDE_STORE_PATH, JSON.stringify(overrides, null, 2), "utf8");
}

export async function saveSeniorityOverride(statusKey: string, seniority: string | null): Promise<void> {
  const normalizedKey = normalizeText(statusKey);
  if (!normalizedKey) {
    throw new Error("Invalid status key.");
  }

  if (seniority !== null && !isValidSeniorityLabel(seniority)) {
    throw new Error("Invalid seniority label.");
  }

  const currentOverrides = await readSeniorityOverrideStore();

  if (seniority === null) {
    delete currentOverrides[normalizedKey];
  } else {
    currentOverrides[normalizedKey] = seniority;
  }

  await writeSeniorityOverrideStore(currentOverrides);
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

function normalizeDescriptionSite(site: unknown): string {
  const normalized = String(site ?? "").trim().toLowerCase();
  if (!normalized) {
    return "";
  }

  if (normalized.includes(",")) {
    return normalized
      .split(",")
      .map((value) => value.trim())
      .find(Boolean) ?? "";
  }

  return normalized;
}

function buildDescriptionCacheKey(site: string, url: string): string {
  return `${normalizeDescriptionSite(site)}::${String(url).trim()}`;
}

function extractPrimaryJobLink(row: Record<string, unknown>): { site: string; url: string } | null {
  const links = row.job_url;
  if (Array.isArray(links)) {
    for (const entry of links) {
      if (!entry || typeof entry !== "object") {
        continue;
      }

      const site = normalizeDescriptionSite((entry as Record<string, unknown>).site);
      const url = String((entry as Record<string, unknown>).url ?? "").trim();
      if (site && url) {
        return { site, url };
      }
    }
  }

  const fallbackUrl = String(row.job_url ?? "").trim();
  const fallbackSite = normalizeDescriptionSite(row.site);
  if (fallbackSite && fallbackUrl) {
    return { site: fallbackSite, url: fallbackUrl };
  }

  return null;
}

async function readDescriptionCache(): Promise<Record<string, string>> {
  if (descriptionCache) {
    return descriptionCache;
  }

  try {
    const content = await fs.readFile(DESCRIPTION_CACHE_PATH, "utf8");
    const parsed = JSON.parse(content) as Record<string, unknown>;
    const normalized: Record<string, string> = {};

    for (const [key, value] of Object.entries(parsed)) {
      const text = String(value ?? "").trim();
      if (!text) {
        continue;
      }
      normalized[key] = text;
    }

    descriptionCache = normalized;
    return normalized;
  } catch {
    // Don't cache a failed read — leave descriptionCache as null so the next
    // request retries the file, e.g. if the file was copied in after startup.
    return {};
  }
}

async function writeDescriptionCache(): Promise<void> {
  const current = await readDescriptionCache();
  await ensureCacheDir();
  await fs.writeFile(DESCRIPTION_CACHE_PATH, JSON.stringify(current, null, 2), "utf8");
}

function queueDescriptionCacheWrite(): void {
  descriptionCacheWrite = descriptionCacheWrite
    .then(() => writeDescriptionCache())
    .catch(() => undefined);
}

async function getCachedDescription(site: string, url: string): Promise<string> {
  const cache = await readDescriptionCache();
  const key = buildDescriptionCacheKey(site, url);
  return String(cache[key] ?? "");
}

async function setCachedDescription(site: string, url: string, description: string): Promise<void> {
  const normalizedDescription = String(description ?? "").trim();
  if (!normalizedDescription) {
    return;
  }

  const cache = await readDescriptionCache();
  const key = buildDescriptionCacheKey(site, url);
  if (cache[key] === normalizedDescription) {
    return;
  }

  cache[key] = normalizedDescription;
  queueDescriptionCacheWrite();
}

async function fetchDescriptionWithPython(site: string, url: string): Promise<string> {
  const pythonPath = await resolvePythonPath();

  return new Promise((resolve) => {
    const child = spawn(pythonPath, [DESCRIPTION_FETCH_SCRIPT_PATH], {
      stdio: ["pipe", "pipe", "pipe"],
    });

    let stdout = "";

    child.stdout.on("data", (chunk: Buffer) => {
      stdout += chunk.toString();
    });

    child.on("error", () => resolve(""));

    child.on("close", () => {
      try {
        const parsed = JSON.parse(stdout) as { description?: string };
        resolve(String(parsed.description ?? "").trim());
      } catch {
        resolve("");
      }
    });

    child.stdin.write(JSON.stringify({ site, url }));
    child.stdin.end();
  });
}

async function fetchAndCacheDescription(site: string, url: string): Promise<string> {
  const key = buildDescriptionCacheKey(site, url);
  const inFlight = inFlightDescriptionFetches.get(key);
  if (inFlight) {
    return await inFlight;
  }

  const task = (async () => {
    const cached = await getCachedDescription(site, url);
    if (cached) {
      return cached;
    }

    const fetched = await fetchDescriptionWithPython(site, url);
    if (fetched) {
      await setCachedDescription(site, url, fetched);
    }

    return fetched;
  })();

  inFlightDescriptionFetches.set(key, task);

  try {
    return await task;
  } finally {
    inFlightDescriptionFetches.delete(key);
  }
}

function queueDescriptionFetch(site: string, url: string): void {
  const key = buildDescriptionCacheKey(site, url);
  if (!site || !url || queuedDescriptionKeys.has(key)) {
    return;
  }

  queuedDescriptionKeys.add(key);
  descriptionQueue.push({ site, url });
}

async function startDescriptionQueueWorker(): Promise<void> {
  if (isDescriptionQueueRunning) {
    return;
  }

  isDescriptionQueueRunning = true;
  try {
    while (descriptionQueue.length > 0) {
      const next = descriptionQueue.shift();
      if (!next) {
        continue;
      }

      const key = buildDescriptionCacheKey(next.site, next.url);
      queuedDescriptionKeys.delete(key);
      await fetchAndCacheDescription(next.site, next.url);
      await sleep(DESCRIPTION_FETCH_DELAY_MS);
    }
  } finally {
    isDescriptionQueueRunning = false;
  }
}

async function hydrateDescriptionsFromCache(
  results: Array<Record<string, unknown>>
): Promise<Array<Record<string, unknown>>> {
  if (results.length === 0) {
    return results;
  }

  const cache = await readDescriptionCache();
  let didChange = false;

  const hydrated = results.map((row) => {
    const link = extractPrimaryJobLink(row);
    if (!link) {
      return row;
    }

    // Prefer the cached (full) description over whatever the scraper provided,
    // since the scraper version is often truncated. Only fall back to the
    // scraper description if the cache has nothing for this URL.
    const key = buildDescriptionCacheKey(link.site, link.url);
    const cachedDescription = String(cache[key] ?? "").trim();
    if (!cachedDescription) {
      return row;
    }

    const existingDescription = String(row.description ?? "").trim();
    if (existingDescription === cachedDescription) {
      return row;
    }

    didChange = true;
    return {
      ...row,
      description: cachedDescription,
    };
  });

  return didChange ? hydrated : results;
}

function enqueueDescriptionFetches(results: Array<Record<string, unknown>>): void {
  for (const row of results) {
    const existingDescription = String(row.description ?? "").trim();
    if (existingDescription) {
      continue;
    }

    const link = extractPrimaryJobLink(row);
    if (!link) {
      continue;
    }

    queueDescriptionFetch(link.site, link.url);
  }

  void startDescriptionQueueWorker();
}

export async function getJobDescription(site: string, url: string): Promise<string> {
  const normalizedSite = normalizeDescriptionSite(site);
  const normalizedUrl = String(url ?? "").trim();
  if (!normalizedSite || !normalizedUrl) {
    return "";
  }

  return await fetchAndCacheDescription(normalizedSite, normalizedUrl);
}

export async function getCachedDescriptionsBatch(
  jobs: Array<{ site: string; url: string }>
): Promise<Record<string, string>> {
  const cache = await readDescriptionCache();
  const result: Record<string, string> = {};
  for (const { site, url } of jobs) {
    const key = buildDescriptionCacheKey(site, url);
    if (cache[key]) {
      result[key] = cache[key];
    }
  }
  return result;
}

function getCachePath(slug: string): string {
  return path.join(CACHE_DIR, `${slug}.json`);
}

function getArchivePath(slug: string): string {
  return path.join(ARCHIVE_DIR, `${slug}.json`);
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

type SearchArchive = {
  slug: string;
  title: string;
  lastUpdated: string;
  results: Array<Record<string, unknown>>;
};

async function readArchive(slug: string): Promise<SearchArchive | null> {
  try {
    const content = await fs.readFile(getArchivePath(slug), "utf8");
    return JSON.parse(content) as SearchArchive;
  } catch {
    return null;
  }
}

async function writeArchive(payload: SearchArchive): Promise<void> {
  await fs.mkdir(ARCHIVE_DIR, { recursive: true });
  await fs.writeFile(getArchivePath(payload.slug), JSON.stringify(payload, null, 2), "utf8");
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

function normalizeSites(rawSiteName: unknown): string[] {
  if (rawSiteName == null) {
    return [];
  }

  if (Array.isArray(rawSiteName)) {
    return rawSiteName
      .map((site) => String(site).trim().toLowerCase())
      .filter(Boolean);
  }

  const value = String(rawSiteName).trim().toLowerCase();
  return value ? [value] : [];
}

function normalizeHoursOld(value: unknown): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? Math.ceil(parsed) : 24;
}

function getIncrementalHours(criteria: SearchDefinition["criteria"], lastUpdated?: string): number {
  const defaultHours = normalizeHoursOld(criteria.hours_old);
  if (!lastUpdated) {
    return defaultHours;
  }

  const lastUpdatedMs = new Date(lastUpdated).getTime();
  if (!Number.isFinite(lastUpdatedMs)) {
    return defaultHours;
  }

  const elapsedHours = Math.max(0, (Date.now() - lastUpdatedMs) / (60 * 60 * 1000));
  return Math.max(1, Math.ceil(elapsedHours + REFRESH_OVERLAP_HOURS));
}

function getRowSites(row: Record<string, unknown>): string[] {
  const sites = new Set<string>();

  const siteField = String(row.site ?? "");
  for (const part of siteField.split(",")) {
    const normalized = part.trim().toLowerCase();
    if (normalized) {
      sites.add(normalized);
    }
  }

  if (Array.isArray(row.job_url)) {
    for (const link of row.job_url) {
      if (!link || typeof link !== "object") {
        continue;
      }
      const linkSite = String((link as Record<string, unknown>).site ?? "").trim().toLowerCase();
      if (linkSite) {
        sites.add(linkSite);
      }
    }
  }

  return Array.from(sites);
}

function hasRowsForSite(rows: Array<Record<string, unknown>>, site: string): boolean {
  const normalizedSite = site.trim().toLowerCase();
  return rows.some((row) => getRowSites(row).includes(normalizedSite));
}

function buildResultIdentity(row: Record<string, unknown>): string {
  const primaryLink = extractPrimaryJobLink(row);
  if (primaryLink) {
    return `${normalizeText(primaryLink.site)}::${normalizeText(primaryLink.url)}`;
  }

  return [
    normalizeText(row.site),
    normalizeText(row.title),
    normalizeText(row.company),
    normalizeText(row.location),
  ].join("::");
}

function mergeSiteNames(existingSite: unknown, incomingSite: unknown): string {
  const parts = [
    ...String(existingSite ?? "")
      .split(",")
      .map((value) => value.trim())
      .filter(Boolean),
    ...String(incomingSite ?? "")
      .split(",")
      .map((value) => value.trim())
      .filter(Boolean),
  ];

  return Array.from(new Set(parts)).join(", ");
}

function parseIsoTimestamp(value: unknown): Date | null {
  const raw = String(value ?? "").trim();
  if (!raw) {
    return null;
  }

  const parsed = new Date(raw);
  return Number.isFinite(parsed.getTime()) ? parsed : null;
}

function resolveFirstSeenAt(
  existingFirstSeen: unknown,
  incomingFirstSeen: unknown,
  fallbackIso: string
): string {
  const existing = parseIsoTimestamp(existingFirstSeen);
  const incoming = parseIsoTimestamp(incomingFirstSeen);

  if (existing && incoming) {
    return existing.getTime() <= incoming.getTime()
      ? existing.toISOString()
      : incoming.toISOString();
  }

  if (existing) {
    return existing.toISOString();
  }

  if (incoming) {
    return incoming.toISOString();
  }

  return fallbackIso;
}

function mergeResults(
  existingRows: Array<Record<string, unknown>>,
  incomingRows: Array<Record<string, unknown>>
): Array<Record<string, unknown>> {
  const merged = new Map<string, Record<string, unknown>>();
  const mergeStartedAtIso = new Date().toISOString();

  for (const row of existingRows) {
    merged.set(buildResultIdentity(row), {
      ...row,
      first_seen_at: resolveFirstSeenAt(row.first_seen_at, null, mergeStartedAtIso),
    });
  }

  for (const row of incomingRows) {
    const key = buildResultIdentity(row);
    const current = merged.get(key);
    if (!current) {
      merged.set(key, {
        ...row,
        first_seen_at: resolveFirstSeenAt(null, row.first_seen_at, mergeStartedAtIso),
      });
      continue;
    }

    const combined: Record<string, unknown> = {
      ...current,
      ...row,
      site: mergeSiteNames(current.site, row.site),
      first_seen_at: resolveFirstSeenAt(current.first_seen_at, row.first_seen_at, mergeStartedAtIso),
    };

    const existingLinks = Array.isArray(current.job_url) ? current.job_url : null;
    const incomingLinks = Array.isArray(row.job_url) ? row.job_url : null;
    if (existingLinks && incomingLinks) {
      const allLinks = [...existingLinks, ...incomingLinks].filter((link) => link && typeof link === "object");
      const dedupedLinks = new Map<string, Record<string, unknown>>();

      for (const link of allLinks as Array<Record<string, unknown>>) {
        const site = normalizeText(link.site);
        const url = normalizeText(link.url);
        const id = `${site}::${url}`;
        if (!id || id === "::") {
          continue;
        }
        dedupedLinks.set(id, link);
      }

      combined.job_url = Array.from(dedupedLinks.values());
    }

    merged.set(key, combined);
  }

  return Array.from(merged.values());
}

function parseDatePosted(value: unknown): Date | null {
  const raw = String(value ?? "").trim();
  if (!raw) {
    return null;
  }

  const parsed = new Date(raw);
  if (Number.isFinite(parsed.getTime())) {
    return parsed;
  }

  const shortDate = raw.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!shortDate) {
    return null;
  }

  const [, year, month, day] = shortDate;
  const fallback = new Date(`${year}-${month}-${day}T00:00:00Z`);
  return Number.isFinite(fallback.getTime()) ? fallback : null;
}

function splitActiveAndArchivedResults(results: Array<Record<string, unknown>>): {
  active: Array<Record<string, unknown>>;
  archived: Array<Record<string, unknown>>;
} {
  const now = Date.now();
  const cutoffMs = now - CACHE_RETENTION_DAYS * 24 * 60 * 60 * 1000;

  const active: Array<Record<string, unknown>> = [];
  const archived: Array<Record<string, unknown>> = [];

  for (const row of results) {
    const effectiveDate =
      parseDatePosted(row.date_posted) ?? parseDatePosted(row.first_seen_at);
    if (!effectiveDate || effectiveDate.getTime() < cutoffMs) {
      archived.push(row);
      continue;
    }

    active.push(row);
  }

  return { active, archived };
}

async function appendToArchive(
  slug: string,
  title: string,
  rowsToArchive: Array<Record<string, unknown>>
): Promise<void> {
  if (rowsToArchive.length === 0) {
    return;
  }

  const currentArchive = await readArchive(slug);
  const mergedArchiveRows = mergeResults(currentArchive?.results ?? [], rowsToArchive);

  await writeArchive({
    slug,
    title,
    lastUpdated: new Date().toISOString(),
    results: mergedArchiveRows,
  });
}

function countWholeKeywordMentions(haystack: string, keyword: string): number {
  const normalizedKeyword = normalizeText(keyword);
  if (!normalizedKeyword) {
    return 0;
  }

  // Split haystack into words and count exact single-word hits.
  const words = haystack.split(/[^a-z0-9]+/).filter(Boolean);

  // Multi-word phrases are counted with boundary-aware regex.
  if (normalizedKeyword.includes(" ")) {
    const escapedKeyword = normalizedKeyword.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    try {
      const pattern = new RegExp(`(?:^|[^a-z0-9])${escapedKeyword}(?:[^a-z0-9]|$)`, "g");
      return [...haystack.matchAll(pattern)].length;
    } catch {
      let count = 0;
      let start = 0;
      while (start < haystack.length) {
        const index = haystack.indexOf(normalizedKeyword, start);
        if (index === -1) {
          break;
        }
        count += 1;
        start = index + normalizedKeyword.length;
      }

      return count;
    }
  }

  return words.filter((word) => word === normalizedKeyword).length;
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
    const titleMatches = rule.keywords.reduce(
      (total, keyword) => total + countWholeKeywordMentions(title, keyword),
      0
    );
    const companyMatches = rule.keywords.reduce(
      (total, keyword) => total + countWholeKeywordMentions(company, keyword),
      0
    );
    const companyIndustryMatches = rule.keywords.reduce(
      (total, keyword) => total + countWholeKeywordMentions(companyIndustry, keyword),
      0
    );
    const companyDescriptionMatches = rule.keywords.reduce(
      (total, keyword) => total + countWholeKeywordMentions(companyDescription, keyword),
      0
    );
    const descriptionMatches = rule.keywords.reduce(
      (total, keyword) => total + countWholeKeywordMentions(descriptionWithoutBenefits, keyword),
      0
    );

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

// Returns the upper bound of a years-of-experience mention in the text.
// Handles ranges ("3-5 years"), single values ("5 years"), and "5+ years".
// Returns the maximum value found across all mentions, or undefined if none.
function extractMaxExperienceYears(text: string): number | undefined {
  // Descriptions are stored as markdown; strip backslash escapes (e.g. "3\+" → "3+",
  // "3\-5" → "3-5") so the patterns below match correctly.
  const cleaned = text.replace(/\\(.)/g, "$1");

  const rangePattern = /(\d+)\s*[-–]\s*(\d+)\s*\+?\s*years?/gi;
  // Allow up to 3 words between "years [of]" and "experience" so phrases like
  // "3+ years of product design experience" are caught alongside the plain form.
  const singlePattern = /(\d+)\s*\+?\s*years?(?:\s+of)?\s+(?:\w+\s+){0,3}experience/gi;
  // Catches "X years [gerund]" — e.g. "4+ years designing production software",
  // "5 years working in finance" — where "experience" is not explicitly stated.
  const gerundPattern = /(\d+)\s*\+?\s*years?\s+(?:of\s+)?\w+ing\b/gi;

  let maxYears: number | undefined;

  for (const match of cleaned.matchAll(rangePattern)) {
    const upper = Math.max(Number(match[1]), Number(match[2]));
    if (!maxYears || upper > maxYears) maxYears = upper;
  }

  for (const match of cleaned.matchAll(singlePattern)) {
    const value = Number(match[1]);
    if (!maxYears || value > maxYears) maxYears = value;
  }

  for (const match of cleaned.matchAll(gerundPattern)) {
    const value = Number(match[1]);
    if (!maxYears || value > maxYears) maxYears = value;
  }

  return maxYears;
}

// Returns the label with the strictly highest count, or "" if all are zero or
// the top two are tied (ambiguous).
function highestUniqueCount(counts: Record<SeniorityLabel, number>): string {
  const sorted = (Object.entries(counts) as Array<[SeniorityLabel, number]>)
    .filter(([, count]) => count > 0)
    .sort((a, b) => b[1] - a[1]);

  if (sorted.length === 0) return "";
  const topCount = sorted[0][1];
  const secondCount = sorted[1]?.[1] ?? 0;
  return topCount > secondCount ? sorted[0][0] : "";
}

function inferSeniorityLabel(row: Record<string, unknown>): string {
  const title = normalizeText(row.title);
  const descriptionRaw = String(row.description ?? "");

  // Step 1: title keyword match is decisive — if the title contains a seniority
  // keyword, use the level with the highest hit count and skip the description.
  const titleCounts: Record<SeniorityLabel, number> = {
    Intern: 0, Junior: 0, Mid: 0, Senior: 0, Principal: 0, Lead: 0, Manager: 0,
  };
  for (const rule of SENIORITY_RULES) {
    for (const keyword of rule.keywords) {
      titleCounts[rule.label] += countWholeKeywordMentions(title, keyword);
    }
  }
  const titleWinner = highestUniqueCount(titleCounts);
  if (titleWinner) return titleWinner;

  // Step 2: no title signal — check description keywords and years of experience.
  // Strip sentences containing context phrases (e.g. "reporting to a Senior Manager")
  // so team-structure descriptions don't pollute the signal.
  const filteredDescription = normalizeText(
    descriptionRaw
      .split(/[.!?\n]+/)
      .filter((sentence) => {
        const normalized = normalizeText(sentence);
        return !SENIORITY_CONTEXT_EXCLUSION_PHRASES.some((phrase) => normalized.includes(phrase));
      })
      .join(" ")
  );

  const descCounts: Record<SeniorityLabel, number> = {
    Intern: 0, Junior: 0, Mid: 0, Senior: 0, Principal: 0, Lead: 0, Manager: 0,
  };
  for (const rule of SENIORITY_RULES) {
    // "Lead" is too ambiguous in job descriptions (e.g. "lead the team") so we
    // skip keyword matching for it here — only the years-of-experience signal
    // can contribute to Lead in the description path.
    if (rule.label === "Lead") continue;
    for (const keyword of rule.keywords) {
      descCounts[rule.label] += countWholeKeywordMentions(filteredDescription, keyword);
    }
  }

  // Years of experience counts as one signal for the matching level.
  const maxYears = extractMaxExperienceYears(descriptionRaw);
  if (maxYears !== undefined) {
    if (maxYears < 2) {
      descCounts.Junior += 1;
    } else if (maxYears <= 5) {
      descCounts.Mid += 1;
    } else if (maxYears <= 8) {
      descCounts.Senior += 1;
    } else {
      // >8 years boosts both Principal and Lead equally; other keyword signals break the tie.
      descCounts.Principal += 1;
      descCounts.Lead += 1;
    }
  }

  return highestUniqueCount(descCounts);
}

function annotateDerivedFields(results: Array<Record<string, unknown>>): Array<Record<string, unknown>> {
  return results.map((row) => ({
    ...row,
    status_key: buildStatusKey(row),
    industry_label: inferIndustryLabel(row),
    seniority_label: inferSeniorityLabel(row),
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

function applyStoredSeniorityOverrides(
  results: Array<Record<string, unknown>>,
  overrides: Record<string, string>
): Array<Record<string, unknown>> {
  return results.map((row) => {
    const statusKey = String(row.status_key ?? buildStatusKey(row));
    const storedOverride = overrides[statusKey];

    return {
      ...row,
      seniority_label: storedOverride ?? row.seniority_label,
    };
  });
}

async function presentSearchResult(
  payload: SearchResult,
  includeDebug = false
): Promise<SearchResult> {
  let linkedInRemoteFallbackCount = 0;
  const rawResults = payload.results;
  const remoteFilteredResults = shouldEnforceRemoteOnly(payload.criteria)
    ? rawResults.reduce<Array<Record<string, unknown>>>((accepted, row) => {
        if (isRemoteResult(row)) {
          accepted.push(row);
          return accepted;
        }

        if (isLikelyLinkedInRemote(row)) {
          linkedInRemoteFallbackCount += 1;

          const normalizedLocation = normalizeText(row.location);
          if (!normalizedLocation) {
            accepted.push({
              ...row,
              work_mode: "Likely Remote",
            });
            return accepted;
          }

          accepted.push(row);
          return accepted;
        }

        return accepted;
      }, [])
    : rawResults;
  // Hydrate from shared description cache first so industry inference can use it.
  const hydratedRemoteResults = await hydrateDescriptionsFromCache(remoteFilteredResults);
  const enrichedResults = annotateDerivedFields(hydratedRemoteResults);
  // Title-include / title-exclude / employer-blacklist filtering is handled
  // entirely on the client so that filter changes are instant without a re-fetch.
  const dedupedResults = dedupeResults(enrichedResults);
  const statuses = await readStatusStore();
  const resultsWithStatus = applyStoredStatuses(dedupedResults, statuses);
  const industryOverrides = await readIndustryOverrideStore();
  const resultsWithIndustry = applyStoredIndustryOverrides(resultsWithStatus, industryOverrides);
  const seniorityOverrides = await readSeniorityOverrideStore();
  const resultsWithSeniority = applyStoredSeniorityOverrides(resultsWithIndustry, seniorityOverrides);
  enqueueDescriptionFetches(resultsWithSeniority);

  const debug: SearchDebugStats | undefined = includeDebug
    ? {
        rawCount: rawResults.length,
        remoteFilteredCount: remoteFilteredResults.length,
        titleFilteredCount: remoteFilteredResults.length,
        dedupedCount: dedupedResults.length,
        finalCount: resultsWithSeniority.length,
        excludedByRemoteFilter: rawResults.length - remoteFilteredResults.length,
        excludedByTitleFilter: 0,
        removedByDedupe: enrichedResults.length - dedupedResults.length,
        includedByLinkedInRemoteFallback: linkedInRemoteFallbackCount,
      }
    : undefined;

  const rawResultCount = Number.isFinite(payload.rawResultCount)
    ? payload.rawResultCount
    : Number.isFinite(payload.resultCount)
      ? payload.resultCount
      : rawResults.length;

  return {
    ...payload,
    rawResultCount,
    results: resultsWithSeniority,
    resultCount: resultsWithSeniority.length,
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

    let didFinish = false;
    let killTimer: NodeJS.Timeout | null = null;

    let stdout = "";
    let stderr = "";

    const cleanup = (): void => {
      if (killTimer) {
        clearTimeout(killTimer);
        killTimer = null;
      }
    };

    const failWithTimeout = (): void => {
      if (didFinish) {
        return;
      }

      didFinish = true;
      cleanup();

      try {
        child.kill("SIGTERM");
      } catch {
        // Ignore kill errors if process is already exiting.
      }

      setTimeout(() => {
        try {
          child.kill("SIGKILL");
        } catch {
          // Ignore kill errors if process has already stopped.
        }
      }, PYTHON_SEARCH_KILL_GRACE_MS);

      reject(
        new Error(
          `JobSpy search timed out after ${PYTHON_SEARCH_TIMEOUT_MS}ms for criteria location=${String(
            criteria.location ?? ""
          )}`
        )
      );
    };

    killTimer = setTimeout(failWithTimeout, PYTHON_SEARCH_TIMEOUT_MS);

    child.stdout.on("data", (chunk: Buffer) => {
      stdout += chunk.toString();
    });

    child.stderr.on("data", (chunk: Buffer) => {
      stderr += chunk.toString();
    });

    child.on("error", (error) => {
      if (didFinish) {
        return;
      }

      didFinish = true;
      cleanup();
      reject(error);
    });

    child.on("close", (code) => {
      if (didFinish) {
        return;
      }

      didFinish = true;
      cleanup();

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

async function runResilientSearch(
  definition: SearchDefinition,
  cached: SearchResult | null
): Promise<{ results: Array<Record<string, unknown>>; count: number }> {
  const baseCriteria = definition.criteria;
  const requestedSites = normalizeSites(baseCriteria.site_name);
  const sites = requestedSites.length > 0 ? requestedSites : ["indeed", "linkedin", "glassdoor"];

  // If the cache is empty or too sparse relative to what was requested, treat it
  // as if it has no timestamp — this forces a full-period search rather than an
  // incremental window.  Without this, a cache reset to near-zero results would
  // keep the incremental window tiny on every subsequent refresh (e.g. 4 hours
  // elapsed + 4 hour overlap = 8 hours), permanently locking the result count at
  // a low value even though older results are available on the job sites.
  //
  // Threshold: if fewer than 25 % of requested results are cached, the cache is
  // treated as sparse and gets a full-period scan.  Healthy caches (≥ 25 %)
  // continue to use the incremental window as normal.
  const resultsWanted = Math.max(1, Number(baseCriteria.results_wanted) || 60);
  const isCacheSparse =
    !cached?.results?.length ||
    cached.results.length < Math.ceil(resultsWanted * 0.25);
  const hoursOld = getIncrementalHours(baseCriteria, isCacheSparse ? undefined : cached?.lastUpdated);

  async function runSiteSearch(site: string): Promise<Array<Record<string, unknown>>> {
    const siteCriteria: SearchDefinition["criteria"] = {
      ...baseCriteria,
      site_name: site,
      hours_old: hoursOld,
    };

    if (site === "linkedin") {
      let linkedInRuns = 0;
      let previousUniqueCount = 0;
      let currentRows: Array<Record<string, unknown>> = [];

      while (linkedInRuns < LINKEDIN_MIN_RUNS) {
        const { results } = await runPythonSearch(siteCriteria);
        currentRows = mergeResults(currentRows, results);
        previousUniqueCount = currentRows.length;
        linkedInRuns += 1;
      }

      while (linkedInRuns < LINKEDIN_MAX_RUNS) {
        const { results } = await runPythonSearch(siteCriteria);
        const nextRows = mergeResults(currentRows, results);
        const gainedRows = nextRows.length - previousUniqueCount;

        currentRows = nextRows;
        previousUniqueCount = currentRows.length;
        linkedInRuns += 1;

        if (gainedRows <= 0) {
          break;
        }
      }

      return currentRows;
    }

    if (site === "glassdoor") {
      let { results } = await runPythonSearch(siteCriteria);
      const shouldRetryOnZero =
        results.length === 0 && hasRowsForSite(cached?.results ?? [], "glassdoor");

      if (shouldRetryOnZero) {
        for (let retry = 1; retry <= GLASSDOOR_MAX_RETRIES_ON_ZERO; retry += 1) {
          await sleep(GLASSDOOR_RETRY_BASE_DELAY_MS * retry);
          const retryResponse = await runPythonSearch(siteCriteria);
          results = retryResponse.results;
          if (results.length > 0) {
            break;
          }
        }
      }

      return results;
    }

    const { results } = await runPythonSearch(siteCriteria);
    return results;
  }

  // Keep site-level scraping bounded so refreshes are faster without overloading providers.
  async function runWithConcurrency<T, R>(
    items: T[],
    concurrency: number,
    worker: (item: T) => Promise<R>
  ): Promise<R[]> {
    const safeConcurrency = Math.max(1, Math.min(concurrency, items.length || 1));
    const output: R[] = new Array(items.length);
    let nextIndex = 0;

    async function runner(): Promise<void> {
      while (nextIndex < items.length) {
        const currentIndex = nextIndex;
        nextIndex += 1;
        output[currentIndex] = await worker(items[currentIndex]);
      }
    }

    await Promise.all(Array.from({ length: safeConcurrency }, () => runner()));
    return output;
  }

  const resultsBySite = await runWithConcurrency(sites, SITE_PARALLELISM, runSiteSearch);
  const mergedSiteResults = resultsBySite.flat();

  const dedupedResults = mergeResults([], mergedSiteResults);
  return {
    results: dedupedResults,
    count: dedupedResults.length,
  };
}

export async function loadOrRunSearch(
  definition: SearchDefinition,
  forceRefresh = false,
  includeDebug = false,
  // When true, ignores the cached lastUpdated timestamp so the search covers the
  // full hours_old period (used when the user changes search criteria).
  // Existing cached results are still merged in afterwards to preserve known jobs.
  useFullPeriod = false
): Promise<SearchResult> {
  const cached: SearchResult | null = await readCache(definition.slug);

  if (!forceRefresh && !useFullPeriod) {
    if (cached && !isCacheStale(cached.lastUpdated)) {
      return await presentSearchResult(cached, includeDebug);
    }
  }

  try {
    // Pass null for the cached value when useFullPeriod is set so that
    // getIncrementalHours falls back to the full hours_old from criteria instead
    // of computing a shorter window based on elapsed time since the last run.
    const { results } = await runResilientSearch(definition, useFullPeriod ? null : cached);

    // If the search_term has changed since the cache was last written (e.g. the
    // user updated their keywords), old cached results were fetched with a different
    // query and should not be merged in — they would contaminate the new results.
    // This also auto-clears any cache that was written before keywords were first
    // configured (search_term "" → "UX Designer") or when the search_term format
    // changed (quoted "\"UX Designer\"" → unquoted "UX Designer").
    const cachedSearchTerm = String(cached?.criteria?.search_term ?? "");
    const currentSearchTerm = String(definition.criteria.search_term ?? "");
    const searchTermChanged = cachedSearchTerm !== currentSearchTerm;
    const previousResults = searchTermChanged ? [] : (cached?.results ?? []);

    const mergedResults = mergeResults(previousResults, results);
    const cacheReadyResults = shouldEnforceRemoteOnly(definition.criteria)
      ? mergedResults.filter((row) => isRemoteResult(row) || isLikelyLinkedInRemote(row))
      : mergedResults;
    const { active, archived } = splitActiveAndArchivedResults(cacheReadyResults);

    const payload: SearchResult = {
      slug: definition.slug,
      title: definition.title,
      criteria: definition.criteria,
      results: active,
      rawResultCount: active.length,
      resultCount: active.length,
      lastUpdated: new Date().toISOString(),
    };

    await writeCache(payload);
    await appendToArchive(definition.slug, definition.title, archived);
    return await presentSearchResult(payload, includeDebug);
  } catch (error) {
    if (cached) {
      return await presentSearchResult(
        {
          ...cached,
          error: String(error),
        },
        includeDebug
      );
    }

    return await presentSearchResult({
      slug: definition.slug,
      title: definition.title,
      criteria: definition.criteria,
      results: [],
      rawResultCount: 0,
      resultCount: 0,
      lastUpdated: new Date().toISOString(),
      error: String(error),
    }, includeDebug);
  }
}
