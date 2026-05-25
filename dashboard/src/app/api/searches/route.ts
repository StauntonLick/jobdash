import { NextRequest, NextResponse } from "next/server";

import { loadOrRunSearch } from "@/lib/jobspy-service";
import { loadSearchConfig } from "@/lib/search-config";

export async function GET(request: NextRequest) {
  try {
    const forceRefresh = request.nextUrl.searchParams.get("forceRefresh") === "true";
    const includeDebug = request.nextUrl.searchParams.get("debug") === "true";
    // fullPeriod=true: ignore cached lastUpdated so each search covers the full
    // hours_old window. Used when the user changes search criteria.
    const fullPeriod = request.nextUrl.searchParams.get("fullPeriod") === "true";
    const { definitions, filters } = await loadSearchConfig();

    // Searches run in parallel to keep full refresh latency down.
    const searches = await Promise.all(
      definitions.map((def) => loadOrRunSearch(def, forceRefresh || fullPeriod, filters, includeDebug, fullPeriod))
    );

    return NextResponse.json({ searches });
  } catch (error) {
    return NextResponse.json(
      { error: `Failed to load searches: ${String(error)}` },
      { status: 500 }
    );
  }
}
