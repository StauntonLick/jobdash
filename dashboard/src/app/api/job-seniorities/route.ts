import { saveSeniorityOverride, SENIORITY_LABELS } from "@/lib/jobspy-service";

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as { statusKey?: string; seniority?: string | null };

    const statusKey = String(body.statusKey ?? "").trim();
    const seniority = body.seniority;

    if (!statusKey) {
      return Response.json({ error: "Missing statusKey" }, { status: 400 });
    }

    if (seniority !== null && seniority !== undefined) {
      const normalized = String(seniority ?? "").trim();
      if (!SENIORITY_LABELS.includes(normalized as typeof SENIORITY_LABELS[number])) {
        return Response.json({ error: "Invalid seniority label" }, { status: 400 });
      }
    }

    await saveSeniorityOverride(statusKey, seniority === undefined ? null : seniority);

    return Response.json({ success: true }, { status: 200 });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return Response.json({ error: message }, { status: 500 });
  }
}
