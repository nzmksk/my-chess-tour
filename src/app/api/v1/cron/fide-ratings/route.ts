import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/services/supabase/admin";
import { syncFidePlayer } from "@/services/fide/fide";

// Session-less background job (mirrors the CHIP webhook): uses supabaseAdmin
// only and needs the Node runtime.
export const runtime = "nodejs";
// FIDE publishes its new monthly rating list on the 2nd, so this runs then.
// One outbound FIDE page fetch per player; keep the window generous.
export const maxDuration = 300;

const PAGE_SIZE = 500;
// Fetch a handful of FIDE profiles at a time, with a short pause between chunks,
// to avoid hammering ratings.fide.com.
const CONCURRENCY = 4;
const CHUNK_DELAY_MS = 500;

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

interface PlayerRow {
  user_id: string;
  fide_id: number;
  users: { first_name: string; last_name: string } | { first_name: string; last_name: string }[] | null;
}

/**
 * Refreshes FIDE ratings/title for every player with a FIDE ID. Triggered
 * monthly by a GitHub Actions schedule (see .github/workflows/fide-ratings.yml)
 * that POSTs here with the shared CRON_SECRET. Per-player failures are counted
 * and skipped, never failing the whole run.
 */
export async function POST(request: NextRequest): Promise<NextResponse> {
  const secret = process.env.CRON_SECRET;
  if (!secret) {
    return NextResponse.json(
      {
        error: {
          code: "MISCONFIGURED",
          message: "CRON_SECRET is not configured",
        },
      },
      { status: 500 },
    );
  }

  if (request.headers.get("authorization") !== `Bearer ${secret}`) {
    return NextResponse.json(
      { error: { code: "UNAUTHORIZED", message: "Invalid or missing cron secret" } },
      { status: 401 },
    );
  }

  const syncedAt = new Date().toISOString();
  const stats = { processed: 0, updated: 0, not_found: 0, failed: 0 };

  for (let from = 0; ; from += PAGE_SIZE) {
    const { data, error } = await supabaseAdmin
      .from("player_profiles")
      .select("user_id, fide_id, users!inner(first_name, last_name)")
      .not("fide_id", "is", null)
      .order("user_id", { ascending: true })
      .range(from, from + PAGE_SIZE - 1);

    if (error) {
      return NextResponse.json(
        { error: { code: "INTERNAL_ERROR", message: error.message } },
        { status: 500 },
      );
    }

    const rows = (data ?? []) as unknown as PlayerRow[];
    if (rows.length === 0) break;

    for (let i = 0; i < rows.length; i += CONCURRENCY) {
      const chunk = rows.slice(i, i + CONCURRENCY);
      const results = await Promise.all(
        chunk.map((row) => {
          const user = Array.isArray(row.users) ? row.users[0] : row.users;
          return syncFidePlayer(
            row.user_id,
            row.fide_id,
            user?.first_name ?? "",
            user?.last_name ?? "",
            syncedAt,
          );
        }),
      );
      for (const result of results) {
        stats.processed++;
        if (result === "updated") stats.updated++;
        else if (result === "not_found") stats.not_found++;
        else stats.failed++;
      }
      if (i + CONCURRENCY < rows.length) await sleep(CHUNK_DELAY_MS);
    }

    if (rows.length < PAGE_SIZE) break;
  }

  return NextResponse.json({ data: stats }, { status: 200 });
}
