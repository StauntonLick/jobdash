"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Building2, Check, ChevronDown, ExternalLink, Globe, IdCard, MapPin, Plus, Search, X } from "lucide-react";
import ReactMarkdown, { type Components } from "react-markdown";
import remarkGfm from "remark-gfm";

import { Button } from "@/components/ui/button";
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
import { INDEED_COUNTRIES } from "@/lib/location-constants";

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
function slugifyLabel(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

const STATUS_OPTIONS = ["New", "Skipped", "Applied", "Shortlist", "Longlist"] as const;
type JobStatus = (typeof STATUS_OPTIONS)[number];

const VISIBLE_COLUMNS = ["title", "company", "industry", "salary", "date_posted", "status"] as const;

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

function formatCurrencyPrefix(currency: string): string {
  try {
    const parts = new Intl.NumberFormat("en-GB", {
      style: "currency",
      currency,
      maximumFractionDigits: 0,
    }).formatToParts(0);

    return parts.find((part) => part.type === "currency")?.value ?? `${currency} `;
  } catch {
    return `${currency} `;
  }
}

function formatThousands(amount: number): string {
  return String(Math.round(amount / 1000));
}

function hasEstimateMarker(row: Record<string, unknown>): boolean {
  const explicitFlags = [row.salary_is_estimate, row.is_salary_estimate, row.estimated_salary];
  if (explicitFlags.some((value) => value === true || String(value).toLowerCase() === "true")) {
    return true;
  }

  const source = String(row.salary_source ?? "").toLowerCase();
  return source.includes("estimate") || source.includes("estimated");
}

function formatSalary(row: Record<string, unknown>): string {
  const min = Number(row.min_amount);
  const max = Number(row.max_amount);
  const currency = String(row.currency ?? "GBP");

  if (!Number.isFinite(min) && !Number.isFinite(max)) {
    return "";
  }

  const low = Number.isFinite(min) && min > 0 ? min : max;
  const high = Number.isFinite(max) && max > 0 ? max : min;

  if (!Number.isFinite(low) || !Number.isFinite(high) || low <= 0 || high <= 0) {
    return "";
  }

  const prefix = formatCurrencyPrefix(currency);
  const lowText = formatThousands(low);
  const highText = formatThousands(high);

  const value =
    low === high ? `${prefix}${lowText}k` : `${prefix}${lowText}-${highText}k`;

  return hasEstimateMarker(row) ? `${value} (estimate)` : value;
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
  const [city, setCity] = useState("");
  const [radius, setRadius] = useState("10");
  const [country, setCountry] = useState("United Kingdom");

  function handleAdd() {
    onAdd(locationType, {
      city,
      radiusKm: Number(radius) || 10,
      country,
    });
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
            <TrayFormItem label="City or Region">
              <TrayInput
                id="dialog-city"
                placeholder={'e.g. "Berlin, Germany"'}
                value={city}
                onChange={setCity}
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
              <TrayInput
                id="dialog-radius"
                placeholder="10"
                value={radius}
                onChange={setRadius}
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
                if (selected[0]) setCountry(selected[0]);
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
            className="h-9 rounded-full bg-secondary px-4 text-sm font-light text-secondary-foreground shadow-[0px_1px_2px_0px_rgba(0,0,0,0.1)] hover:opacity-90"
          >
            Add Location
          </button>
          <button
            type="button"
            onClick={onClose}
            className="h-9 rounded-full bg-accent px-4 text-sm font-light text-accent-foreground shadow-[0px_1px_2px_0px_rgba(0,0,0,0.1)] hover:opacity-90"
          >
            Cancel
          </button>
        </div>
      </div>
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


// Mobile-only card list – shown instead of the table on small screens
function MobileJobList({
  search,
  onOpenJob,
  onStatusChange,
}: {
  search: SearchData;
  onOpenJob: (searchSlug: string, statusKey: string) => void;
  onStatusChange: (statusKey: string, status: JobStatus) => void;
}) {
  const sortedResults = useMemo(
    () =>
      [...search.results].sort((a, b) => {
        const da = getSortTimestamp(a);
        const db = getSortTimestamp(b);
        return db - da;
      }),
    [search.results]
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
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [refreshingAll, setRefreshingAll] = useState(false);
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

  // Which settings tray is currently open, or null if closed.
  //   "search" — keyword search settings (triggered by the keyword input)
  const [activeTray, setActiveTray] = useState<"search" | null>(null);

  // Refs used to detect clicks outside the tray and the keyword input.
  const settingsTrayRef = useRef<HTMLElement>(null);
  const keywordInputRef = useRef<HTMLInputElement>(null);

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
      if (outsideTray && outsideKeyword && outsideTabBar && outsideSearchButton && !showAddLocationDialog) {
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
        // Set the uncontrolled input's DOM value directly — no state update needed.
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

  const activeSearch = useMemo(
    () => searches.find((item) => item.slug === activeTab) ?? null,
    [activeTab, searches]
  );

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

  const refreshTooltip = useMemo(() => {
    const rawTotal = searches.reduce(
      (sum, search) => sum + (Number.isFinite(search.rawResultCount) ? search.rawResultCount : search.resultCount),
      0
    );
    const filteredTotal = searches.reduce((sum, search) => sum + search.resultCount, 0);
    const formattedDate = formatDateDdMmYyyyAtHhMm(globalLastUpdated);

    return `Last updated ${formattedDate}. ${rawTotal} jobs found, ${filteredTotal} after filters applied.`;
  }, [globalLastUpdated, searches]);

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

  // Returns true if any search-relevant field has changed vs. the last saved config.
  // Sorting before comparison makes order irrelevant for sites and keywords.
  // Returns true when savedConfig is null — we have no confirmed record of what the
  // backend holds, so we always save before searching to avoid stale criteria.
  function hasConfigChanged(): boolean {
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
  //   • If the user changed any setting → save the new config, then run a full-period
  //     search so the new criteria are applied across the complete daysOld window.
  //   • If nothing changed → run an incremental search that only fetches jobs posted
  //     since the last update (the backend computes this automatically from the cache).
  const handleSearch = async () => {
    try {
      setActiveTray(null);
      setRefreshingAll(true);
      setError(null);

      const changed = hasConfigChanged();

      if (changed) {
        // Save the updated config to the backend first.
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
        // Full-period search: re-fetch across the entire daysOld window.
        const items = await loadSearches(true, true);
        setSearches(items);
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

            <div id="header-input-keyword-row" className="flex w-full items-center gap-3 overflow-x-auto whitespace-nowrap text-xl">
              <span id="header-find-label" className="shrink-0 text-lg leading-none">Find</span>
              <label htmlFor="input-keyword" className="sr-only">Search keyword</label>
              <input
                id="input-keyword"
                ref={keywordInputRef}
                type="text"
                onFocus={() => setActiveTray("search")}
                onInput={(e) => {
                  // Only update state when crossing the empty/non-empty boundary,
                  // not on every keystroke — React bails out automatically for
                  // identical boolean values so this is safe to call unconditionally.
                  setKeywordHasValue((e.target as HTMLInputElement).value.trim().length > 0);
                }}
                placeholder="Enter job keywords"
                className="h-9 w-[240px] shrink-0 rounded-full border border-black/8 bg-control-strong px-4 text-sm text-control-foreground placeholder:text-muted-foreground hover:bg-control-solid focus:bg-control-solid focus:border-black/32 focus:outline-none focus:ring-0"
              />
              <span id="header-jobs-in-label" className="shrink-0 text-lg leading-none">jobs in</span>

              <div id="dashboard-tab-bar" className="min-w-0 flex-1 overflow-x-auto rounded-full overflow-y-hidden [scrollbar-width:none] [-ms-overflow-style:none] [&::-webkit-scrollbar]:hidden">
                <TabsList id="dashboard-tab-list" className="h-9 w-fit min-w-max items-center justify-start gap-[4px] rounded-full bg-control-strong p-4px shadow-[0px_1px_1.5px_rgba(0,0,0,0.1)]">
                  {searches.map((search) => (
                    <TabsTrigger
                      id={`tab-trigger-${search.slug}`}
                      key={search.slug}
                      value={search.slug}
                      className="!flex-none h-[29px] rounded-full border border-[var(--color-semantic-border)] px-4 py-1 text-sm font-light tracking-[-0.168px] text-[var(--color-semantic-control-foreground)] bg-transparent hover:bg-[var(--color-semantic-control-active)] hover:text-[var(--color-semantic-control-foreground)] data-active:bg-[var(--color-semantic-primary)] data-active:text-[var(--color-semantic-primary-foreground)] data-active:border-[var(--color-semantic-border)] data-active:shadow-[0px_1px_1.5px_rgba(0,0,0,0.1)]"
                    >
                      {search.title} ({search.resultCount})
                    </TabsTrigger>
                  ))}

                  {/* Draft tabs — created by the Add Location dialog */}
                  {draftTabs.map((draft) => (
                    <TabsTrigger
                      id={`tab-trigger-${draft.id}`}
                      key={draft.id}
                      value={draft.id}
                      className="!flex-none h-[29px] rounded-full border border-[var(--color-semantic-border)] px-4 py-1 text-sm font-light tracking-[-0.168px] text-[var(--color-semantic-control-foreground)] bg-transparent hover:bg-[var(--color-semantic-control-active)] hover:text-[var(--color-semantic-control-foreground)] data-active:bg-[var(--color-semantic-primary)] data-active:text-[var(--color-semantic-primary-foreground)] data-active:border-[var(--color-semantic-border)] data-active:shadow-[0px_1px_1.5px_rgba(0,0,0,0.1)]"
                    >
                      {draft.title}
                    </TabsTrigger>
                  ))}

                  <button
                    id="button-add-tab"
                    type="button"
                    onClick={() => setShowAddLocationDialog(true)}
                    className="inline-flex h-[29px] shrink-0 items-center justify-center gap-1 rounded-full px-4 py-0 text-xs font-normal border-none text-[var(--color-semantic-control-foreground)] bg-transparent border border-[var(--color-semantic-border)] hover:bg-[var(--color-semantic-control-active)] hover:text-[var(--color-semantic-control-foreground)]"
                  >
                    <Plus className="h-4 w-4" />
                    <span>Add Location</span>
                  </button>
                </TabsList>
              </div>

              <Button
                id="button-search"
                onClick={() => void handleSearch()}
                disabled={refreshingAll || !keywordHasValue || (searches.length === 0 && draftTabs.length === 0 && (savedConfig?.locations ?? []).length === 0)}
                size="sm"
                title={
                  !keywordHasValue
                    ? "Enter a keyword to search"
                    : searches.length === 0 && draftTabs.length === 0 && (savedConfig?.locations ?? []).length === 0
                    ? "Add a location to search"
                    : refreshTooltip
                }
                className="relative h-9 w-9 shrink-0 rounded-full bg-white p-0 text-transparent shadow-[0px_1px_2px_0px_rgba(0,0,0,0.1)] hover:bg-white/90"
              >
                <Search className="absolute left-1/2 top-1/2 h-5 w-5 -translate-x-1/2 -translate-y-1/2 text-primary" />
                <span className="sr-only">Search</span>
              </Button>
            </div>
          </div>
        </section>

        {/* Settings Tray — shown below the header when the keyword input is focused */}
        {activeTray === "search" && (
          <section id="settings-tray" ref={settingsTrayRef} className="relative bg-control-surface shrink-0">
            <SettingsTrayPointer anchorId="input-keyword" />
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
            {searches.map((search) => (
              <TabsContent
                id={`search-panel-${search.slug}`}
                key={search.slug}
                value={search.slug}
                className="flex h-full min-h-0 flex-1 flex-col overflow-hidden text-card-foreground"
              >
                {/* Desktop table view – hidden on mobile */}
                <div id={`search-results-wrap-${search.slug}`} className="hidden md:flex h-full min-h-0 flex-1 flex-col overflow-hidden px-6 pt-4">
                  <div className="min-w-[1100px]">
                    <Table id={`search-results-table-${search.slug}`} className="table-fixed">
                      <TableHeader id={`search-results-header-${search.slug}`}>
                        <TableRow id={`search-results-header-row-${search.slug}`} className="border-b border-[#17254214]">
                          {VISIBLE_COLUMNS.map((column) => (
                            <TableHead
                              key={column}
                              className={column === "title" ? "h-10 w-[480px] max-w-[480px] px-2 text-sm font-bold capitalize text-[#18727A]" : column === "company" ? "h-10 w-[240px] max-w-[240px] px-2 text-sm font-bold capitalize text-[#18727A]" : "h-10 px-2 text-sm font-bold capitalize text-[#18727A]"}
                            >
                              {column === "date_posted"
                                ? "Age"
                                : column === "industry"
                                ? "Industry"
                                : column === "salary"
                                ? "Salary"
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
                    <div className="min-w-[1100px]">
                      <Table id={`search-results-body-table-${search.slug}`} className="table-fixed">
                        <TableBody id={`search-results-body-${search.slug}`}>
                          {search.results.length === 0 ? (
                            <TableRow id={`search-results-empty-row-${search.slug}`}>
                              <TableCell colSpan={VISIBLE_COLUMNS.length} className="px-2 text-sm text-card-foreground">
                                No jobs found for this search.
                              </TableCell>
                            </TableRow>
                          ) : (
                            [...search.results]
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
                                      className={column === "title" ? "h-[37px] w-[480px] max-w-[480px] px-2 text-sm text-card-foreground" : column === "company" ? "h-[37px] w-[240px] max-w-[240px] px-2 text-sm text-card-foreground" : "h-[37px] px-2 text-sm text-card-foreground"}
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
                                      ) : column === "salary" ? (
                                        formatSalary(row)
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
                          )}
                        </TableBody>
                      </Table>

                      <p
                        id={`search-results-filter-summary-${search.slug}`}
                        className="px-2 pt-3 pb-6 text-sm font-light italic text-muted-foreground"
                      >
                        {Math.max(0, search.rawResultCount - search.resultCount)} jobs hidden by filters
                      </p>
                    </div>
                  </ScrollArea>
                </div>

                {/* Mobile card list – shown instead of the table on small screens */}
                <div id={`mobile-results-wrap-${search.slug}`} className="md:hidden h-full min-h-0 flex-1 overflow-y-auto">
                  <MobileJobList
                    search={search}
                    onOpenJob={(searchSlug, statusKey) => setSelectedJob({ searchSlug, statusKey })}
                    onStatusChange={(statusKey, nextStatus) => void updateJobStatus(statusKey, nextStatus)}
                  />
                </div>

                {error ? <p id={`search-error-${search.slug}`} className="px-4 md:px-0 mt-3 text-sm text-destructive">{error}</p> : null}
              </TabsContent>
            ))}

            {!activeSearch ? <p id="dashboard-no-searches" className="px-6 py-3 text-sm text-muted-foreground">No searches available.</p> : null}
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
