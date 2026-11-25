import { supabaseAdmin } from "@/services/supabase/admin";
import type { ChessTitle, FideRating } from "@/app/profile/types";

const FIDE_PROFILE_URL = "https://ratings.fide.com/profile";

const FIDE_TITLE_MAP: Record<string, ChessTitle> = {
  grandmaster: "GM",
  "international master": "IM",
  "fide master": "FM",
  "candidate master": "CM",
  "woman grandmaster": "WGM",
  "woman international master": "WIM",
  "woman fide master": "WFM",
  "woman candidate master": "WCM",
};

export interface FidePlayer {
  name: string;
  standard: number | null;
  rapid: number | null;
  blitz: number | null;
  title: ChessTitle | null;
}

export function parseRating(raw: string | null | undefined): number | null {
  if (raw == null) return null;
  const n = parseInt(raw.replace(/\D/g, ""), 10);
  return Number.isFinite(n) && n > 0 ? n : null;
}

export function parseFideTitle(
  raw: string | null | undefined,
): ChessTitle | null {
  if (raw == null) return null;
  return FIDE_TITLE_MAP[raw.trim().toLowerCase()] ?? null;
}

function extractRating(html: string, blockClass: string): number | null {
  const re = new RegExp(
    `class="${blockClass}[^"]*"[\\s\\S]*?<p>([^<]*)</p>`,
    "i",
  );
  return parseRating(html.match(re)?.[1]);
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
  const res = await fetch(`${FIDE_PROFILE_URL}/${encodeURIComponent(fideId)}`, {
    headers: {
      "User-Agent":
        "Mozilla/5.0 (compatible; MyChessTour/1.0; +https://mychesstour.com)",
    },
    cache: "no-store",
  });

  if (res.status === 404) return null;
  if (!res.ok) {
    throw new Error(`FIDE profile fetch failed: HTTP ${res.status}`);
  }

  const html = await res.text();

  const name = html
    .match(/<h1 class="player-title">([^<]*)<\/h1>/i)?.[1]
    ?.trim();
  if (!name) return null;

  return {
    name,
    standard: extractRating(html, "profile-standart"),
    rapid: extractRating(html, "profile-rapid"),
    blitz: extractRating(html, "profile-blitz"),
    title: parseFideTitle(
      html.match(/class="profile-info-title[^"]*">\s*<p>([^<]*)<\/p>/i)?.[1],
    ),
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
