import { NextRequest, NextResponse } from "next/server";

import { getJobDescription } from "@/lib/jobspy-service";

export async function POST(request: NextRequest) {
  try {
    const body = (await request.json()) as { site?: unknown; url?: unknown };
    const site = String(body.site ?? "").trim();
    const url = String(body.url ?? "").trim();

    if (!site || !url) {
      return NextResponse.json(
        { error: "Missing required fields: site and url." },
        { status: 400 }
      );
    }

    const description = await getJobDescription(site, url);
    return NextResponse.json({ description });
  } catch (error) {
    return NextResponse.json(
      { error: `Failed to load job description: ${String(error)}` },
      { status: 500 }
    );
  }
}
