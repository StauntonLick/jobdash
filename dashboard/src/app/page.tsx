"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Building2, Check, ChevronDown, ExternalLink, Eye, EyeOff, Globe, IdCard, Loader2, MapPin, Plus, Search, Settings2, Trash2, X } from "lucide-react";
import ReactMarkdown, { type Components } from "react-markdown";
import remarkGfm from "remark-gfm";

import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { INDUSTRY_LABELS } from "@/lib/industry-labels";
import { SENIORITY_LABELS } from "@/lib/seniority-labels";
import { countAiKeywords, aiLevelFromCount } from "@/lib/ai-keywords";
import { INDEED_COUNTRIES, POPULAR_CITIES } from "@/lib/location-constants";
import type { LocationSuggestion } from "@/lib/location-constants";

function useDebounce<T>(value: T, delay: number): T {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const id = setTimeout(() => setDebounced(value), delay);
    return () => clearTimeout(id);
  }, [value, delay]);
  return debounced;
}

type SearchData = {
  slug: string;
  title: string;
  criteria: Record<string, string | number | boolean | string[]>;
  results: Array<Record<string, unknown>>;
  rawResultCount: number;
  resultCount: number;
  lastUpdated: string;
  error?: string;
};

// ---------------------------------------------------------------------------
// User config — mirrors the server-side UserConfig from @/lib/user-config.
// Kept here as a plain type so the client component doesn't import Node.js code.
// ---------------------------------------------------------------------------

type UserConfigLocation =
  | { id: string; type: "hybrid"; label: string; city: string; radiusKm: number; country: string }
  | { id: string; type: "remote"; label: string; country: string };

type UserConfig = {
  keywords: string[];
  sites: string[];
  daysOld: number;
  resultsWanted: number;
  titleIncludes: string[];
  titleExcludes: string[];
  employerBlacklist: string[];
  locations: UserConfigLocation[];
};

// Maps UI display names to the API site keys JobSpy understands, and back.
const SITE_NAME_TO_KEY: Record<string, string> = {
  LinkedIn: "linkedin",
  Indeed: "indeed",
  Glassdoor: "glassdoor",
  ZipRecruiter: "zip_recruiter",
  Google: "google",
};
const SITE_KEY_TO_NAME: Record<string, string> = Object.fromEntries(
  Object.entries(SITE_NAME_TO_KEY).map(([name, key]) => [key, name])
);

// Maps the age-select display labels to daysOld config values.
type AgeLabel = "24 hours" | "7 days" | "14 days";
const DAYS_LABEL_TO_DAYS: Record<AgeLabel, number> = {
  "24 hours": 1,
  "7 days": 7,
  "14 days": 14,
};
function daysToLabel(days: number): AgeLabel {
  if (days <= 1) return "24 hours";
  if (days <= 7) return "7 days";
  return "14 days";
}

// Applies include/exclude title and employer-blacklist filters client-side.
function applyClientFilters(
  results: Array<Record<string, unknown>>,
  includeTerms: string[],
  excludeTerms: string[],
  blacklist: string[]
): Array<Record<string, unknown>> {
  const lowerIncludes = includeTerms.map((t) => t.toLowerCase());
  const lowerExcludes = excludeTerms.map((t) => t.toLowerCase());
  const lowerBlacklist = blacklist.map((n) => n.toLowerCase());

  return results.filter((row) => {
    const title = String(row.title ?? "").toLowerCase();
    if (!title) return false;

    const matchesInclude =
      lowerIncludes.length === 0 || lowerIncludes.some((t) => title.includes(t));
    const matchesExclude = lowerExcludes.some((t) => title.includes(t));
    if (!matchesInclude || matchesExclude) return false;

    const company = String(row.company ?? "").toLowerCase();
    return !lowerBlacklist.some((n) => company.includes(n));
  });
}

// Splits a comma-separated text input into a trimmed array, stripping surrounding
// quotes so e.g. `"DataAnnotation", Prolific` → ["DataAnnotation", "Prolific"].
function parseListInput(input: string): string[] {
  return input
    .split(",")
    .map((s) => s.replace(/^["'\s]+|["'\s]+$/g, "").trim())
    .filter(Boolean);
}

// Formats an array as a comma-separated string for display in text inputs.
function formatListForDisplay(items: string[]): string {
  return items.join(", ");
}

// Client-side slug — must match the server-side slugify in search-config.ts.
// ---------------------------------------------------------------------------
// Search radius options — shared between the Add Location dialog and the
// radius mini-button dropdown in the Search Title bar.
// ---------------------------------------------------------------------------

const RADIUS_OPTIONS = ["Exact location only", "10km", "20km", "50km", "100km"] as const;
type RadiusOption = (typeof RADIUS_OPTIONS)[number];

function radiusKmToOption(km: number): RadiusOption {
  if (km === 0) return "Exact location only";
  const candidate = `${km}km` as RadiusOption;
  return (RADIUS_OPTIONS as readonly string[]).includes(candidate) ? candidate : "10km";
}

function radiusOptionToKm(opt: RadiusOption): number {
  if (opt === "Exact location only") return 0;
  return parseInt(opt) || 10;
}

// Label shown on the mini-button trigger: numeric options get "Within" prepended.
function radiusButtonLabel(opt: RadiusOption): string {
  return opt === "Exact location only" ? opt : `Within ${opt}`;
}

function slugifyLabel(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

const STATUS_OPTIONS = ["New", "Skipped", "Applied", "Shortlist", "Longlist"] as const;
type JobStatus = (typeof STATUS_OPTIONS)[number];

const VISIBLE_COLUMNS = ["title", "company", "industry", "ai_level", "seniority", "date_posted", "status"] as const;

type JobLink = {
  site: string;
  url: string;
  location?: string;
};

type JobSelection = {
  searchSlug: string;
  statusKey: string;
};

function toJobStatus(value: unknown): JobStatus {
  const normalized = String(value ?? "").trim();
  if (STATUS_OPTIONS.includes(normalized as JobStatus)) {
    return normalized as JobStatus;
  }

  return "New";
}

function statusTextColor(status: JobStatus): { color: string } {
  switch (status) {
    case "Skipped":
      return { color: "#C7C3BE" };
    case "Applied":
      return { color: "#1AAB32" };
    case "Shortlist":
      return { color: "#FF6200" };
    case "Longlist":
      return { color: "#F2BF00" };
    default:
      return { color: "#172542" };
  }
}

function toDisplayValue(value: unknown): string {
  if (Array.isArray(value)) {
    return value.join(", ");
  }

  if (typeof value === "object" && value !== null) {
    return JSON.stringify(value);
  }

  if (value === null || value === undefined || value === "") {
    return "-";
  }

  return String(value);
}

function truncateAtFirstComma(value: string): string {
  const commaIndex = value.indexOf(",");
  return (commaIndex === -1 ? value : value.slice(0, commaIndex)).trim();
}

function isJobLinkArray(value: unknown): value is JobLink[] {
  return (
    Array.isArray(value) &&
    value.every((item) => {
      if (typeof item !== "object" || item === null) {
        return false;
      }

      return "site" in item && "url" in item;
    })
  );
}

function getRowPrimaryLink(row: Record<string, unknown>): { site: string; url: string } | null {
  const jobUrl = row.job_url;
  const links: JobLink[] = isJobLinkArray(jobUrl)
    ? jobUrl
    : jobUrl
      ? [{ site: "view", url: String(jobUrl) }]
      : [];
  return (
    links.find((l) => {
      const site = String(l.site ?? "").toLowerCase();
      return site && site !== "view" && String(l.url ?? "").trim() !== "";
    }) ?? null
  );
}

function buildDescKey(site: string, url: string): string {
  return `${site.toLowerCase().split(",")[0].trim()}::${url.trim()}`;
}

function AiLevelCell({ description }: { description: string }) {
  if (!description) return null;
  const level = aiLevelFromCount(countAiKeywords(description));
  return (
    <span className="flex items-center" style={{ gap: "4px" }}>
      {([0, 1, 2] as const).map((i) => (
        <span key={i} style={{ opacity: i < level ? 1 : 0.15 }} aria-hidden="true">
          🤖
        </span>
      ))}
    </span>
  );
}

function parseDateValue(value: unknown): Date | null {
  const raw = String(value ?? "").trim();
  if (!raw || raw === "-") {
    return null;
  }

  const parsed = new Date(raw);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function hasTimePrecision(value: unknown): boolean {
  const raw = String(value ?? "").trim();
  if (!raw || raw === "-") {
    return false;
  }

  if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) {
    return false;
  }

  return /T\d{2}:\d{2}| \d{2}:\d{2}/.test(raw);
}

function combinePostedDateWithFirstSeenTime(
  postedDateValue: unknown,
  firstSeenValue: unknown
): Date | null {
  const postedRaw = String(postedDateValue ?? "").trim();
  const firstSeen = parseDateValue(firstSeenValue);

  if (!postedRaw || !firstSeen) {
    return null;
  }

  const postedDateOnly = postedRaw.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!postedDateOnly) {
    return null;
  }

  const [, year, month, day] = postedDateOnly;
  const combined = new Date(
    Number(year),
    Number(month) - 1,
    Number(day),
    firstSeen.getHours(),
    firstSeen.getMinutes(),
    firstSeen.getSeconds(),
    firstSeen.getMilliseconds()
  );

  return Number.isNaN(combined.getTime()) ? null : combined;
}

function getAgeSourceDate(row: Record<string, unknown>): Date | null {
  const postedDate = parseDateValue(row["date_posted"]);
  if (!postedDate) {
    return parseDateValue(row["first_seen_at"]);
  }

  if (hasTimePrecision(row["date_posted"])) {
    return postedDate;
  }

  const combined = combinePostedDateWithFirstSeenTime(
    row["date_posted"],
    row["first_seen_at"]
  );
  if (combined) {
    return combined;
  }

  const firstSeen = parseDateValue(row["first_seen_at"]);
  return firstSeen ?? postedDate;
}

function getSortTimestamp(row: Record<string, unknown>): number {
  return getAgeSourceDate(row)?.getTime() ?? 0;
}

function formatAge(row: Record<string, unknown>): string {
  const ageSourceDate = getAgeSourceDate(row);
  if (!ageSourceDate) return "-";

  const diffMs = Date.now() - ageSourceDate.getTime();
  const diffHours = Math.floor(diffMs / (1000 * 60 * 60));

  if (diffHours < 24) {
    return diffHours <= 1 ? "1 hour" : `${diffHours} hours`;
  }

  const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));
  return diffDays === 1 ? "1 day" : `${diffDays} days`;
}

function formatPostingDate(dateValue: unknown): string {
  if (!dateValue || dateValue === "-") return "";
  const posted = new Date(String(dateValue));
  if (Number.isNaN(posted.getTime())) return "";

  const day = String(posted.getDate()).padStart(2, "0");
  const month = String(posted.getMonth() + 1).padStart(2, "0");
  const year = String(posted.getFullYear()).slice(-2);

  return `${day}/${month}/${year}`;
}

function formatDateDdMmYyyyAtHhMm(dateValue: unknown): string {
  if (!dateValue) {
    return "-";
  }

  const date = new Date(String(dateValue));
  if (Number.isNaN(date.getTime())) {
    return "-";
  }

  const day = String(date.getDate()).padStart(2, "0");
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const year = String(date.getFullYear());
  const hours = String(date.getHours()).padStart(2, "0");
  const minutes = String(date.getMinutes()).padStart(2, "0");

  return `${day}/${month}/${year} at ${hours}:${minutes}`;
}

function formatSiteName(site: string): string {
  return site
    .split(/[_\s-]+/)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

function getStatusKey(row: Record<string, unknown>): string {
  return String(row["status_key"] ?? `${row["title"] ?? ""}::${row["company"] ?? ""}`)
    .trim()
    .toLowerCase();
}

function deriveWorkMode(row: Record<string, unknown>): string {
  const explicitMode = String(row["work_mode"] ?? row["location_type"] ?? "")
    .trim()
    .toLowerCase();

  if (explicitMode.includes("likely remote")) {
    return "Likely Remote";
  }

  if (explicitMode.includes("hybrid")) {
    return "Hybrid";
  }

  if (explicitMode.includes("remote")) {
    return "Remote";
  }

  if (explicitMode.includes("in-person") || explicitMode.includes("onsite") || explicitMode.includes("on-site")) {
    return "In-Person";
  }

  const isRemote = String(row["is_remote"] ?? "").trim().toLowerCase();
  if (isRemote === "true") {
    return "Remote";
  }

  const remoteFlag = String(row["remote"] ?? "").trim().toLowerCase();
  if (remoteFlag === "true") {
    return "Remote";
  }

  const locationText = String(row["location"] ?? "")
    .trim()
    .toLowerCase();

  if (locationText.includes("hybrid")) {
    return "Hybrid";
  }

  if (locationText.includes("remote")) {
    return "Remote";
  }

  return "In-Person";
}

// ---------------------------------------------------------------------------
// Settings Tray components
// ---------------------------------------------------------------------------

// Small upward-pointing triangle that sits on the top edge of the settings tray,
// visually connecting it to whichever element triggered the tray (keyword input or a tab).
// Dimensions: 16px wide × 7px tall. The tip has a subtle rounded corner via a quadratic
// Bézier curve. Colour matches the tray background (control-surface).
// anchorId — the DOM id of the element the pointer should centre over.
// Re-positions automatically when anchorId changes or the window is resized.
function SettingsTrayPointer({ anchorId }: { anchorId: string }) {
  const [left, setLeft] = useState(0);

  useEffect(() => {
    function place() {
      const el = document.getElementById(anchorId);
      if (!el) return;
      const rect = el.getBoundingClientRect();
      // Centre the 16px pointer over the horizontal midpoint of the anchor element.
      setLeft(rect.left + rect.width / 2 - 8);
    }
    place();
    window.addEventListener("resize", place);
    return () => window.removeEventListener("resize", place);
  }, [anchorId]);

  return (
    <div
      id="settings-tray-pointer"
      aria-hidden="true"
      style={{ left }}
      // Sits 7px above the tray top edge, overlapping the header beneath it.
      // text-control-surface passes the tray colour to the SVG via currentColor.
      className="pointer-events-none absolute -top-[7px] z-10 h-[7px] w-4 text-control-surface"
    >
      {/* Triangle path: base at y=7, tip at (8,0) with a soft quadratic Bézier rounding. */}
      <svg width="16" height="7" viewBox="0 0 16 7" fill="none" xmlns="http://www.w3.org/2000/svg">
        <path d="M 0 7 L 7 1 Q 8 0 9 1 L 16 7 Z" fill="currentColor" />
      </svg>
    </div>
  );
}

// Shared pill-shaped text input matching the Figma Input spec.
// Accepts optional value/onChange to operate as a controlled input (e.g. when wired to suggestion buttons).
// onBlur receives the current input value when focus leaves — used to rename draft tabs.
// States: rest → hover → active (darker border). No shadow, no focus glow ring.
function TrayInput({
  id,
  placeholder,
  value,
  onChange,
  onBlur,
}: {
  id: string;
  placeholder: string;
  value?: string;
  onChange?: (value: string) => void;
  onBlur?: (value: string) => void;
}) {
  return (
    <input
      id={id}
      type="text"
      placeholder={placeholder}
      // Spread controlled props only when a value is provided, otherwise leave uncontrolled.
      {...(value !== undefined
        ? { value, onChange: (e) => onChange?.(e.target.value) }
        : {})}
      onBlur={onBlur ? (e) => onBlur(e.target.value) : undefined}
      className="
        h-9 w-full rounded-full
        border border-black/8
        bg-control-background
        px-3
        text-sm font-light text-control-foreground placeholder:text-muted-foreground
        hover:bg-control-active
        focus:bg-control-active focus:border-black/32 focus:outline-none focus:ring-0
      "
    />
  );
}

// A single option inside a TraySelect dropdown.
// Shows an orange highlighted row + checkmark when selected.
function TraySelectOption({
  label,
  selected,
  onSelect,
}: {
  label: string;
  selected: boolean;
  onSelect: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onSelect}
      className={`
        flex w-full items-center justify-between rounded-full px-2 py-1.5 text-left text-sm font-light
        ${selected
          ? "bg-[#D26429] text-white"
          : "text-primary hover:bg-black/5"
        }
      `}
    >
      <span>{label}</span>
      {/* Checkmark is always shown for selected items */}
      {selected && <Check className="h-3.5 w-3.5 shrink-0" />}
    </button>
  );
}

// Pill-shaped select control that supports both single and multi-select behaviour.
//   single — closes the dropdown when an item is picked; selected item cannot be deselected.
//   multi  — keeps the dropdown open on each pick; picking a selected item deselects it.
// Operates in controlled mode when `value` is provided (syncs to parent state),
// or uncontrolled mode using `defaultValue` for initial state only.
// onChange fires with the full selected array whenever the selection changes.
function TraySelect({
  id,
  placeholder,
  options,
  type,
  defaultValue,
  value: controlledValue,
  searchable = false,
  searchPlaceholder = "Search…",
  onChange,
}: {
  id: string;
  placeholder: string;
  options: string[];
  type: "single" | "multi";
  defaultValue?: string | string[];
  /** When provided, the component operates in controlled mode — internal state
   *  tracks this value and updates whenever it changes. */
  value?: string | string[];
  /** When true, shows a filter input at the top of the dropdown. Default false. */
  searchable?: boolean;
  /** Placeholder text for the search filter input. Only used when searchable={true}. */
  searchPlaceholder?: string;
  onChange?: (selected: string[]) => void;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const searchRef = useRef<HTMLInputElement>(null);

  // Seed internal state from controlledValue if provided, else from defaultValue.
  const seed = controlledValue ?? defaultValue;
  const [selected, setSelected] = useState<string[]>(
    seed ? (Array.isArray(seed) ? seed : [seed]) : []
  );

  // When the parent updates controlledValue, keep internal state in sync.
  useEffect(() => {
    if (controlledValue !== undefined) {
      setSelected(Array.isArray(controlledValue) ? controlledValue : [controlledValue]);
    }
  }, [controlledValue]);

  // Build the trigger label from current selection, or fall back to placeholder.
  const triggerLabel =
    selected.length === 0
      ? placeholder
      : selected.join(", ");

  // Filter options by the current query (case-insensitive substring).
  const filteredOptions = query.trim()
    ? options.filter((o) => o.toLowerCase().includes(query.toLowerCase()))
    : options;

  function openDropdown() {
    setQuery("");
    setOpen(true);
    if (searchable) {
      // Defer focus so the input is in the DOM before we focus it.
      setTimeout(() => searchRef.current?.focus(), 0);
    }
  }

  function closeDropdown() {
    setOpen(false);
    setQuery("");
  }

  function handleSelect(option: string) {
    if (type === "single") {
      // Pick the item and close — cannot deselect.
      setSelected([option]);
      closeDropdown();
      onChange?.([option]);
    } else {
      // Toggle the item; leave the dropdown open.
      // Compute next outside the updater so onChange is never called inside a
      // setState call — that would trigger React's "setState during render" warning.
      const next = selected.includes(option)
        ? selected.filter((o) => o !== option)
        : [...selected, option];
      setSelected(next);
      onChange?.(next);
    }
  }

  return (
    <div id={id} className="relative">
      {/* Trigger pill — background and border both change when the dropdown is open.
          No shadow on any state, matching the updated Figma Input/Select spec. */}
      <button
        type="button"
        onClick={() => open ? closeDropdown() : openDropdown()}
        className={`
          flex h-9 w-full items-center justify-between rounded-full
          px-3
          text-sm font-light text-control-foreground
          ${open
            ? "bg-control-active border border-black/32"
            : "bg-control-background border border-black/8 hover:bg-control-active"}
        `}
      >
        <span className="truncate">
          {triggerLabel}
        </span>
        <ChevronDown className="ml-2 h-4 w-4 shrink-0 text-primary/60" />
      </button>

      {open && (
        <>
          {/* Transparent full-screen backdrop sitting behind the dropdown (z-40).
              Clicking it closes this select only — stopImmediatePropagation prevents
              the tray's document-level mousedown listener from also firing and
              closing the whole settings tray. */}
          <div
            className="fixed inset-0 z-40"
            onMouseDown={(e) => {
              e.nativeEvent.stopImmediatePropagation();
              closeDropdown();
            }}
          />

          {/* Dropdown panel — z-50 keeps it above the backdrop */}
          <div
            className="
              absolute left-0 top-full z-50 mt-1 w-full
              rounded-2xl border border-black/8
              bg-control-surface
              p-1
              shadow-[0px_2px_4px_-2px_rgba(0,0,0,0.1),0px_4px_6px_-1px_rgba(0,0,0,0.1)]
            "
          >
            {/* Search filter input — only rendered when searchable={true} */}
            {searchable && (
              <div className="pb-1">
                <input
                  ref={searchRef}
                  type="text"
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  placeholder={searchPlaceholder}
                  className="h-9 w-full rounded-full border border-black/8 bg-control-background px-3 text-sm font-light text-control-foreground placeholder:text-muted-foreground hover:bg-control-active focus:bg-control-active focus:border-black/32 focus:outline-none focus:ring-0"
                />
              </div>
            )}

            {/* Options list */}
            <div className="max-h-48 overflow-y-auto flex flex-col gap-1 bg-control-surface [scrollbar-width:thin]">
              {filteredOptions.length > 0 ? (
                filteredOptions.map((option) => (
                  <TraySelectOption
                    key={option}
                    label={option}
                    selected={selected.includes(option)}
                    onSelect={() => handleSelect(option)}
                  />
                ))
              ) : (
                <p className="px-2 py-2 text-xs text-muted-foreground">No results</p>
              )}
            </div>
          </div>
        </>
      )}
    </div>
  );
}

// A labelled form row (label above, control below) used throughout the tray.
// label accepts ReactNode so individual words can carry their own colour (e.g. the "(km)" suffix).
function TrayFormItem({ label, children }: { label: React.ReactNode; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-2">
      <span className="text-sm font-semibold text-primary">{label}</span>
      {children}
    </div>
  );
}

// A tray column with an icon + section heading above a list of form items.
// fill — when true the column expands to fill remaining horizontal space instead of sitting at w-80.
function TraySection({
  icon,
  heading,
  children,
  fill = false,
}: {
  icon: React.ReactNode;
  heading: string;
  children: React.ReactNode;
  fill?: boolean;
}) {
  return (
    <div className={`${fill ? "min-w-0 flex-1" : "w-80 shrink-0"} flex flex-col gap-4`}>
      {/* Section heading row — icon and title at full opacity, Nunito SemiBold */}
      <div className="flex items-center gap-2">
        <span className="text-primary">{icon}</span>
        <span className="font-sans text-lg font-semibold text-primary">{heading}</span>
      </div>
      {children}
    </div>
  );
}

// The "Search Settings" tray content — three columns: Sources, Job Titles, Employers.
// All values are controlled from the parent (Home) so they persist when the tray
// is closed and re-opened, and so the Search button can read them to save the config.
// onClose is called when the user clicks the × button to dismiss the tray.
function SearchSettingsContent({
  onClose,
  sites,
  daysLabel,
  titleIncludes,
  titleExcludes,
  blacklist,
  onSitesChange,
  onDaysChange,
  onTitleIncludesChange,
  onTitleExcludesChange,
  onBlacklistChange,
}: {
  onClose: () => void;
  sites: string[];
  daysLabel: string;
  titleIncludes: string;
  titleExcludes: string;
  blacklist: string;
  onSitesChange: (sites: string[]) => void;
  onDaysChange: (label: string) => void;
  onTitleIncludesChange: (value: string) => void;
  onTitleExcludesChange: (value: string) => void;
  onBlacklistChange: (value: string) => void;
}) {
  // Appends a suggested employer name (quoted, comma-separated) to the blacklist input.
  function appendEmployerSuggestion(name: string) {
    const trimmed = blacklist.trim();
    onBlacklistChange(trimmed ? `${trimmed}, "${name}"` : `"${name}"`);
  }

  return (
    // Outer row: columns on the left, close button on the right.
    <div id="settings-tray-search" className="flex flex-row items-start justify-between gap-12">

      {/* ── The three control columns ── */}
      <div className="flex flex-row gap-12">

        {/* ── Column 1: Sources ── */}
        <TraySection icon={<Search className="h-5 w-5" />} heading="Sources">
          <TrayFormItem label="Job Sites">
            <TraySelect
              id="select-job-sites"
              placeholder="LinkedIn, Indeed, Glassdoor"
              type="multi"
              options={["LinkedIn", "Indeed", "Glassdoor", "ZipRecruiter", "Google"]}
              value={sites}
              onChange={onSitesChange}
            />
          </TrayFormItem>
          <TrayFormItem label="Posted in the last">
            <TraySelect
              id="select-age"
              placeholder="Select…"
              type="single"
              options={["24 hours", "7 days", "14 days"]}
              value={daysLabel}
              onChange={(selected) => onDaysChange(selected[0] ?? "14 days")}
            />
          </TrayFormItem>
        </TraySection>

        {/* ── Column 2: Job Titles ── */}
        <TraySection icon={<IdCard className="h-5 w-5" />} heading="Job Titles">
          <TrayFormItem label="Job Title Includes">
            <TrayInput
              id="input-include"
              placeholder={'e.g. "Design", "Content"'}
              value={titleIncludes}
              onChange={onTitleIncludesChange}
            />
          </TrayFormItem>
          <TrayFormItem label="Job Title Excludes">
            <TrayInput
              id="input-exclude"
              placeholder={'e.g. "Marketing"'}
              value={titleExcludes}
              onChange={onTitleExcludesChange}
            />
          </TrayFormItem>
        </TraySection>

        {/* ── Column 3: Employers ── */}
        <TraySection icon={<Building2 className="h-5 w-5" />} heading="Employers">
          {/* Input and its suggested text sit together with a 4px gap */}
          <div className="flex flex-col gap-1">
            <TrayFormItem label="Exclude Employers">
              <TrayInput
                id="input-blacklist"
                placeholder={'e.g. "DataAnnotation"'}
                value={blacklist}
                onChange={onBlacklistChange}
              />
            </TrayFormItem>
            {/* Clicking a suggestion appends it (quoted, comma-separated) to the input above */}
            <p className="text-xs text-primary">
              Suggested:{" "}
              {["Prolific", "DataAnnotation", "Mercor", "hackajob"].map((name, i, arr) => (
                <span key={name}>
                  <button
                    type="button"
                    onClick={() => appendEmployerSuggestion(name)}
                    className="underline hover:opacity-70"
                  >
                    {name}
                  </button>
                  {i < arr.length - 1 && ", "}
                </span>
              ))}
            </p>
          </div>
        </TraySection>

      </div>

      {/* ── Close button ── */}
      <button
        id="settings-tray-close"
        type="button"
        onClick={onClose}
        aria-label="Close settings tray"
        className="shrink-0 text-primary hover:opacity-60"
      >
        <X className="h-5 w-5" />
      </button>

    </div>
  );
}

// ---------------------------------------------------------------------------
// Add Location Dialog
// ---------------------------------------------------------------------------

type LocationType = "hybrid" | "remote";

// Type-ahead city input that combines an instant static list with Photon
// geocoding results loaded after a 350ms debounce.
//
// Props:
//   inputValue  — controlled text shown in the input (may be a display string
//                 like "Edinburgh, UK" after a suggestion is selected)
//   onInputChange — called with raw text on every keystroke (free-form path)
//   onSelect    — called with the full LocationSuggestion when the user picks
//                 a suggestion from the dropdown; the parent is responsible for
//                 updating inputValue via setCityInput(s.display).
function LocationCombobox({
  id,
  inputValue,
  onInputChange,
  onSelect,
}: {
  id: string;
  inputValue: string;
  onInputChange: (text: string) => void;
  onSelect: (suggestion: LocationSuggestion) => void;
}) {
  const [open, setOpen] = useState(false);
  const [apiSuggestions, setApiSuggestions] = useState<LocationSuggestion[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Derive static matches instantly — cities that start with the query first,
  // then cities that merely contain it elsewhere.
  const staticSuggestions = useMemo(() => {
    const q = inputValue.trim().toLowerCase();
    if (q.length < 2) return [];
    const startsWith = POPULAR_CITIES.filter((s) =>
      s.city.toLowerCase().startsWith(q)
    );
    const contains = POPULAR_CITIES.filter(
      (s) =>
        !s.city.toLowerCase().startsWith(q) &&
        s.display.toLowerCase().includes(q)
    );
    return [...startsWith, ...contains].slice(0, 6);
  }, [inputValue]);

  // Merge: static first, then Photon results that aren't already shown.
  const suggestions = useMemo(() => {
    const staticDisplays = new Set(staticSuggestions.map((s) => s.display));
    const extra = apiSuggestions.filter((s) => !staticDisplays.has(s.display));
    return [...staticSuggestions, ...extra].slice(0, 8);
  }, [staticSuggestions, apiSuggestions]);

  // Fire (debounced) Photon lookup whenever the input changes.
  useEffect(() => {
    const q = inputValue.trim();

    if (q.length < 2) {
      setApiSuggestions([]);
      setIsLoading(false);
      setOpen(false);
      return;
    }

    setOpen(true);

    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(async () => {
      setIsLoading(true);
      try {
        const res = await fetch(`/api/location-search?q=${encodeURIComponent(q)}`);
        const data = (await res.json()) as { results?: LocationSuggestion[] };
        setApiSuggestions(data.results ?? []);
      } catch {
        setApiSuggestions([]);
      } finally {
        setIsLoading(false);
      }
    }, 350);

    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, [inputValue]);

  // Close on outside click.
  useEffect(() => {
    function onMouseDown(e: MouseEvent) {
      if (!containerRef.current?.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    document.addEventListener("mousedown", onMouseDown);
    return () => document.removeEventListener("mousedown", onMouseDown);
  }, []);

  function handleSelect(s: LocationSuggestion) {
    // The parent updates inputValue via onSelect → setCityInput(s.display).
    // We do NOT call onInputChange here so the parent's city state stays
    // set to s.city (the clean name) rather than the display string.
    onSelect(s);
    setOpen(false);
    setApiSuggestions([]);
  }

  const showDropdown =
    open && inputValue.trim().length >= 2 && (suggestions.length > 0 || isLoading);

  return (
    <div ref={containerRef} className="relative">
      <input
        id={id}
        type="text"
        autoComplete="off"
        value={inputValue}
        onChange={(e) => {
          onInputChange(e.target.value);
          // Clear stale Photon results immediately so they don't flash on the
          // next open while the new debounce timer is still running.
          setApiSuggestions([]);
        }}
        onFocus={() => {
          if (inputValue.trim().length >= 2) setOpen(true);
        }}
        onKeyDown={(e) => {
          if (e.key === "Escape") setOpen(false);
        }}
        placeholder='e.g. "Edinburgh, UK"'
        className="
          h-9 w-full rounded-full
          border border-black/8
          bg-control-background
          px-3
          text-sm font-light text-control-foreground placeholder:text-muted-foreground
          hover:bg-control-active
          focus:bg-control-active focus:border-black/32 focus:outline-none focus:ring-0
        "
      />

      {showDropdown && (
        <div
          className="
            absolute left-0 top-full z-[70] mt-1 w-full min-w-max
            rounded-2xl border border-black/8
            bg-control-surface
            p-1
            shadow-[0px_2px_4px_-2px_rgba(0,0,0,0.1),0px_4px_6px_-1px_rgba(0,0,0,0.1)]
          "
        >
          {suggestions.map((s) => (
            <button
              key={s.display}
              type="button"
              // onMouseDown + preventDefault keeps the input focused so blur
              // doesn't fire before the click is registered.
              onMouseDown={(e) => {
                e.preventDefault();
                handleSelect(s);
              }}
              className="flex w-full items-center gap-2 rounded-full px-2 py-1.5 text-left text-sm font-light text-primary hover:bg-black/5"
            >
              <MapPin className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
              {s.display}
            </button>
          ))}
          {isLoading && (
            <p className="px-3 py-1.5 text-xs text-muted-foreground">
              {suggestions.length === 0 ? "Searching…" : "Loading more…"}
            </p>
          )}
        </div>
      )}
    </div>
  );
}

// One of the two large icon-buttons in the dialog's Option Group.
function LocationOptionButton({
  locationType,
  selected,
  onClick,
}: {
  locationType: LocationType;
  selected: boolean;
  onClick: () => void;
}) {
  const Icon = locationType === "hybrid" ? Building2 : Globe;
  const label = locationType === "hybrid" ? "Hybrid / In-Person" : "Remote";

  return (
    <button
      type="button"
      onClick={onClick}
      className={`flex h-[138px] flex-1 flex-col items-center rounded-[12px] pt-[25px] pb-4 transition-colors ${
        selected
          ? "border-2 border-black/32 bg-control-active"
          : "border border-border bg-control-background hover:bg-control-active"
      }`}
    >
      {/* Icon — 25px from top via pt-[25px] on the button */}
      <Icon className="shrink-0 text-primary" style={{ width: 60, height: 60 }} />
      {/* Label — pushed to bottom, 16px clearance via pb-4 */}
      <span className="mt-auto text-center text-sm font-semibold text-primary">
        {label}
      </span>
    </button>
  );
}

// The modal dialog shown when the user clicks "Add Location" in the header.
function AddLocationDialog({
  onAdd,
  onClose,
}: {
  onAdd: (
    locationType: LocationType,
    data: { city: string; radiusKm: number; country: string }
  ) => void;
  onClose: () => void;
}) {
  const [locationType, setLocationType] = useState<LocationType>("hybrid");

  // cityInput — the text shown in the combobox input.
  // When the user picks a suggestion it becomes the display string
  // (e.g. "Edinburgh, UK"); when they type freely it's whatever they typed.
  const [cityInput, setCityInput] = useState("");
  // city — the clean city name stored for the search (e.g. "Edinburgh").
  // Derived from the suggestion on selection, or falls back to cityInput.
  const [city, setCity] = useState("");

  const [radiusOption, setRadiusOption] = useState<RadiusOption>("10km");

  // countryIndeed — the country_indeed value for hybrid searches.
  // Auto-filled when a suggestion is selected; manually overridable via TraySelect.
  const [countryIndeed, setCountryIndeed] = useState("United Kingdom");

  // Separate country state for the remote flow (unchanged behaviour).
  const [remoteCountry, setRemoteCountry] = useState("United Kingdom");

  // Called when the user picks a suggestion from the combobox dropdown.
  // Updates both the input display AND the derived city/country values.
  function handleLocationSelect(s: LocationSuggestion) {
    setCityInput(s.display);   // show "Edinburgh, UK" in the input
    setCity(s.city);           // store "Edinburgh" for the search
    setCountryIndeed(s.countryIndeed);
  }

  // Called on every free-form keystroke. Uses the raw text as the city
  // fallback so the user can still add a city not in any suggestion list.
  function handleCityInputChange(text: string) {
    setCityInput(text);
    setCity(text);
  }

  function handleAdd() {
    if (locationType === "hybrid") {
      onAdd(locationType, {
        city: (city || cityInput).trim(),
        radiusKm: radiusOptionToKm(radiusOption),
        country: countryIndeed,
      });
    } else {
      onAdd(locationType, {
        city: "",
        radiusKm: 0,
        country: remoteCountry,
      });
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      {/* Backdrop */}
      <div className="absolute inset-0 bg-black/32" onClick={onClose} />

      {/* Dialog card */}
      <div className="relative z-10 flex w-[388px] flex-col gap-6 rounded-[12px] border border-border bg-popover p-6">
        <h2 className="text-center text-lg font-semibold text-primary">Add Location</h2>

        {/* Option Group */}
        <div className="flex gap-6">
          <LocationOptionButton
            locationType="hybrid"
            selected={locationType === "hybrid"}
            onClick={() => setLocationType("hybrid")}
          />
          <LocationOptionButton
            locationType="remote"
            selected={locationType === "remote"}
            onClick={() => setLocationType("remote")}
          />
        </div>

        {/* Fields — swap based on type */}
        {locationType === "hybrid" ? (
          <div className="flex flex-col gap-4">
            {/* City combobox — suggests from static list instantly, Photon after 350ms */}
            <TrayFormItem label="City or Region">
              <LocationCombobox
                id="dialog-city"
                inputValue={cityInput}
                onInputChange={handleCityInputChange}
                onSelect={handleLocationSelect}
              />
            </TrayFormItem>
            <TrayFormItem
              label={
                <>
                  Search Radius{" "}
                  <span className="font-normal text-muted-foreground">(km)</span>
                </>
              }
            >
              <TraySelect
                id="dialog-radius"
                placeholder="Select radius"
                options={[...RADIUS_OPTIONS]}
                type="single"
                defaultValue={radiusOption}
                onChange={(selected) => {
                  if (selected[0]) setRadiusOption(selected[0] as RadiusOption);
                }}
              />
            </TrayFormItem>
          </div>
        ) : (
          <TrayFormItem label="Country">
            <TraySelect
              id="dialog-country"
              placeholder="Select a country"
              options={[...INDEED_COUNTRIES]}
              type="single"
              defaultValue="United Kingdom"
              searchable
              searchPlaceholder="Search Countries"
              onChange={(selected) => {
                if (selected[0]) setRemoteCountry(selected[0]);
              }}
            />
          </TrayFormItem>
        )}

        {/* Action buttons */}
        <div className="flex gap-2">
          <button
            id="button-dialog-add-location"
            type="button"
            onClick={handleAdd}
            className="h-9 rounded-full bg-secondary px-4 text-sm font-bold text-secondary-foreground shadow-[0px_1px_2px_0px_rgba(0,0,0,0.1)] hover:opacity-90"
          >
            Add Location
          </button>
          <button
            type="button"
            onClick={onClose}
            className="h-9 rounded-full bg-accent px-4 text-sm font-bold text-accent-foreground shadow-[0px_1px_2px_0px_rgba(0,0,0,0.1)] hover:opacity-90"
          >
            Cancel
          </button>
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Mini Button components (Figma: "Mini Button" node 270-5164)
// Rest: control-background fill + muted border.
// Hover: control-active fill + shadow.
// Pressed: neutral-mid (#e2dbd4) fill.
// ---------------------------------------------------------------------------

// Simple action mini-button (no dropdown).
function MiniButton({
  id,
  icon: Icon,
  label,
  onClick,
}: {
  id?: string;
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  onClick: () => void;
}) {
  return (
    <button
      id={id}
      type="button"
      onClick={onClick}
      className="flex items-center gap-2 rounded-full border border-muted bg-control-background px-2 py-1 text-xs font-normal text-muted-foreground hover:bg-control-active hover:shadow-[0px_1px_2px_0px_rgba(0,0,0,0.1)] active:bg-[#e2dbd4] transition-colors"
    >
      <Icon className="h-4 w-4 shrink-0" />
      {label}
    </button>
  );
}

// Mini-button with a dropdown list — used for the radius picker.
function MiniButtonDropdown({
  id,
  icon: Icon,
  label,
  options,
  onSelect,
}: {
  id?: string;
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  options: readonly string[];
  onSelect: (option: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function onMouseDown(e: MouseEvent) {
      if (!containerRef.current?.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", onMouseDown);
    return () => document.removeEventListener("mousedown", onMouseDown);
  }, []);

  return (
    <div ref={containerRef} className="relative">
      <button
        id={id}
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="flex items-center gap-2 rounded-full border border-muted bg-control-background px-2 py-1 text-xs font-normal text-muted-foreground hover:bg-control-active hover:shadow-[0px_1px_2px_0px_rgba(0,0,0,0.1)] active:bg-[#e2dbd4] transition-colors"
      >
        <Icon className="h-4 w-4 shrink-0" />
        <span className="flex items-center gap-1">
          {label}
          <ChevronDown className="h-4 w-4 shrink-0" />
        </span>
      </button>

      {open && (
        <div className="absolute left-0 top-full z-50 mt-1 min-w-max rounded-2xl border border-black/8 bg-control-surface p-1 shadow-[0px_2px_4px_-2px_rgba(0,0,0,0.1),0px_4px_6px_-1px_rgba(0,0,0,0.1)]">
          {options.map((opt) => (
            <button
              key={opt}
              type="button"
              onMouseDown={(e) => {
                e.preventDefault();
                onSelect(opt);
                setOpen(false);
              }}
              className="flex w-full items-center rounded-full px-3 py-1.5 text-left text-sm font-light text-primary hover:bg-black/5"
            >
              {opt}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

function JobApplyAction({ links }: { links: JobLink[] }) {
  if (links.length === 0) {
    return (
      <span className="inline-flex items-center gap-1 text-secondary-foreground/60">
        Apply
        <ExternalLink className="h-4 w-4" />
      </span>
    );
  }

  if (links.length === 1) {
    return (
      <a
        href={links[0].url}
        target="_blank"
        rel="noopener noreferrer"
        className="inline-flex items-center gap-1 hover:opacity-80"
      >
        Apply
        <ExternalLink className="h-4 w-4" />
      </a>
    );
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger className="group inline-flex items-center gap-1 hover:opacity-80 transition-opacity">
        Apply
        <ExternalLink className="h-4 w-4" />
        <ChevronDown className="h-4 w-4 opacity-0 group-hover:opacity-100 transition-opacity" />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-max min-w-max">
        {links.map((link) => {
          const label =
            link.location && link.location.trim().length > 0
              ? `${formatSiteName(link.site)} (${link.location})`
              : formatSiteName(link.site);

          return (
            <DropdownMenuItem key={`${link.site}-${link.url}`}>
              <a href={link.url} target="_blank" rel="noopener noreferrer" className="w-full">
                {label}
              </a>
            </DropdownMenuItem>
          );
        })}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

const markdownComponents: Components = {
  h1: ({ children, ...props }) => (
    <h4 className="mt-6 text-xl font-heading font-regular leading-tight tracking-tight first:mt-0" {...props}>
      {children}
    </h4>
  ),
  h2: ({ children, ...props }) => (
    <h5 className="mt-5 text-lg font-heading font-regular leading-tight tracking-tight first:mt-0" {...props}>
      {children}
    </h5>
  ),
  h3: ({ children, ...props }) => (
    <h6 className="mt-4 text-base font-heading font-medium leading-tight tracking-tight first:mt-0" {...props}>
      {children}
    </h6>
  ),
  h4: ({ children, ...props }) => (
    <h6 className="mt-4 text-base font-heading font-medium leading-tight tracking-tight first:mt-0" {...props}>
      {children}
    </h6>
  ),
  h5: ({ children, ...props }) => (
    <h6 className="mt-4 text-base font-heading font-medium leading-tight tracking-tight first:mt-0" {...props}>
      {children}
    </h6>
  ),
  h6: ({ children, ...props }) => (
    <h6 className="mt-4 text-base font-heading font-medium leading-tight tracking-tight first:mt-0" {...props}>
      {children}
    </h6>
  ),
  p: ({ children, ...props }) => (
    <p className="my-0 leading-relaxed text-foreground/95 first:mt-0 mb-6 font-light" {...props}>
      {children}
    </p>
  ),
  ul: ({ children, ...props }) => (
    <ul className="my-4 list-disc space-y-2 pl-6 leading-7 text-foreground/95 font-light" {...props}>
      {children}
    </ul>
  ),
  ol: ({ children, ...props }) => (
    <ol className="my-4 list-decimal space-y-2 pl-6 leading-7 text-foreground/95 font-light" {...props}>
      {children}
    </ol>
  ),
  li: ({ children, ...props }) => (
    <li className="leading-7 font-light" {...props}>
      {children}
    </li>
  ),
  strong: ({ children, ...props }) => (
    <strong className="font-semibold text-foreground" {...props}>
      {children}
    </strong>
  ),
  em: ({ children, ...props }) => (
    <em className="italic text-foreground/95" {...props}>
      {children}
    </em>
  ),
  blockquote: ({ children, ...props }) => (
    <blockquote className="my-4 border-l-4 border-border pl-4 italic text-foreground/80" {...props}>
      {children}
    </blockquote>
  ),
  code: ({ children, className, ...props }) => {
    const isBlock = Boolean(className);

    if (isBlock) {
      return (
        <code className={className} {...props}>
          {children}
        </code>
      );
    }

    return (
      <code className="rounded bg-muted px-1.5 py-0.5 font-mono text-[0.92em] text-foreground" {...props}>
        {children}
      </code>
    );
  },
  pre: ({ children, ...props }) => (
    <pre className="my-4 overflow-x-auto rounded-2xl bg-muted p-4 text-sm leading-6 text-foreground" {...props}>
      {children}
    </pre>
  ),
  a: ({ children, ...props }) => (
    <a className="font-medium underline underline-offset-4 hover:opacity-80" {...props}>
      {children}
    </a>
  ),
  hr: ({ ...props }) => <hr className="my-6 border-border" {...props} />,
  table: ({ children, ...props }) => (
    <div className="my-4 overflow-x-auto">
      <table className="w-full border-collapse text-sm" {...props}>
        {children}
      </table>
    </div>
  ),
  thead: ({ children, ...props }) => <thead className="bg-muted/70" {...props}>{children}</thead>,
  tbody: ({ children, ...props }) => <tbody {...props}>{children}</tbody>,
  tr: ({ children, ...props }) => <tr className="border-b border-border last:border-b-0" {...props}>{children}</tr>,
  th: ({ children, ...props }) => (
    <th className="border border-border px-3 py-2 text-left font-semibold text-foreground" {...props}>
      {children}
    </th>
  ),
  td: ({ children, ...props }) => (
    <td className="border border-border px-3 py-2 align-top text-foreground/95" {...props}>
      {children}
    </td>
  ),
};

function JobDescriptionMarkdown({ content }: { content: string }) {
  return (
    <ReactMarkdown remarkPlugins={[remarkGfm]} components={markdownComponents}>
      {content}
    </ReactMarkdown>
  );
}

function JobTitleCell({
  title,
  onOpen,
  showNewIndicator,
}: {
  title: string;
  onOpen: () => void;
  showNewIndicator: boolean;
}) {
  return (
    <div className="flex w-full min-w-0 items-center gap-2">
      <button
        type="button"
        onClick={onOpen}
        className="truncate text-left underline hover:opacity-80"
        title={title}
      >
        {title}
      </button>

      {showNewIndicator && <span className="h-[6px] w-[6px] shrink-0 rounded-full bg-[#D74343]" aria-hidden="true" />}
    </div>
  );
}

function JobStatusCell({
  status,
  onChange,
  forceWhite,
  permanentChevron,
}: {
  status: JobStatus;
  onChange: (status: JobStatus) => void;
  forceWhite?: boolean;
  permanentChevron?: boolean;
}) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        className={`group inline-flex items-center gap-1 cursor-pointer font-semibold hover:opacity-80 transition-opacity ${forceWhite ? "text-white" : ""}`}
        style={forceWhite ? undefined : statusTextColor(status)}
      >
        {status}
        {/* Chevron is always visible when permanentChevron or forceWhite is set, otherwise fades in on hover */}
        <ChevronDown className={`h-4 w-4 ${(forceWhite || permanentChevron) ? "" : "opacity-0 group-hover:opacity-100 transition-opacity"}`} />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-36">
        {STATUS_OPTIONS.map((option) => (
          <DropdownMenuItem key={option} onClick={() => onChange(option)}>
            {option}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function IndustryCell({
  industry,
  onChange,
}: {
  industry: string;
  onChange: (industry: string | null) => void;
}) {
  const displayText = industry || "-";

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        className="group inline-flex items-center gap-1 cursor-pointer hover:opacity-80 transition-opacity"
      >
        {displayText}
        <ChevronDown className="h-4 w-4 opacity-0 group-hover:opacity-100 transition-opacity" />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-max">
        {[...INDUSTRY_LABELS].sort().map((option) => (
          <DropdownMenuItem
            key={option}
            onClick={() => onChange(option)}
            disabled={industry === option}
          >
            {option}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}


function SeniorityCell({
  seniority,
  onChange,
}: {
  seniority: string;
  onChange: (seniority: string | null) => void;
}) {
  const displayText = seniority || "-";

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        className="group inline-flex items-center gap-1 cursor-pointer hover:opacity-80 transition-opacity"
      >
        {displayText}
        <ChevronDown className="h-4 w-4 opacity-0 group-hover:opacity-100 transition-opacity" />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-max">
        {SENIORITY_LABELS.map((option) => (
          <DropdownMenuItem
            key={option}
            onClick={() => onChange(option)}
            disabled={seniority === option}
          >
            {option}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}


// ---------------------------------------------------------------------------
// Empty Search State
// ---------------------------------------------------------------------------

// Shown when no searches have been run yet — fills the remaining content area
// and centres an illustration + two lines of muted copy.
function EmptySearchState() {
  return (
    <div className="flex flex-1 flex-col items-center justify-center">
      <div className="flex flex-col items-center gap-6">
        {/* Illustration */}
        <svg width="174" height="124" viewBox="0 0 174 124" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
          <path d="M0 91.9113C0 91.9113 18.2514 79.55 65.3757 85.7305C112.5 91.9111 103.974 93.9119 128.237 94.4563C152.5 95.0007 174 85.7305 174 85.7305V105H0V91.9113Z" fill="#D2CCC8" fillOpacity="0.3"/>
          <line x1="4.37114e-08" y1="104.5" x2="174" y2="104.5" stroke="#D2CCC8"/>
          <path d="M0 91.8196C0 91.8196 16.4662 79.6016 58.9809 85.7105C101.496 91.8194 75.3323 104.209 156.98 104.757C238.628 105.304 0 104.757 0 104.757V91.8196Z" fill="#D2CCC8" fillOpacity="0.2"/>
          <path d="M31 5.5C31 2.46243 33.4624 0 36.5 0C39.5376 0 42 2.46243 42 5.5V114C42 114 41 115.5 36.5 115.5C32 115.5 31 114 31 114V5.5Z" fill="#DBD6D3"/>
          <path d="M128 26C128 22.134 131.134 19 135 19C138.866 19 142 22.134 142 26V122C142 122 142 124 135.5 124C129 124 128 122 128 122V26Z" fill="#D2CCC8"/>
          <path d="M17 23V45C17 51.6274 22.3726 57 29 57H44C50.6274 57 56 51.6274 56 45V37.2955" stroke="#DBD6D3" strokeWidth="8" strokeLinecap="round"/>
          <path d="M159 48V72C159 78.6274 153.627 84 147 84H123C116.373 84 111 78.6274 111 72V63.1364" stroke="#D2CCC8" strokeWidth="12" strokeLinecap="round"/>
        </svg>

        {/* Copy */}
        <div className="flex flex-col items-center gap-2">
          <h2 className="font-heading text-2xl font-normal tracking-[-0.036em] text-[#D2CCC8]">
            Nothing to see yet.
          </h2>
          <p className="font-sans text-sm font-light leading-5 text-[#D2CCC8]">
            Run a search to see some stuff.
          </p>
        </div>
      </div>
    </div>
  );
}

// Mobile-only card list – shown instead of the table on small screens.
// `results` receives the already-client-filtered rows from the parent.
function MobileJobList({
  search,
  results,
  onOpenJob,
  onStatusChange,
}: {
  search: SearchData;
  results: Array<Record<string, unknown>>;
  onOpenJob: (searchSlug: string, statusKey: string) => void;
  onStatusChange: (statusKey: string, status: JobStatus) => void;
}) {
  const sortedResults = useMemo(
    () =>
      [...results].sort((a, b) => {
        const da = getSortTimestamp(a);
        const db = getSortTimestamp(b);
        return db - da;
      }),
    [results]
  );

  if (sortedResults.length === 0) {
    return (
      <p className="p-4 text-sm text-muted-foreground">No jobs found for this search.</p>
    );
  }

  return (
    <ul id={`mobile-job-list-${search.slug}`} className="px-4 py-4">
      {sortedResults.map((row, index) => {
        const statusKey = getStatusKey(row);
        const title = String(row["title"] ?? "");
        const company = toDisplayValue(row["company"]);
        const industry = String(row["industry_label"] ?? "") || "-";
        const age = formatAge(row);
        const status = toJobStatus(row["job_status"]);

        return (
          <li key={`${search.slug}-mobile-${index}`} id={`mobile-job-entry-${search.slug}-${index}`}>
            {/* Entry row: left info + right status button */}
            <div className="flex items-center gap-3 py-1">

              {/* Left section: title and metadata */}
              <div className="min-w-0 flex-1">
                <h3 className="font-heading text-base font-sans leading-tight text-primary">
                  <button
                    type="button"
                    onClick={() => onOpenJob(search.slug, statusKey)}
                    className="text-left"
                  >
                    {title}
                  </button>
                </h3>
                {/* Company · Industry · Age row with dot separators – missing values are omitted */}
                <div className="mt-1 flex flex-wrap items-center gap-2 text-sm text-muted-foreground">
                  {[company, industry, age]
                    .filter((item) => item && item !== "-")
                    .map((item, i, arr) => (
                      <span key={item} className="inline-flex items-center gap-2">
                        {item}
                        {/* Dot separator after every item except the last */}
                        {i < arr.length - 1 && (
                          <span className="h-[2px] w-[2px] shrink-0 rounded-full bg-muted-foreground" aria-hidden="true" />
                        )}
                      </span>
                    ))}
                </div>
              </div>

              {/* Right section: status dropdown, chevron always visible */}
              <div className="shrink-0 flex items-center">
                <JobStatusCell
                  status={status}
                  permanentChevron
                  onChange={(nextStatus) => onStatusChange(statusKey, nextStatus)}
                />
              </div>
            </div>

            {/* Divider between entries (not after the last one) */}
            {index < sortedResults.length - 1 && (
              <div className="my-2 border-t border-border" aria-hidden="true" />
            )}
          </li>
        );
      })}
    </ul>
  );
}

export default function Home() {
  const [searches, setSearches] = useState<SearchData[]>([]);
  const [activeTab, setActiveTab] = useState<string>("");
  // Note: the keyword input is intentionally uncontrolled (no useState) so that
  // typing does not trigger a Home re-render. The ref gives us the current value
  // whenever we need it (e.g. on Search click). See keywordInputRef below.
  // keywordHasValue tracks only whether the field is empty or not — this is a
  // boolean so it only causes a re-render when the user first types (false→true)
  // or clears the field entirely (true→false), not on every character.
  const [keywordHasValue, setKeywordHasValue] = useState(false);
  // Persisted so the uncontrolled input gets the right defaultValue when it
  // remounts after the loading spinner (which unmounts the input before the
  // config fetch has a chance to set keywordInputRef.current.value).
  const [savedKeywords, setSavedKeywords] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [refreshingAll, setRefreshingAll] = useState(false);
  const [refreshingSlug, setRefreshingSlug] = useState<string | null>(null);
  const [selectedJob, setSelectedJob] = useState<JobSelection | null>(null);
  const [selectedJobDescription, setSelectedJobDescription] = useState("");
  const [isDescriptionLoading, setIsDescriptionLoading] = useState(false);

  // ---------------------------------------------------------------------------
  // Settings tray state — lifted here so values persist while the tray is closed
  // and are readable by the Search button handler.
  // Initialised to the defaults from user-config.ts; overwritten when the config
  // loads from the API.
  // ---------------------------------------------------------------------------
  const [traySites, setTraySites] = useState<string[]>(["LinkedIn", "Indeed", "Glassdoor"]);
  const [trayDaysLabel, setTrayDaysLabel] = useState<AgeLabel>("14 days");
  const [trayTitleIncludes, setTrayTitleIncludes] = useState<string>("");
  const [trayTitleExcludes, setTrayTitleExcludes] = useState<string>("");
  const [trayBlacklist, setTrayBlacklist] = useState<string>("");

  // The config as it was last saved — used to detect whether the user changed
  // anything before clicking Search.
  const [savedConfig, setSavedConfig] = useState<UserConfig | null>(null);

  // Draft tabs created by "Add Location" — displayed immediately for feedback
  // while the config saves and the search runs in the background.
  const [draftTabs, setDraftTabs] = useState<{ id: string; title: string }[]>([]);

  // Add Location dialog visibility.
  const [showAddLocationDialog, setShowAddLocationDialog] = useState(false);

  // Slugs of tabs where the user has temporarily disabled client-side filters.
  // Stored as a Set so lookups are O(1). Always create a new Set when mutating
  // so React detects the state change.
  const [filtersDisabledTabs, setFiltersDisabledTabs] = useState<Set<string>>(new Set());

  // Which settings tray is currently open, or null if closed.
  //   "search" — keyword search settings (triggered by the keyword input)
  const [activeTray, setActiveTray] = useState<"search" | null>(null);

  // Refs used to detect clicks outside the tray and the keyword input.
  const settingsTrayRef = useRef<HTMLElement>(null);
  const keywordInputRef = useRef<HTMLInputElement>(null);

  // Keep a stable ref to searches so the polling interval never has stale closure issues.
  const searchesRef = useRef(searches);
  useEffect(() => { searchesRef.current = searches; });

  const descPollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    const hasUncached = searches.some((s) =>
      s.results.some((r) => !r["description"] && getRowPrimaryLink(r))
    );

    if (!hasUncached) {
      if (descPollRef.current !== null) {
        clearInterval(descPollRef.current);
        descPollRef.current = null;
      }
      return;
    }

    // Already polling — the running interval will pick up new descriptions.
    if (descPollRef.current !== null) return;

    descPollRef.current = setInterval(() => {
      const jobs = searchesRef.current.flatMap((s) =>
        s.results
          .filter((r) => !r["description"])
          .map((r) => getRowPrimaryLink(r))
          .filter((l): l is { site: string; url: string } => l !== null)
      );

      if (jobs.length === 0) {
        clearInterval(descPollRef.current!);
        descPollRef.current = null;
        return;
      }

      void (async () => {
        try {
          const res = await fetch("/api/job-descriptions/batch", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ jobs }),
          });
          if (!res.ok) return;
          const data = (await res.json()) as { descriptions: Record<string, string> };
          if (!Object.keys(data.descriptions).length) return;

          setSearches((prev) =>
            prev.map((search) => ({
              ...search,
              results: search.results.map((row) => {
                if (row["description"]) return row;
                const link = getRowPrimaryLink(row);
                if (!link) return row;
                const key = buildDescKey(link.site, link.url);
                const desc = data.descriptions[key];
                return desc ? { ...row, description: desc } : row;
              }),
            }))
          );
        } catch {
          // ignore transient poll errors
        }
      })();
    }, 3000);

    return () => {
      if (descPollRef.current !== null) {
        clearInterval(descPollRef.current);
        descPollRef.current = null;
      }
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searches]);

  // Close the tray when the user clicks outside the tray, the keyword input, and the tab bar.
  // Clicks inside the tab bar are excluded so switching tabs swaps the tray without closing it.
  useEffect(() => {
    function handleMouseDown(event: MouseEvent) {
      const target = event.target as Node;
      const outsideTray = !settingsTrayRef.current?.contains(target);
      const outsideKeyword = !keywordInputRef.current?.contains(target);
      const tabBar = document.getElementById("dashboard-tab-bar");
      const outsideTabBar = !tabBar?.contains(target);
      // Exclude the search button: closing the tray on mousedown shifts the layout
      // before click fires, which can suppress the click event entirely. The tray
      // is closed explicitly inside handleSearch instead.
      const searchButton = document.getElementById("button-search");
      const outsideSearchButton = !searchButton?.contains(target);
      // Exclude the settings and add-location buttons for the same reason.
      const settingsButton = document.getElementById("button-settings");
      const outsideSettingsButton = !settingsButton?.contains(target);
      // Exclude add-location: mousedown fires before the dialog opens, so without
      // this exclusion the tray would close before showAddLocationDialog becomes true.
      const addLocationButton = document.getElementById("button-add-location");
      const outsideAddLocation = !addLocationButton?.contains(target);
      if (outsideTray && outsideKeyword && outsideTabBar && outsideSearchButton && outsideSettingsButton && outsideAddLocation && !showAddLocationDialog) {
        setActiveTray(null);
      }
    }

    document.addEventListener("mousedown", handleMouseDown);
    return () => document.removeEventListener("mousedown", handleMouseDown);
  }, [showAddLocationDialog]);

  // Fetch searches from the API.
  // forceRefresh=true bypasses the 4-hour stale cache check and re-runs every search.
  // fullPeriod=true additionally ignores the cached lastUpdated so each search
  // covers the full hours_old window — used when the user changes criteria.
  const loadSearches = useCallback(async (forceRefresh: boolean, fullPeriod = false) => {
    const params = new URLSearchParams();
    if (forceRefresh) params.set("forceRefresh", "true");
    if (fullPeriod)   params.set("fullPeriod", "true");
    const query = params.size > 0 ? `?${params.toString()}` : "";

    const response = await fetch(`/api/searches${query}`, { cache: "no-store" });
    const payload = (await response.json()) as { searches?: SearchData[]; error?: string };

    if (!response.ok) {
      throw new Error(payload.error ?? "Failed to load search data");
    }

    return payload.searches ?? [];
  }, []);

  // Load the persisted user config once on mount and use it to initialise the tray
  // controls. Silently ignored if the config has never been saved yet.
  useEffect(() => {
    const loadConfig = async () => {
      try {
        const response = await fetch("/api/user-config", { cache: "no-store" });
        if (!response.ok) return;
        const config = (await response.json()) as UserConfig;
        setSavedConfig(config);
        // Initialise keyword input and all tray controls from the loaded config.
        setSavedKeywords(config.keywords);
        // Set the uncontrolled input's DOM value directly if it is already
        // mounted; if not (e.g. still behind the loading spinner), defaultValue
        // on the input will pick up savedKeywords when it mounts.
        if (keywordInputRef.current) {
          keywordInputRef.current.value = formatListForDisplay(config.keywords);
        }
        setKeywordHasValue(config.keywords.length > 0);
        setTraySites(
          config.sites.map((key) => SITE_KEY_TO_NAME[key]).filter(Boolean)
        );
        setTrayDaysLabel(daysToLabel(config.daysOld));
        setTrayTitleIncludes(formatListForDisplay(config.titleIncludes));
        setTrayTitleExcludes(formatListForDisplay(config.titleExcludes));
        setTrayBlacklist(formatListForDisplay(config.employerBlacklist));
      } catch {
        // Config load failures are non-fatal — tray stays at defaults.
      }
    };
    void loadConfig();
  }, []);

  useEffect(() => {
    const loadData = async () => {
      try {
        setLoading(true);
        const items = await loadSearches(false);
        setSearches(items);

        if (items.length > 0) {
          setActiveTab(items[0].slug);
        }
      } catch (err) {
        setError(String(err));
      } finally {
        setLoading(false);
      }
    };

    void loadData();
  }, [loadSearches]);

  const resolvedActiveTab = useMemo(() => {
    // Draft tabs take priority — if the active tab is a draft, return it as-is.
    if (draftTabs.some((tab) => tab.id === activeTab)) {
      return activeTab;
    }
    if (searches.length === 0) {
      return "";
    }
    const hasActive = searches.some((item) => item.slug === activeTab);
    return hasActive ? activeTab : searches[0].slug;
  }, [activeTab, searches, draftTabs]);

  const globalLastUpdated = useMemo(() => {
    if (searches.length === 0) {
      return null;
    }

    const newest = searches.reduce((maxTs, search) => {
      const ts = new Date(search.lastUpdated).getTime();
      if (Number.isNaN(ts)) {
        return maxTs;
      }
      return Math.max(maxTs, ts);
    }, 0);

    return newest > 0 ? new Date(newest).toISOString() : null;
  }, [searches]);

  // Debounce filter inputs so the table only re-filters after the user pauses typing.
  const debouncedTitleIncludes = useDebounce(trayTitleIncludes, 300);
  const debouncedTitleExcludes = useDebounce(trayTitleExcludes, 300);
  const debouncedBlacklist = useDebounce(trayBlacklist, 300);

  // Parse the debounced tray filter inputs into arrays once, so the filteredResultsMap memo
  // only re-runs when the parsed content actually changes (not on every char typed).
  const parsedIncludes = useMemo(() => parseListInput(debouncedTitleIncludes), [debouncedTitleIncludes]);
  const parsedExcludes = useMemo(() => parseListInput(debouncedTitleExcludes), [debouncedTitleExcludes]);
  const parsedBlacklist = useMemo(() => parseListInput(debouncedBlacklist), [debouncedBlacklist]);

  // Client-side filtered results keyed by search slug.
  // Re-computes instantly whenever the filter state or the raw results change —
  // no network call required for filter-only changes.
  const filteredResultsMap = useMemo(() => {
    return new Map(
      searches.map((search) => [
        search.slug,
        // When the user has disabled filters for this tab, show all results unfiltered.
        filtersDisabledTabs.has(search.slug)
          ? search.results
          : applyClientFilters(search.results, parsedIncludes, parsedExcludes, parsedBlacklist),
      ])
    );
  }, [searches, parsedIncludes, parsedExcludes, parsedBlacklist, filtersDisabledTabs]);

  const refreshTooltip = useMemo(() => {
    const rawTotal = searches.reduce(
      (sum, search) => sum + (Number.isFinite(search.rawResultCount) ? search.rawResultCount : search.resultCount),
      0
    );
    const filteredTotal = [...filteredResultsMap.values()].reduce(
      (sum, results) => sum + results.length,
      0
    );
    const formattedDate = formatDateDdMmYyyyAtHhMm(globalLastUpdated);

    return `Last updated ${formattedDate}. ${rawTotal} jobs found, ${filteredTotal} after filters applied.`;
  }, [globalLastUpdated, searches, filteredResultsMap]);

  const selectedJobRow = useMemo(() => {
    if (!selectedJob) {
      return null;
    }

    const selectedSearch = searches.find((search) => search.slug === selectedJob.searchSlug);
    if (!selectedSearch) {
      return null;
    }

    return (
      selectedSearch.results.find((row) => getStatusKey(row) === selectedJob.statusKey) ?? null
    );
  }, [searches, selectedJob]);

  const selectedJobLinks = useMemo<JobLink[]>(() => {
    if (!selectedJobRow) {
      return [];
    }

    if (isJobLinkArray(selectedJobRow["job_url"])) {
      return selectedJobRow["job_url"];
    }

    if (selectedJobRow["job_url"]) {
      return [{ site: "view", url: String(selectedJobRow["job_url"]) }];
    }

    return [];
  }, [selectedJobRow]);

  const selectedJobPrimaryLink = useMemo<JobLink | null>(() => {
    return selectedJobLinks.find((link) => {
      const site = String(link.site ?? "").trim().toLowerCase();
      const url = String(link.url ?? "").trim();
      return site && site !== "view" && url;
    }) ?? null;
  }, [selectedJobLinks]);

  useEffect(() => {
    let isCancelled = false;

    const fetchDescription = async () => {
      if (!selectedJobRow) {
        if (!isCancelled) {
          setSelectedJobDescription("");
          setIsDescriptionLoading(false);
        }
        return;
      }

      const existingDescription = String(selectedJobRow["description"] ?? "").trim();
      if (existingDescription) {
        if (!isCancelled) {
          setSelectedJobDescription(existingDescription);
          setIsDescriptionLoading(false);
        }
        return;
      }

      if (!selectedJobPrimaryLink) {
        if (!isCancelled) {
          setSelectedJobDescription("");
          setIsDescriptionLoading(false);
        }
        return;
      }

      setIsDescriptionLoading(true);
      try {
        const response = await fetch("/api/job-descriptions", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            site: selectedJobPrimaryLink.site,
            url: selectedJobPrimaryLink.url,
          }),
        });

        const payload = (await response.json()) as { description?: string; error?: string };
        if (!response.ok) {
          throw new Error(payload.error ?? "Failed to fetch job description");
        }

        const fetchedDescription = String(payload.description ?? "").trim();
        if (isCancelled) {
          return;
        }

        setSelectedJobDescription(fetchedDescription);

        if (fetchedDescription && selectedJob) {
          setSearches((current) =>
            current.map((search) => {
              if (search.slug !== selectedJob.searchSlug) {
                return search;
              }

              return {
                ...search,
                results: search.results.map((row) => {
                  const rowKey = String(row["status_key"] ?? "").trim().toLowerCase();
                  if (rowKey !== selectedJob.statusKey) {
                    return row;
                  }

                  return {
                    ...row,
                    description: fetchedDescription,
                  };
                }),
              };
            })
          );
        }
      } catch {
        if (!isCancelled) {
          setSelectedJobDescription("");
        }
      } finally {
        if (!isCancelled) {
          setIsDescriptionLoading(false);
        }
      }
    };

    void fetchDescription();

    return () => {
      isCancelled = true;
    };
  }, [selectedJob, selectedJobPrimaryLink, selectedJobRow]);

  const displayedSelectedJobDescription = useMemo(() => {
    if (!selectedJobRow) {
      return "";
    }

    const rowDescription = String(selectedJobRow["description"] ?? "").trim();
    if (rowDescription) {
      return rowDescription;
    }

    return selectedJobDescription;
  }, [selectedJobDescription, selectedJobRow]);

  // ---------------------------------------------------------------------------
  // Debug reset
  // ---------------------------------------------------------------------------

  // Clears all search state and tray inputs back to empty defaults, and writes
  // the default config to the backend so the reset survives a page refresh.
  async function handleResetDebug() {
    // Reset the backend: wipes config to defaults and deletes all search cache files.
    try {
      await fetch("/api/user-config", { method: "DELETE" });
    } catch {
      // Non-fatal — still reset the UI even if the backend call fails.
    }

    // Reset UI state.
    if (keywordInputRef.current) {
      keywordInputRef.current.value = "";
    }
    setKeywordHasValue(false);
    setTraySites(["LinkedIn", "Indeed", "Glassdoor"]);
    setTrayDaysLabel("14 days");
    setTrayTitleIncludes("");
    setTrayTitleExcludes("");
    setTrayBlacklist("");
    setSavedConfig(null);
    setSearches([]);
    setSelectedJob(null);
    setError(null);
  }

  // ---------------------------------------------------------------------------
  // Search button handler
  // ---------------------------------------------------------------------------

  // Builds a partial UserConfig from the current tray + keyword state.
  function buildCurrentConfig(): Partial<UserConfig> {
    return {
      keywords: parseListInput(keywordInputRef.current?.value ?? ""),
      sites: traySites.map((name) => SITE_NAME_TO_KEY[name]).filter(Boolean),
      daysOld: DAYS_LABEL_TO_DAYS[trayDaysLabel] ?? 14,
      titleIncludes: parseListInput(trayTitleIncludes),
      titleExcludes: parseListInput(trayTitleExcludes),
      employerBlacklist: parseListInput(trayBlacklist),
    };
  }

  // Returns true if any field that drives what JobSpy fetches has changed vs. the
  // last saved config (keywords, sites, date window). These require a fresh search.
  // Returns true when savedConfig is null — no confirmed backend state.
  function hasSearchCriteriaChanged(): boolean {
    if (!savedConfig) return true;
    const current = buildCurrentConfig();
    const sort = (arr: string[]) => [...arr].sort();

    return (
      JSON.stringify(sort(current.keywords ?? [])) !== JSON.stringify(sort(savedConfig.keywords)) ||
      JSON.stringify(sort(current.sites ?? [])) !== JSON.stringify(sort(savedConfig.sites)) ||
      (current.daysOld ?? 14) !== savedConfig.daysOld
    );
  }

  // Returns true if any config field (including filters) has changed.
  // Used to decide whether we need to persist the config to the backend.
  function hasAnyConfigChanged(): boolean {
    if (!savedConfig) return true;
    const current = buildCurrentConfig();
    const sort = (arr: string[]) => [...arr].sort();

    return (
      JSON.stringify(sort(current.keywords ?? [])) !== JSON.stringify(sort(savedConfig.keywords)) ||
      JSON.stringify(sort(current.sites ?? [])) !== JSON.stringify(sort(savedConfig.sites)) ||
      (current.daysOld ?? 14) !== savedConfig.daysOld ||
      JSON.stringify(current.titleIncludes ?? []) !== JSON.stringify(savedConfig.titleIncludes) ||
      JSON.stringify(current.titleExcludes ?? []) !== JSON.stringify(savedConfig.titleExcludes) ||
      JSON.stringify(sort(current.employerBlacklist ?? [])) !== JSON.stringify(sort(savedConfig.employerBlacklist))
    );
  }

  // Clicking Search:
  //   • Search criteria changed (keywords/sites/days) → save config + full re-fetch.
  //   • Filter-only changed (include/exclude/blacklist) + results in memory → save
  //     config only; client-side filters are already applied reactively, no fetch needed.
  //   • Nothing changed → incremental refresh (new jobs since the last update).
  const handleSearch = async () => {
    try {
      setActiveTray(null);
      setRefreshingAll(true);
      setError(null);

      const criteriaChanged = hasSearchCriteriaChanged();
      const anyChanged = hasAnyConfigChanged();

      // Persist the config whenever anything changed.
      if (anyChanged) {
        const updatedFields = buildCurrentConfig();
        const saveResponse = await fetch("/api/user-config", {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(updatedFields),
        });
        if (saveResponse.ok) {
          const saved = (await saveResponse.json()) as UserConfig;
          setSavedConfig(saved);
        }
      }

      if (criteriaChanged) {
        // Full-period search: re-fetch across the entire daysOld window.
        const items = await loadSearches(true, true);
        setSearches(items);
        setDraftTabs([]);
      } else if (anyChanged && searches.length > 0) {
        // Only display filters changed and results are already in memory.
        // The filteredResultsMap updates reactively — no network call needed.
        setDraftTabs([]);
      } else {
        // Incremental search: only since the last update.
        const items = await loadSearches(true, false);
        setSearches(items);
        setDraftTabs([]);
      }
    } catch (err) {
      setError(String(err));
    } finally {
      setRefreshingAll(false);
    }
  };

  // ---------------------------------------------------------------------------
  // Add Location
  // ---------------------------------------------------------------------------

  // Shows a draft tab for the new location and persists the config (including
  // current keywords and filters). Does NOT run the search — the user triggers
  // that explicitly via the Search button. Draft tabs are cleared by handleSearch
  // once real search data arrives.
  function handleAddLocation(
    locationType: LocationType,
    data: { city: string; radiusKm: number; country: string }
  ) {
    const id = `loc-${Date.now()}`;
    let label = "New Location";

    if (locationType === "hybrid" && data.city.trim()) {
      label = truncateAtFirstComma(data.city.trim()) || "New Location";
    } else if (locationType === "remote" && data.country) {
      label = data.country;
    }

    const newLocation: UserConfigLocation =
      locationType === "hybrid"
        ? { id, type: "hybrid", label, city: data.city.trim(), radiusKm: data.radiusKm, country: data.country }
        : { id, type: "remote", label, country: data.country };

    const slug = slugifyLabel(label);

    setDraftTabs((prev) => [...prev, { id: slug, title: label }]);
    setActiveTab(slug);
    setShowAddLocationDialog(false);

    // Persist the full current config (keywords, sites, filters + new location)
    // so the backend is ready when the user clicks Search.
    void (async () => {
      try {
        const currentLocations = savedConfig?.locations ?? [];
        const saveResponse = await fetch("/api/user-config", {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            ...buildCurrentConfig(),
            locations: [...currentLocations, newLocation],
          }),
        });
        if (saveResponse.ok) {
          const saved = (await saveResponse.json()) as UserConfig;
          setSavedConfig(saved);
        }
      } catch (err) {
        setError(String(err));
        setDraftTabs((prev) => prev.filter((d) => d.id !== slug));
      }
    })();
  }

  // Removes a search tab and its config location. Works for both real searches
  // and draft tabs. Switches the active tab to the next available one.
  function handleDeleteSearch(slug: string) {
    if (!savedConfig) return;

    const deletedLocation = savedConfig.locations.find(
      (loc) => slugifyLabel(loc.label) === slug
    );
    if (!deletedLocation) return;

    const updatedLocations = savedConfig.locations.filter(
      (loc) => loc.id !== deletedLocation.id
    );
    const updatedSearches = searches.filter((s) => s.slug !== slug);
    const updatedDrafts = draftTabs.filter((d) => d.id !== slug);
    setSearches(updatedSearches);
    setDraftTabs(updatedDrafts);
    setFiltersDisabledTabs((prev) => {
      const next = new Set(prev);
      next.delete(slug);
      return next;
    });

    if (updatedSearches.length > 0) {
      setActiveTab(updatedSearches[0].slug);
    } else if (updatedDrafts.length > 0) {
      setActiveTab(updatedDrafts[0].id);
    } else {
      setActiveTab("");
    }

    void (async () => {
      try {
        const res = await fetch("/api/user-config", {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ ...buildCurrentConfig(), locations: updatedLocations }),
        });
        if (res.ok) setSavedConfig((await res.json()) as UserConfig);
      } catch (err) {
        setError(String(err));
      }
    })();
  }

  // Updates the search radius for a hybrid location, persists to config, then
  // immediately re-runs only that location's search for the full daysOld window.
  function handleChangeRadius(slug: string, newRadiusKm: number) {
    if (!savedConfig) return;

    const updatedLocations = savedConfig.locations.map((loc) =>
      loc.type === "hybrid" && slugifyLabel(loc.label) === slug
        ? { ...loc, radiusKm: newRadiusKm }
        : loc
    );

    void (async () => {
      try {
        setRefreshingSlug(slug);
        setError(null);

        const res = await fetch("/api/user-config", {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ ...buildCurrentConfig(), locations: updatedLocations }),
        });
        if (res.ok) setSavedConfig((await res.json()) as UserConfig);

        const refreshRes = await fetch(`/api/searches/${slug}/refresh?fullPeriod=true`, { method: "POST" });
        const payload = (await refreshRes.json()) as { search?: SearchData; error?: string };
        if (!refreshRes.ok) throw new Error(payload.error ?? "Failed to refresh search");

        setSearches((current) =>
          current.map((s) => (s.slug === slug ? (payload.search as SearchData) : s))
        );
      } catch (err) {
        setError(String(err));
      } finally {
        setRefreshingSlug(null);
      }
    })();
  }

  const updateJobStatus = async (statusKey: string, status: JobStatus) => {
    try {
      const response = await fetch("/api/job-statuses", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ statusKey, status }),
      });

      const payload = (await response.json()) as { error?: string };
      if (!response.ok) {
        throw new Error(payload.error ?? "Failed to update job status");
      }

      setSearches((current) =>
        current.map((search) => ({
          ...search,
          results: search.results.map((row) => {
            const rowKey = String(row["status_key"] ?? "").trim().toLowerCase();
            if (rowKey !== statusKey) {
              return row;
            }

            return {
              ...row,
              job_status: status,
            };
          }),
        }))
      );
    } catch (err) {
      setError(String(err));
    }
  };

  const updateJobIndustry = async (statusKey: string, industry: string | null) => {
    try {
      const response = await fetch("/api/job-industries", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ statusKey, industry }),
      });

      const payload = (await response.json()) as { error?: string };
      if (!response.ok) {
        throw new Error(payload.error ?? "Failed to update job industry");
      }

      setSearches((current) =>
        current.map((search) => ({
          ...search,
          results: search.results.map((row) => {
            const rowKey = String(row["status_key"] ?? "").trim().toLowerCase();
            if (rowKey !== statusKey) {
              return row;
            }

            return {
              ...row,
              industry_label: industry,
            };
          }),
        }))
      );
    } catch (err) {
      setError(String(err));
    }
  };

  const updateJobSeniority = async (statusKey: string, seniority: string | null) => {
    try {
      const response = await fetch("/api/job-seniorities", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ statusKey, seniority }),
      });

      const payload = (await response.json()) as { error?: string };
      if (!response.ok) {
        throw new Error(payload.error ?? "Failed to update job seniority");
      }

      setSearches((current) =>
        current.map((search) => ({
          ...search,
          results: search.results.map((row) => {
            const rowKey = String(row["status_key"] ?? "").trim().toLowerCase();
            if (rowKey !== statusKey) {
              return row;
            }

            return {
              ...row,
              seniority_label: seniority,
            };
          }),
        }))
      );
    } catch (err) {
      setError(String(err));
    }
  };

  if (loading) {
    return <main className="p-8">Loading dashboard...</main>;
  }

  if (error && searches.length === 0) {
    return <main className="p-8 text-red-600">{error}</main>;
  }

  return (
    <main id="dashboard-root" className="flex h-screen flex-col overflow-hidden">
      <Tabs id="dashboard-tabs" value={resolvedActiveTab} onValueChange={setActiveTab} className="flex h-screen flex-col gap-0 overflow-hidden">
        <section id="dashboard-header" className="bg-primary text-primary-foreground">
          <div id="dashboard-header-inner" className="mx-auto max-w-[1280px] px-4 md:px-8 pt-8 pb-4">
            <div id="dashboard-title-row" className="mb-4 flex items-center justify-between gap-3">
              <h1 id="dashboard-title" className="font-heading text-6xl leading-none tracking-tight">jobbity.</h1>
              <button
                id="button-debug-reset"
                type="button"
                onClick={() => void handleResetDebug()}
                title="Debug: reset all search state"
                className="text-xs font-light text-white/40 hover:text-white/70 transition-opacity focus:outline-none"
              >
                reset
              </button>
            </div>

            <div id="header-input-keyword-row" className="flex w-full items-center gap-3 overflow-x-auto overflow-y-hidden whitespace-nowrap text-xl [scrollbar-width:none] [-ms-overflow-style:none] [&::-webkit-scrollbar]:hidden">
              <span id="header-find-label" className="shrink-0 text-lg leading-none">Find</span>
              <label htmlFor="input-keyword" className="sr-only">Search keyword</label>
              <input
                id="input-keyword"
                ref={keywordInputRef}
                type="text"
                defaultValue={formatListForDisplay(savedKeywords)}
                onInput={(e) => {
                  // Only update state when crossing the empty/non-empty boundary,
                  // not on every keystroke — React bails out automatically for
                  // identical boolean values so this is safe to call unconditionally.
                  setKeywordHasValue((e.target as HTMLInputElement).value.trim().length > 0);
                }}
                placeholder="Enter job keywords"
                className="h-9 w-[240px] shrink-0 rounded-full border border-black/8 bg-control-strong px-4 text-sm text-control-foreground placeholder:text-muted-foreground hover:bg-control-solid focus:bg-control-solid focus:border-black/32 focus:outline-none focus:ring-0"
              />

              {/* Settings button — only shown when tabs exist; clicking toggles the search settings tray */}
              {(searches.length > 0 || draftTabs.length > 0) && (
                <button
                  id="button-settings"
                  type="button"
                  onClick={() => setActiveTray(activeTray === "search" ? null : "search")}
                  title="Search settings"
                  className="flex h-9 shrink-0 items-center justify-center rounded-full bg-control-background px-2 text-white hover:bg-control-accent-hover transition-colors"
                >
                  <Settings2 className="h-5 w-5 shrink-0" />
                </button>
              )}

              <span id="header-jobs-in-label" className="shrink-0 text-lg leading-none">jobs in</span>

              {/* Tab bar — only rendered when searches or draft tabs exist */}
              {(searches.length > 0 || draftTabs.length > 0) && (
                <div id="dashboard-tab-bar" className="min-w-0 overflow-x-auto rounded-full overflow-y-hidden [scrollbar-width:none] [-ms-overflow-style:none] [&::-webkit-scrollbar]:hidden">
                  <TabsList id="dashboard-tab-list" className="!h-9 w-fit min-w-max items-center justify-start gap-[4px] rounded-full bg-control-strong p-[2px] shadow-[0px_1px_1.5px_rgba(0,0,0,0.1)]">
                    {searches.map((search) => {
                      const resultCount = filteredResultsMap.get(search.slug)?.length ?? search.resultCount;
                      const isRefreshing = refreshingAll || refreshingSlug === search.slug;
                      return (
                        <TabsTrigger
                          id={`tab-trigger-${search.slug}`}
                          key={search.slug}
                          value={search.slug}
                          className="tab-item-hover !flex-none h-8 overflow-hidden rounded-full pl-4 pr-1 py-1 text-sm font-light tracking-[-0.168px] text-control-foreground hover:text-control-foreground active:bg-control-strong data-active:bg-control-foreground data-active:text-accent-foreground data-active:hover:text-accent-foreground"
                        >
                          <span className="flex items-center gap-2">
                            <span>{search.title}</span>
                            {/* Result count pill — bg/text driven by .tab-item-pill CSS rules in globals.css */}
                            <span className={`tab-item-pill flex items-center justify-center overflow-hidden rounded-full py-1 ${isRefreshing ? "px-1" : "px-2"}`}>
                              {isRefreshing
                                ? <Loader2 className="h-4 w-4 animate-spin" />
                                : <span className="text-xs font-normal leading-none">{resultCount}</span>
                              }
                            </span>
                          </span>
                        </TabsTrigger>
                      );
                    })}

                    {/* Draft tabs — created by the Add Location dialog, always show 0 */}
                    {draftTabs.map((draft) => (
                      <TabsTrigger
                        id={`tab-trigger-${draft.id}`}
                        key={draft.id}
                        value={draft.id}
                        className="tab-item-hover !flex-none h-8 overflow-hidden rounded-full pl-4 pr-1 py-1 text-sm font-light tracking-[-0.168px] text-control-foreground hover:text-control-foreground active:bg-control-strong data-active:bg-control-foreground data-active:text-accent-foreground data-active:hover:text-accent-foreground"
                      >
                        <span className="flex items-center gap-2">
                          <span>{draft.title}</span>
                          <span className={`tab-item-pill flex items-center justify-center overflow-hidden rounded-full py-1 ${refreshingAll ? "px-1" : "px-2"}`}>
                            {refreshingAll
                              ? <Loader2 className="h-4 w-4 animate-spin" />
                              : <span className="text-xs font-normal leading-none">0</span>
                            }
                          </span>
                        </span>
                      </TabsTrigger>
                    ))}
                  </TabsList>
                </div>
              )}

              {/* Add Location button — shows text when no tabs exist, icon only when tabs are present */}
              <button
                id="button-add-location"
                type="button"
                onClick={() => setShowAddLocationDialog(true)}
                className={`flex h-9 shrink-0 items-center gap-2 rounded-full bg-control-background text-sm font-semibold text-white hover:bg-control-accent-hover transition-colors ${searches.length > 0 || draftTabs.length > 0 ? "px-2" : "px-3"}`}
              >
                <Plus className="h-5 w-5 shrink-0" />
                {searches.length === 0 && draftTabs.length === 0 && <span>Add Location</span>}
              </button>

              <button
                id="button-search"
                type="button"
                onClick={() => void handleSearch()}
                disabled={refreshingAll || !!refreshingSlug || !keywordHasValue || (searches.length === 0 && draftTabs.length === 0 && (savedConfig?.locations ?? []).length === 0)}
                title={
                  !keywordHasValue
                    ? "Enter a keyword to search"
                    : searches.length === 0 && draftTabs.length === 0 && (savedConfig?.locations ?? []).length === 0
                    ? "Add a location to search"
                    : refreshTooltip
                }
                className="flex h-9 shrink-0 items-center gap-2 rounded-full bg-control-background px-3 text-sm font-semibold text-white hover:bg-control-accent-hover disabled:opacity-50 transition-colors"
              >
                {refreshingAll ? <Loader2 className="h-5 w-5 shrink-0 animate-spin" /> : <Search className="h-5 w-5 shrink-0" />}
                <span>Search</span>
              </button>
            </div>
          </div>
        </section>

        {/* Settings Tray — shown below the header when the keyword input is focused */}
        {activeTray === "search" && (
          <section id="settings-tray" ref={settingsTrayRef} className="relative bg-control-surface shrink-0">
            <SettingsTrayPointer anchorId="button-settings" />
            <div id="settings-tray-inner" className="mx-auto max-w-[1280px] px-4 md:px-8 py-6">
              <SearchSettingsContent
                onClose={() => setActiveTray(null)}
                sites={traySites}
                daysLabel={trayDaysLabel}
                titleIncludes={trayTitleIncludes}
                titleExcludes={trayTitleExcludes}
                blacklist={trayBlacklist}
                onSitesChange={setTraySites}
                onDaysChange={(label) => setTrayDaysLabel(label as AgeLabel)}
                onTitleIncludesChange={setTrayTitleIncludes}
                onTitleExcludesChange={setTrayTitleExcludes}
                onBlacklistChange={setTrayBlacklist}
              />
            </div>
          </section>
        )}

        <section id="dashboard-content" className="flex min-h-0 flex-1 overflow-hidden bg-background">
          <div id="dashboard-content-inner" className="mx-auto flex min-h-0 w-full max-w-[1280px] flex-1 flex-col overflow-hidden">
            {searches.map((search) => {
              // Resolve the saved config location for this tab (used by Search Title).
              const matchedLoc = savedConfig?.locations?.find(
                (loc) => slugifyLabel(loc.label) === search.slug
              );
              const isHybridLoc = matchedLoc?.type === "hybrid";
              const filtersOff = filtersDisabledTabs.has(search.slug);
              const filteredCount = filteredResultsMap.get(search.slug)?.length ?? search.resultCount;
              const hiddenCount = search.results.length - filteredCount;
              const totalCount = search.results.length;

              // Title: "City, Country" for hybrid, "Country" for remote.
              const titleText = isHybridLoc && matchedLoc.type === "hybrid"
                ? `${matchedLoc.city}, ${matchedLoc.country}`
                : matchedLoc?.type === "remote"
                ? matchedLoc.country
                : search.title;

              // Metadata line below the title.
              const metadataText = filtersOff
                ? `${totalCount} jobs`
                : hiddenCount > 0
                ? `${filteredCount} jobs, ${hiddenCount} hidden by filters`
                : `${filteredCount} jobs`;

              // Current radius option for the dropdown trigger label.
              const currentRadiusOpt =
                matchedLoc?.type === "hybrid" ? radiusKmToOption(matchedLoc.radiusKm) : null;

              return (
              <TabsContent
                id={`search-panel-${search.slug}`}
                key={search.slug}
                value={search.slug}
                className="flex h-full min-h-0 flex-1 flex-col overflow-hidden text-card-foreground"
              >
                {/* Search Title — location name, metadata, and action controls */}
                <div id={`search-title-${search.slug}`} className="shrink-0 px-6 pt-4 flex flex-col gap-2">
                  <h2 className="text-lg font-semibold leading-none text-primary">{titleText}</h2>
                  <div className="flex items-center gap-4">
                    <div className="flex items-center gap-2">
                      {/* Radius picker — hybrid searches only */}
                      {isHybridLoc && currentRadiusOpt && (
                        <MiniButtonDropdown
                          id={`button-radius-${search.slug}`}
                          icon={Search}
                          label={radiusButtonLabel(currentRadiusOpt)}
                          options={RADIUS_OPTIONS}
                          onSelect={(opt) =>
                            handleChangeRadius(search.slug, radiusOptionToKm(opt as RadiusOption))
                          }
                        />
                      )}
                      {/* Disable / Enable Filters toggle */}
                      <MiniButton
                        id={`button-filters-${search.slug}`}
                        icon={filtersOff ? Eye : EyeOff}
                        label={filtersOff ? "Enable Filters" : "Disable Filters"}
                        onClick={() =>
                          setFiltersDisabledTabs((prev) => {
                            const next = new Set(prev);
                            filtersOff ? next.delete(search.slug) : next.add(search.slug);
                            return next;
                          })
                        }
                      />
                      {/* Delete this location */}
                      <MiniButton
                        id={`button-delete-search-${search.slug}`}
                        icon={Trash2}
                        label="Delete Location"
                        onClick={() => handleDeleteSearch(search.slug)}
                      />
                    </div>
                    <p className="text-sm font-light leading-5 tracking-[-0.168px] text-muted-foreground">
                      {metadataText}
                    </p>
                  </div>
                </div>

                {/* Desktop table view – hidden on mobile */}
                <div id={`search-results-wrap-${search.slug}`} className="hidden md:flex h-full min-h-0 flex-1 flex-col overflow-hidden px-6 pt-2">
                  <div className="min-w-0">
                    <Table id={`search-results-table-${search.slug}`} className="table-fixed">
                      <TableHeader id={`search-results-header-${search.slug}`}>
                        <TableRow id={`search-results-header-row-${search.slug}`} className="border-b border-[#17254214]">
                          {VISIBLE_COLUMNS.map((column) => (
                            <TableHead
                              key={column}
                              className={column === "title" || column === "company" ? "h-10 px-2 text-sm font-bold capitalize text-[#18727A]" : "h-10 w-[120px] max-w-[120px] px-2 text-sm font-bold capitalize text-[#18727A]"}
                              style={column === "title" ? { width: "70%" } : column === "company" ? { width: "30%" } : undefined}
                            >
                              {column === "date_posted"
                                ? "Age"
                                : column === "industry"
                                ? "Industry"
                                : column === "ai_level"
                                ? "AI Level"
                                : column === "seniority"
                                ? "Seniority"
                                : column === "status"
                                ? "Status"
                                : column.replace(/_/g, " ")}
                            </TableHead>
                          ))}
                        </TableRow>
                      </TableHeader>
                    </Table>
                  </div>

                  <ScrollArea id={`search-results-body-scroll-${search.slug}`} className="min-h-0 flex-1 w-full overflow-hidden">
                    <div className="min-w-0">
                      <Table id={`search-results-body-table-${search.slug}`} className="table-fixed">
                        <TableBody id={`search-results-body-${search.slug}`}>
                          {(() => {
                            const filteredResults = filteredResultsMap.get(search.slug) ?? search.results;
                            return filteredResults.length === 0 ? (
                            <TableRow id={`search-results-empty-row-${search.slug}`}>
                              <TableCell colSpan={VISIBLE_COLUMNS.length} className="px-2 text-sm text-card-foreground">
                                No jobs found for this search.
                              </TableCell>
                            </TableRow>
                          ) : (
                            [...filteredResults]
                              .sort((a, b) => {
                                const da = getSortTimestamp(a);
                                const db = getSortTimestamp(b);
                                return db - da;
                              })
                              .map((row, index) => (
                                <TableRow id={`search-result-row-${search.slug}-${index}`} key={`${search.slug}-${index}`} className="border-b border-[#17254214]">
                                  {VISIBLE_COLUMNS.map((column) => (
                                    <TableCell
                                      key={`${search.slug}-${index}-${column}`}
                                      className={column === "title" || column === "company" ? "h-[37px] px-2 text-sm text-card-foreground" : "h-[37px] w-[120px] max-w-[120px] px-2 text-sm text-card-foreground"}
                                      style={column === "title" ? { width: "70%" } : column === "company" ? { width: "30%" } : undefined}
                                    >
                                      {column === "title" ? (
                                        <JobTitleCell
                                          title={String(row["title"] ?? "")}
                                          onOpen={() => {
                                            const statusKey = getStatusKey(row);

                                            if (!statusKey) {
                                              setError("Unable to open details for this row.");
                                              return;
                                            }

                                            setSelectedJob({ searchSlug: search.slug, statusKey });
                                          }}
                                          showNewIndicator={String(row["job_status"] ?? "").trim().toLowerCase() === "new"}
                                        />
                                      ) : column === "date_posted" ? (
                                        formatAge(row)
                                      ) : column === "company" ? (
                                        <span className="block truncate" title={toDisplayValue(row[column])}>
                                          {toDisplayValue(row[column])}
                                        </span>
                                      ) : column === "industry" ? (
                                        <IndustryCell
                                          industry={String(row["industry_label"] ?? "")}
                                          onChange={(nextIndustry) => {
                                            const statusKey = getStatusKey(row);

                                            if (!statusKey) {
                                              setError("Unable to update industry for this row.");
                                              return;
                                            }

                                            void updateJobIndustry(statusKey, nextIndustry);
                                          }}
                                        />
                                      ) : column === "ai_level" ? (
                                        <AiLevelCell description={String(row["description"] ?? "")} />
                                      ) : column === "seniority" ? (
                                        <SeniorityCell
                                          seniority={String(row["seniority_label"] ?? "")}
                                          onChange={(nextSeniority) => {
                                            const statusKey = getStatusKey(row);

                                            if (!statusKey) {
                                              setError("Unable to update seniority for this row.");
                                              return;
                                            }

                                            void updateJobSeniority(statusKey, nextSeniority);
                                          }}
                                        />
                                      ) : column === "status" ? (
                                        <JobStatusCell
                                          status={toJobStatus(row["job_status"])}
                                          onChange={(nextStatus) => {
                                            const statusKey = getStatusKey(row);

                                            if (!statusKey) {
                                              setError("Unable to update status for this row.");
                                              return;
                                            }

                                            void updateJobStatus(statusKey, nextStatus);
                                          }}
                                        />
                                      ) : (
                                        toDisplayValue(row[column])
                                      )}
                                    </TableCell>
                                  ))}
                                </TableRow>
                              ))
                          )
                          })()}
                        </TableBody>
                      </Table>

                    </div>
                  </ScrollArea>
                </div>

                {/* Mobile card list – shown instead of the table on small screens */}
                <div id={`mobile-results-wrap-${search.slug}`} className="md:hidden h-full min-h-0 flex-1 overflow-y-auto">
                  <MobileJobList
                    search={search}
                    results={filteredResultsMap.get(search.slug) ?? search.results}
                    onOpenJob={(searchSlug, statusKey) => setSelectedJob({ searchSlug, statusKey })}
                    onStatusChange={(statusKey, nextStatus) => void updateJobStatus(statusKey, nextStatus)}
                  />
                </div>

                {error ? <p id={`search-error-${search.slug}`} className="px-4 md:px-0 mt-3 text-sm text-destructive">{error}</p> : null}
              </TabsContent>
              );
            })}

            {/* Draft tab panels — location added but search not yet run */}
            {draftTabs.map((draft) => {
              const matchedLoc = savedConfig?.locations?.find(
                (loc) => slugifyLabel(loc.label) === draft.id
              );
              const isHybridLoc = matchedLoc?.type === "hybrid";
              const currentRadiusOpt =
                matchedLoc?.type === "hybrid" ? radiusKmToOption(matchedLoc.radiusKm) : null;
              const titleText = isHybridLoc && matchedLoc.type === "hybrid"
                ? `${matchedLoc.city}, ${matchedLoc.country}`
                : matchedLoc?.type === "remote"
                ? matchedLoc.country
                : draft.title;

              return (
                <TabsContent
                  id={`search-panel-${draft.id}`}
                  key={draft.id}
                  value={draft.id}
                  className="flex h-full min-h-0 flex-1 flex-col overflow-hidden text-card-foreground"
                >
                  <div id={`search-title-${draft.id}`} className="shrink-0 px-6 pt-4 flex flex-col gap-2">
                    <h2 className="text-lg font-semibold leading-none text-primary">{titleText}</h2>
                    <div className="flex items-center gap-4">
                      <div className="flex items-center gap-2">
                        {isHybridLoc && currentRadiusOpt && (
                          <MiniButtonDropdown
                            id={`button-radius-${draft.id}`}
                            icon={Search}
                            label={radiusButtonLabel(currentRadiusOpt)}
                            options={RADIUS_OPTIONS}
                            onSelect={(opt) =>
                              handleChangeRadius(draft.id, radiusOptionToKm(opt as RadiusOption))
                            }
                          />
                        )}
                        <MiniButton
                          id={`button-filters-${draft.id}`}
                          icon={EyeOff}
                          label="Disable Filters"
                          onClick={() => {}}
                        />
                        <MiniButton
                          id={`button-delete-search-${draft.id}`}
                          icon={Trash2}
                          label="Delete Location"
                          onClick={() => handleDeleteSearch(draft.id)}
                        />
                      </div>
                      <p className="text-sm font-light leading-5 tracking-[-0.168px] text-muted-foreground">
                        No jobs to display
                      </p>
                    </div>
                  </div>
                  <EmptySearchState />
                </TabsContent>
              );
            })}

            {/* Empty state shown only when there are no tabs at all */}
            {searches.length === 0 && draftTabs.length === 0 ? <EmptySearchState /> : null}
          </div>
        </section>

        <aside
          aria-hidden={!selectedJobRow}
          className={`fixed inset-y-0 right-0 z-40 w-[480px] max-w-full transform transition-transform duration-300 ease-out ${
            selectedJobRow ? "translate-x-0" : "translate-x-full"
          }`}
        >
          <div className="flex h-full flex-col border-l border-border shadow-2xl">
            <header className="flex shrink-0 flex-col gap-4 bg-secondary p-4 text-secondary-foreground">
              <div className="flex items-start justify-between gap-4">
                <div className="min-w-0">
                  <h3 className="truncate text-xl font-sans font-regular leading-none">
                    {selectedJobRow ? toDisplayValue(selectedJobRow["company"]) : ""}
                  </h3>
                  <h2 className="text-4xl font-heading font-regular leading-[1]">
                    {selectedJobRow ? toDisplayValue(selectedJobRow["title"]) : ""}
                  </h2>
                </div>

                <button
                  type="button"
                  onClick={() => setSelectedJob(null)}
                  className="inline-flex h-8 w-8 items-center justify-center rounded-full text-secondary-foreground/90 hover:bg-white/10 hover:text-secondary-foreground"
                  aria-label="Close job details"
                >
                  <X className="h-4 w-4" />
                </button>
              </div>

              <div className="text-sm flex items-center justify-between gap-4 text-base leading-none">
                <div className="min-w-0 flex items-center gap-2 text-secondary-foreground/95">
                  {selectedJobRow && formatPostingDate(selectedJobRow["date_posted"]) ? (
                    <>
                      <span className="truncate">{formatPostingDate(selectedJobRow["date_posted"])}</span>
                      <span className="h-[2px] w-[2px] shrink-0 rounded-full bg-sidebar-foreground" aria-hidden="true" />
                    </>
                  ) : null}
                  <span className="truncate">{selectedJobRow ? deriveWorkMode(selectedJobRow) : "-"}</span>
                  <span className="h-[2px] w-[2px] shrink-0 rounded-full bg-sidebar-foreground" aria-hidden="true" />
                  <span className="truncate">
                    {selectedJobRow ? truncateAtFirstComma(toDisplayValue(selectedJobRow["location"])) : "-"}
                  </span>
                </div>

                <div className="flex shrink-0 items-center gap-4">
                  {selectedJobRow ? (
                    <JobStatusCell
                      status={toJobStatus(selectedJobRow["job_status"])}
                      forceWhite
                      onChange={(nextStatus) => {
                        if (!selectedJob) {
                          return;
                        }

                        void updateJobStatus(selectedJob.statusKey, nextStatus);
                      }}
                    />
                  ) : null}
                  <JobApplyAction links={selectedJobLinks} />
                </div>
              </div>
            </header>

            <div className="min-h-0 flex-1 overflow-y-auto bg-card p-4 text-foreground">
              {selectedJobRow ? (
                <div className="space-y-4 text-base leading-relaxed">
                  {isDescriptionLoading && displayedSelectedJobDescription.length === 0
                    ? (
                        <div id="job-description-loading-state" className="flex min-h-[280px] items-center justify-center text-muted-foreground">
                          <div className="flex items-center gap-3" role="status" aria-live="polite" aria-label="Loading job description">
                            <span className="h-4 w-4 animate-spin rounded-full border-2 border-muted-foreground/30 border-t-muted-foreground" aria-hidden="true" />
                            <span className="text-sm">Loading description...</span>
                          </div>
                        </div>
                      )
                    : displayedSelectedJobDescription.length > 0
                    ? (
                        <JobDescriptionMarkdown content={displayedSelectedJobDescription} />
                      )
                    : "No description available for this role."}
                </div>
              ) : null}
            </div>
          </div>
        </aside>

        {selectedJobRow ? (
          <button
            type="button"
            onClick={() => setSelectedJob(null)}
            className="fixed inset-0 z-30 bg-black/25"
            aria-label="Close job details panel"
          />
        ) : null}
      </Tabs>

      {/* Add Location dialog — rendered outside Tabs so it sits above everything */}
      {showAddLocationDialog && (
        <AddLocationDialog
          onAdd={handleAddLocation}
          onClose={() => setShowAddLocationDialog(false)}
        />
      )}
    </main>
  );
}
