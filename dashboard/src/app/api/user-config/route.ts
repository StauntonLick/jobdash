import fs from "node:fs/promises";
import path from "node:path";

import { NextResponse } from "next/server";
import { loadUserConfig, saveUserConfig, DEFAULT_CONFIG } from "@/lib/user-config";
import type { UserConfig } from "@/lib/user-config";

const CACHE_BASE = path.resolve(
  process.cwd(),
  process.env.JOBDASH_CACHE_DIR ?? ".cache"
);
const SEARCHES_DIR = path.join(CACHE_BASE, "searches");

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

/**
 * DELETE /api/user-config — full debug reset.
 * Writes DEFAULT_CONFIG (wiping all locations and user settings) and deletes
 * every cached search-result file so old results don't resurface after re-adding
 * a location with the same slug.
 */
export async function DELETE() {
  try {
    // 1. Reset config to factory defaults.
    await saveUserConfig({ ...DEFAULT_CONFIG });

    // 2. Delete all per-location search result cache files.
    let deletedCount = 0;
    try {
      const entries = await fs.readdir(SEARCHES_DIR);
      await Promise.all(
        entries
          .filter((name) => name.endsWith(".json"))
          .map(async (name) => {
            await fs.unlink(path.join(SEARCHES_DIR, name));
            deletedCount++;
          })
      );
    } catch (err: unknown) {
      // ENOENT just means the cache directory doesn't exist yet — not an error.
      if ((err as NodeJS.ErrnoException).code !== "ENOENT") throw err;
    }

    return NextResponse.json({ ok: true, deletedCacheFiles: deletedCount });
  } catch (err) {
    console.error("[user-config] DELETE error:", err);
    return NextResponse.json({ error: "Failed to reset config" }, { status: 500 });
  }
}
