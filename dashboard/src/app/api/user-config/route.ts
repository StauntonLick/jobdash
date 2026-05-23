import { NextResponse } from "next/server";
import { loadUserConfig, saveUserConfig } from "@/lib/user-config";
import type { UserConfig } from "@/lib/user-config";

/** GET /api/user-config — return the full current config. */
export async function GET() {
  try {
    const config = await loadUserConfig();
    return NextResponse.json(config);
  } catch (err) {
    console.error("[user-config] GET error:", err);
    return NextResponse.json({ error: "Failed to load config" }, { status: 500 });
  }
}

/** PUT /api/user-config — replace the full config. */
export async function PUT(request: Request) {
  try {
    const body = (await request.json()) as Partial<UserConfig>;
    const current = await loadUserConfig();
    const next: UserConfig = { ...current, ...body };
    await saveUserConfig(next);
    return NextResponse.json(next);
  } catch (err) {
    console.error("[user-config] PUT error:", err);
    return NextResponse.json({ error: "Failed to save config" }, { status: 500 });
  }
}

/** PATCH /api/user-config — merge a partial update into the current config. */
export async function PATCH(request: Request) {
  try {
    const body = (await request.json()) as Partial<UserConfig>;
    const current = await loadUserConfig();
    const next: UserConfig = { ...current, ...body };
    await saveUserConfig(next);
    return NextResponse.json(next);
  } catch (err) {
    console.error("[user-config] PATCH error:", err);
    return NextResponse.json({ error: "Failed to update config" }, { status: 500 });
  }
}
