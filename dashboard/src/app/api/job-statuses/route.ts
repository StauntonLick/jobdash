import { NextRequest, NextResponse } from "next/server";

import { JOB_STATUS_VALUES, saveJobStatus } from "@/lib/jobspy-service";

type UpdateStatusPayload = {
  statusKey?: string;
  status?: string;
};

export async function POST(request: NextRequest) {
  try {
    const body = (await request.json()) as UpdateStatusPayload;
    const statusKey = String(body.statusKey ?? "").trim().toLowerCase();
    const status = String(body.status ?? "").trim();

    if (!statusKey || !JOB_STATUS_VALUES.includes(status as (typeof JOB_STATUS_VALUES)[number])) {
      return NextResponse.json({ error: "Invalid status update payload." }, { status: 400 });
    }

    await saveJobStatus(statusKey, status as (typeof JOB_STATUS_VALUES)[number]);
    return NextResponse.json({ ok: true });
  } catch (error) {
    return NextResponse.json(
      { error: `Failed to save job status: ${String(error)}` },
      { status: 500 }
    );
  }
}
