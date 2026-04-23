"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { Link2, RotateCw } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
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

type SearchData = {
  slug: string;
  title: string;
  criteria: Record<string, string | number | boolean | string[]>;
  results: Array<Record<string, unknown>>;
  resultCount: number;
  lastUpdated: string;
  error?: string;
};

const VISIBLE_COLUMNS = ["title", "company", "location", "industry", "salary", "date_posted"] as const;

type JobLink = {
  site: string;
  url: string;
  location?: string;
};

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

function JobTitleCell({
  title,
  links,
}: {
  title: string;
  links: JobLink[];
}) {
  // Detect duplicate site names so we can show per-link location disambiguators
  const siteCounts = links.reduce<Record<string, number>>((acc, l) => {
    acc[l.site] = (acc[l.site] ?? 0) + 1;
    return acc;
  }, {});

  const labelledLinks = links.map((link) => {
    const label =
      siteCounts[link.site]! > 1 && link.location
        ? `${formatSiteName(link.site)} (${link.location})`
        : formatSiteName(link.site);
    return { ...link, label };
  });

  const primaryLink = labelledLinks[0];
  const extraLinks = labelledLinks.slice(1);

  return (
    <div className="flex w-full min-w-0 items-center gap-2">
      {primaryLink ? (
        <a
          href={primaryLink.url}
          target="_blank"
          rel="noopener noreferrer"
          className="truncate underline hover:opacity-80"
          title={title}
        >
          {title}
        </a>
      ) : (
        <span className="truncate" title={title}>{title}</span>
      )}

      {extraLinks.length > 0 && (
        <DropdownMenu>
          <DropdownMenuTrigger
            className="inline-flex items-center gap-1 rounded-full border px-1.5 py-0.5 text-xs font-medium text-muted-foreground hover:bg-muted"
          >
            <Link2 className="h-3 w-3" />
            {extraLinks.length + 1}
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start" className="w-max min-w-max">
            {labelledLinks.map((link) => (
              <DropdownMenuItem key={link.url}>
                <a href={link.url} target="_blank" rel="noopener noreferrer" className="w-full">
                  {link.label}
                </a>
              </DropdownMenuItem>
            ))}
          </DropdownMenuContent>
        </DropdownMenu>
      )}
    </div>
  );
}

export default function Home() {
  const [searches, setSearches] = useState<SearchData[]>([]);
  const [activeTab, setActiveTab] = useState<string>("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [refreshingAll, setRefreshingAll] = useState(false);

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

    return newest > 0 ? new Date(newest).toLocaleString() : null;
  }, [searches]);

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

  if (loading) {
    return <main className="p-8">Loading dashboard...</main>;
  }

  if (error && searches.length === 0) {
    return <main className="p-8 text-red-600">{error}</main>;
  }

  return (
    <main className="min-h-screen bg-background p-4 md:p-8">
      <div className="mx-auto max-w-7xl space-y-5">
        <section className="space-y-3 px-1">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div className="space-y-2">
              <h1 className="text-2xl font-semibold">JobSpy Dashboard</h1>
              <p className="text-sm text-muted-foreground">
                A simple wrapper for JobSpy. Set your preferences in CONFIG.MD.
              </p>
              {error ? <p className="text-sm text-red-600">{error}</p> : null}
            </div>

            <div className="flex items-center gap-3">
              <p className="text-sm text-muted-foreground">
                Last updated: {globalLastUpdated ?? "-"}
              </p>
              <Button onClick={() => void refreshAll()} disabled={refreshingAll} size="sm">
                <RotateCw className={`mr-2 h-4 w-4 ${refreshingAll ? "animate-spin" : ""}`} />
                Refresh All
              </Button>
            </div>
          </div>
        </section>

        <Card>
          <CardContent className="space-y-4">
            <Tabs value={activeTab} onValueChange={setActiveTab}>
              <ScrollArea className="w-full whitespace-nowrap">
                <TabsList className="h-auto min-w-full justify-start bg-transparent">
                  {searches.map((search) => (
                    <TabsTrigger key={search.slug} value={search.slug} className="px-3 py-2">
                      {search.title} ({search.resultCount})
                    </TabsTrigger>
                  ))}
                </TabsList>
              </ScrollArea>

              {searches.map((search) => (
                <TabsContent key={search.slug} value={search.slug} className="space-y-4 pt-4">
                  <CardHeader className="p-0">
                    <CardTitle className="text-lg">{search.title}</CardTitle>
                  </CardHeader>

                  <ScrollArea className="h-[540px] w-full rounded-md border">
                    <div className="min-w-[1100px]">
                      <Table>
                        <TableHeader>
                          <TableRow>
                            {VISIBLE_COLUMNS.map((column) => (
                              <TableHead
                                key={column}
                                className={column === "title" ? "w-[250px] max-w-[250px] capitalize" : "capitalize"}
                              >
                                {column === "date_posted"
                                  ? "Age"
                                  : column === "industry"
                                  ? "Industry"
                                  : column === "salary"
                                  ? "Salary"
                                  : column.replaceAll("_", " ")}
                              </TableHead>
                            ))}
                          </TableRow>
                        </TableHeader>
                        <TableBody>
                          {search.results.length === 0 ? (
                            <TableRow>
                              <TableCell colSpan={VISIBLE_COLUMNS.length}>
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
                                <TableRow key={`${search.slug}-${index}`}>
                                  {VISIBLE_COLUMNS.map((column) => (
                                    <TableCell
                                      key={`${search.slug}-${index}-${column}`}
                                      className={column === "title" ? "w-[250px] max-w-[250px]" : undefined}
                                    >
                                      {column === "title" ? (
                                        <JobTitleCell
                                          title={String(row["title"] ?? "")}
                                          links={
                                            isJobLinkArray(row["job_url"])
                                              ? row["job_url"]
                                              : row["job_url"]
                                              ? [{ site: "view", url: String(row["job_url"]) }]
                                              : []
                                          }
                                        />
                                      ) : column === "date_posted" ? (
                                        formatAge(row[column])
                                      ) : column === "industry" ? (
                                        toDisplayValue(row["industry_label"])
                                      ) : column === "salary" ? (
                                        formatSalary(row)
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
                    </div>
                  </ScrollArea>
                </TabsContent>
              ))}
            </Tabs>
          </CardContent>
        </Card>

        {!activeSearch ? <p className="text-sm text-slate-500">No searches available.</p> : null}
      </div>
    </main>
  );
}
