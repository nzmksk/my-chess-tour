import { supabaseAdmin } from "@/services/supabase/admin";
import type { ChessTitle, FideRating } from "@/app/profile/types";

const LICHESS_FIDE_PLAYER_URL = "https://lichess.org/api/fide/player";
const LOOKUP_TIMEOUT_MS = 8000;

const CHESS_TITLES: ReadonlySet<string> = new Set<ChessTitle>([
  "GM",
  "IM",
  "FM",
  "CM",
  "WGM",
  "WIM",
  "WFM",
  "WCM",
]);

export interface LichessFidePlayer {
  id: number;
  name: string;
  federation: string;
  title?: string;
  year?: number | null;
  inactive?: number;
  standard?: number;
  rapid?: number;
  blitz?: number;
  gender?: "M" | "F";
}

export interface FidePlayer {
  name: string;
  standard: number | null;
  rapid: number | null;
  blitz: number | null;
  title: ChessTitle | null;
}

function rating(value: number | undefined): number | null {
  return typeof value === "number" && Number.isInteger(value) && value > 0
    ? value
    : null;
}

function title(value: string | undefined): ChessTitle | null {
  return value !== undefined && CHESS_TITLES.has(value)
    ? (value as ChessTitle)
    : null;
}

function isLichessFidePlayer(body: unknown): body is LichessFidePlayer {
  return (
    typeof body === "object" &&
    body !== null &&
    typeof (body as { name?: unknown }).name === "string"
  );
}

function nameTokens(value: string): string[] {
  return value
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter(Boolean);
}

export function matchesFideName(
  firstName: string,
  lastName: string,
  fideName: string,
): boolean {
  const fideSet = new Set(nameTokens(fideName));
  if (fideSet.size === 0) return false;
  const stored = [...nameTokens(firstName), ...nameTokens(lastName)];
  if (stored.length === 0) return false;
  return stored.every((token) => fideSet.has(token));
}

export async function fetchFidePlayer(
  fideId: number,
): Promise<FidePlayer | null> {
  if (!Number.isInteger(fideId) || fideId <= 0 || fideId > 2147483647) {
    throw new Error(`Invalid FIDE ID: ${fideId}`);
  }
  const res = await fetch(`${LICHESS_FIDE_PLAYER_URL}/${fideId}`, {
    headers: {
      Accept: "application/json",
      "User-Agent": "MyChessTour/1.0 (+https://mychesstour.com)",
    },
    cache: "no-store",
    signal: AbortSignal.timeout(LOOKUP_TIMEOUT_MS),
  });

  if (res.status === 404) return null;
  if (!res.ok) {
    throw new Error(`FIDE player lookup failed: HTTP ${res.status}`);
  }

  const player: unknown = await res.json();
  if (!isLichessFidePlayer(player)) {
    throw new Error("FIDE player lookup returned an unexpected body");
  }
  const name = player.name.trim();
  if (!name) return null;

  return {
    name,
    standard: rating(player.standard),
    rapid: rating(player.rapid),
    blitz: rating(player.blitz),
    title: title(player.title),
  };
}

export type FideSyncResult = "updated" | "not_found" | "failed";

export async function syncFidePlayer(
  userId: string,
  fideId: number,
  firstName: string,
  lastName: string,
  syncedAt: string,
): Promise<FideSyncResult> {
  let player: FidePlayer | null;
  try {
    player = await fetchFidePlayer(fideId);
  } catch (error) {
    console.error(
      `FIDE fetch failed for user ${userId} (fide_id ${fideId}):`,
      error,
    );
    return "failed";
  }

  if (!player) return "not_found";

  const update = buildFideProfileUpdate(player, firstName, lastName, syncedAt);
  const { error } = await supabaseAdmin
    .from("player_profiles")
    .update(update)
    .eq("user_id", userId);

  if (error) {
    console.error(`FIDE sync write failed for user ${userId}:`, error.message);
    return "failed";
  }
  return "updated";
}

export function buildFideProfileUpdate(
  player: FidePlayer,
  firstName: string,
  lastName: string,
  syncedAt: string,
): {
  fide_rating: FideRating | null;
  fide_rating_synced_at: string;
  fide_name_verified: boolean;
  fide_verified_name: string;
  title?: ChessTitle;
} {
  const nameMatches = matchesFideName(firstName, lastName, player.name);
  const update: {
    fide_rating: FideRating | null;
    fide_rating_synced_at: string;
    fide_name_verified: boolean;
    fide_verified_name: string;
    title?: ChessTitle;
  } = {
    fide_rating: nameMatches
      ? {
          standard: player.standard,
          rapid: player.rapid,
          blitz: player.blitz,
        }
      : null,
    fide_rating_synced_at: syncedAt,
    fide_name_verified: nameMatches,
    fide_verified_name: player.name,
  };
  if (nameMatches && player.title) update.title = player.title;
  return update;
}
