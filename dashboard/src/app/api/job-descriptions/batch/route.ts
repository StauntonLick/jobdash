import { NextRequest, NextResponse } from "next/server";

import { getCachedDescriptionsBatch } from "@/lib/jobspy-service";

export async function POST(request: NextRequest) {
  try {
    const body = (await request.json()) as { jobs?: unknown };
    const jobs = Array.isArray(body.jobs)
      ? (body.jobs as Array<{ site?: unknown; url?: unknown }>)
          .map((j) => ({
            site: String(j.site ?? "").trim(),
            url: String(j.url ?? "").trim(),
          }))
          .filter((j) => j.site && j.url)
      : [];

    const descriptions = await getCachedDescriptionsBatch(jobs);
    return NextResponse.json({ descriptions });
  } catch (error) {
    return NextResponse.json(
      { error: `Failed to read description cache: ${String(error)}` },
      { status: 500 }
    );
  }
}
