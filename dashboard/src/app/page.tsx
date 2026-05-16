"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { ChevronDown, ExternalLink, RotateCw, X } from "lucide-react";
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

function formatAge(dateValue: unknown): string {
  if (!dateValue || dateValue === "-") return "-";
  const posted = new Date(String(dateValue));
  if (Number.isNaN(posted.getTime())) return "-";

  const diffMs = Date.now() - posted.getTime();
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
        const da = a["date_posted"] ? new Date(String(a["date_posted"])).getTime() : 0;
        const db = b["date_posted"] ? new Date(String(b["date_posted"])).getTime() : 0;
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
        const age = formatAge(row["date_posted"]);
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
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [refreshingAll, setRefreshingAll] = useState(false);
  const [selectedJob, setSelectedJob] = useState<JobSelection | null>(null);
  const [selectedJobDescription, setSelectedJobDescription] = useState("");
  const [isDescriptionLoading, setIsDescriptionLoading] = useState(false);

  const loadSearches = useCallback(async (forceRefresh: boolean) => {
    const response = await fetch(`/api/searches${forceRefresh ? "?forceRefresh=true" : ""}`, {
      cache: "no-store",
    });
    const payload = (await response.json()) as {
      searches?: SearchData[];
      error?: string;
    };

    if (!response.ok) {
      throw new Error(payload.error ?? "Failed to load search data");
    }

    return payload.searches ?? [];
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
    if (searches.length === 0) {
      return "";
    }

    const hasActive = searches.some((item) => item.slug === activeTab);
    return hasActive ? activeTab : searches[0].slug;
  }, [activeTab, searches]);

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

  const refreshAll = async () => {
    try {
      setRefreshingAll(true);
      setError(null);
      const items = await loadSearches(true);
      setSearches(items);
    } catch (err) {
      setError(String(err));
    } finally {
      setRefreshingAll(false);
    }
  };

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
    <main id="dashboard-root" className="flex h-screen flex-col overflow-hidden bg-card">
      <Tabs id="dashboard-tabs" value={resolvedActiveTab} onValueChange={setActiveTab} className="flex h-screen flex-col gap-0 overflow-hidden">
        <section id="dashboard-header" className="bg-primary text-primary-foreground">
          <div id="dashboard-header-inner" className="mx-auto max-w-[1280px] px-4 md:px-8 pt-8 pb-4">
            <div id="dashboard-title-row" className="mb-4 flex items-center justify-between gap-3">
              <h1 id="dashboard-title" className="font-heading text-6xl leading-none tracking-tight">jobbity.</h1>
            </div>

            <div id="dashboard-tab-bar" className="flex w-full items-center gap-3">
              <div className="min-w-0 flex-1 overflow-x-auto overflow-y-hidden whitespace-nowrap">
                <TabsList id="dashboard-tab-list" className="h-[36px] w-fit min-w-max justify-start bg-muted p-[3px]">
                  {searches.map((search) => (
                    <TabsTrigger
                      id={`tab-trigger-${search.slug}`}
                      key={search.slug}
                      value={search.slug}
                      className="!flex-none h-[29px] rounded-full px-4 py-1 text-sm font-medium text-foreground/70 hover:bg-accent hover:text-secondary-foreground data-active:bg-background data-active:text-foreground"
                    >
                      {search.title} ({search.resultCount})
                    </TabsTrigger>
                  ))}
                </TabsList>
              </div>

              <Button
                id="refresh-all-button"
                onClick={() => void refreshAll()}
                disabled={refreshingAll}
                size="sm"
                title={refreshTooltip}
                className="h-9 shrink-0 rounded-full bg-white/20 px-4 text-sm font-semibold text-primary-foreground hover:bg-white/30"
              >
                <RotateCw className={`mr-2 h-4 w-4 ${refreshingAll ? "animate-spin" : ""}`} />
                Refresh
              </Button>
            </div>
          </div>
        </section>

        <section id="dashboard-content" className="flex min-h-0 flex-1 overflow-hidden bg-card">
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
                              className={column === "title" ? "h-10 w-[480px] max-w-[480px] bg-card px-2 text-sm font-bold capitalize text-[#18727A]" : column === "company" ? "h-10 w-[240px] max-w-[240px] bg-card px-2 text-sm font-bold capitalize text-[#18727A]" : "h-10 bg-card px-2 text-sm font-bold capitalize text-[#18727A]"}
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
                                const da = a["date_posted"]
                                  ? new Date(String(a["date_posted"])).getTime()
                                  : 0;
                                const db = b["date_posted"]
                                  ? new Date(String(b["date_posted"])).getTime()
                                  : 0;
                                return db - da;
                              })
                              .map((row, index) => (
                                <TableRow id={`search-result-row-${search.slug}-${index}`} key={`${search.slug}-${index}`} className="border-b border-[#17254214] hover:bg-card/95">
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
                                        formatAge(row[column])
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

            <div className="min-h-0 flex-1 overflow-y-auto bg-background p-4 text-foreground">
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
    </main>
  );
}
