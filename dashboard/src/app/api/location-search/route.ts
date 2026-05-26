import { NextRequest, NextResponse } from "next/server";

import { ISO_TO_INDEED_COUNTRY, toCountryDisplay } from "@/lib/location-constants";
import type { LocationSuggestion } from "@/lib/location-constants";

type PhotonProperties = {
  name?: string;
  countrycode?: string;
  type?: string;
};

type PhotonFeature = {
  properties: PhotonProperties;
};

type PhotonResponse = {
  features?: PhotonFeature[];
};

// OSM place types we treat as cities for job-searching purposes.
// "city" and "town" cover virtually all employment hubs.
const CITY_TYPES = new Set(["city", "town"]);

export async function GET(request: NextRequest) {
  const q = request.nextUrl.searchParams.get("q")?.trim() ?? "";

  if (q.length < 2) {
    return NextResponse.json({ results: [] });
  }

  try {
    const url = `https://photon.komoot.io/api/?q=${encodeURIComponent(q)}&limit=8&lang=en`;
    const res = await fetch(url, {
      headers: {
        // Photon's ToS asks for a descriptive User-Agent.
        "User-Agent": "JobDash/1.0 (personal-job-search-dashboard)",
      },
      // Cache Photon results for 1 hour — location data rarely changes and
      // this keeps us well within Photon's rate-limit expectations.
      next: { revalidate: 3600 },
    });

    if (!res.ok) {
      return NextResponse.json({ results: [] });
    }

    const data = (await res.json()) as PhotonResponse;
    const seen = new Set<string>();
    const results: LocationSuggestion[] = [];

    for (const feature of data.features ?? []) {
      const { name, countrycode, type } = feature.properties;

      if (!name || !countrycode || !type) continue;
      if (!CITY_TYPES.has(type)) continue;

      const code = countrycode.toUpperCase();
      const countryIndeed = ISO_TO_INDEED_COUNTRY[code];

      // Skip countries JobSpy doesn't support.
      if (!countryIndeed) continue;

      const display = `${name}, ${toCountryDisplay(countryIndeed)}`;

      // Deduplicate — Photon can return multiple OSM entries for the same city.
      if (seen.has(display)) continue;
      seen.add(display);

      results.push({ display, city: name, countryIndeed });

      if (results.length >= 6) break;
    }

    return NextResponse.json({ results });
  } catch {
    // Any network or parse error → return empty so the static list still works.
    return NextResponse.json({ results: [] });
  }
}
