import { saveIndustryOverride, INDUSTRY_LABELS } from "@/lib/jobspy-service";

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as { statusKey?: string; industry?: string | null };

    const statusKey = String(body.statusKey ?? "").trim();
    const industry = body.industry;

    if (!statusKey) {
      return Response.json({ error: "Missing statusKey" }, { status: 400 });
    }

    if (industry !== null && industry !== undefined) {
      const normalized = String(industry ?? "").trim();
      if (!INDUSTRY_LABELS.includes(normalized as typeof INDUSTRY_LABELS[number])) {
        return Response.json({ error: "Invalid industry label" }, { status: 400 });
      }
    }

    await saveIndustryOverride(statusKey, industry === undefined ? null : industry);

    return Response.json({ success: true }, { status: 200 });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return Response.json({ error: message }, { status: 500 });
  }
}
