import { supabaseAdmin } from "@/services/supabase/admin";
import type { ChessTitle, FideRating } from "@/app/profile/types";

// FIDE publishes no official API. Each player has a server-rendered profile page
// at this URL whose HTML carries the name, standard/rapid/blitz ratings and
// title. All markup coupling to FIDE lives in this one module, so a future FIDE
// redesign is a single-file fix. The official monthly ZIP list
// (https://ratings.fide.com/download/players_list.zip) is the fallback/scale
// path if per-profile scraping ever gets too heavy.
const FIDE_PROFILE_URL = "https://ratings.fide.com/profile";

// FIDE's title strings (from the profile "profile-info-title" block) mapped to
// our chess_title enum. Arena titles (AGM/ACM/…) and "None" have no enum value
// and stay unset.
const FIDE_TITLE_MAP: Record<string, ChessTitle> = {
  "grandmaster": "GM",
  "international master": "IM",
  "fide master": "FM",
  "candidate master": "CM",
  "woman grandmaster": "WGM",
  "woman international master": "WIM",
  "woman fide master": "WFM",
  "woman candidate master": "WCM",
};

export interface FidePlayer {
  // Name as FIDE reports it, i.e. "Last, First".
  name: string;
  standard: number | null;
  rapid: number | null;
  blitz: number | null;
  title: ChessTitle | null;
}

/**
 * Parses a single rating value from a FIDE profile rating block. Unrated
 * categories render as "0" (or blank/non-numeric) and become null.
 */
export function parseRating(raw: string | null | undefined): number | null {
  if (raw == null) return null;
  const n = parseInt(raw.replace(/\D/g, ""), 10);
  return Number.isFinite(n) && n > 0 ? n : null;
}

/**
 * Maps FIDE's full title text (e.g. "Grandmaster") to our chess_title enum.
 * Unknown / "None" / Arena titles return null.
 */
export function parseFideTitle(raw: string | null | undefined): ChessTitle | null {
  if (raw == null) return null;
  return FIDE_TITLE_MAP[raw.trim().toLowerCase()] ?? null;
}

// Extracts the inner text of the first <p> that follows the given profile-game
// rating block (profile-standart / profile-rapid / profile-blitz).
function extractRating(html: string, blockClass: string): number | null {
  const re = new RegExp(
    `class="${blockClass}[^"]*"[\\s\\S]*?<p>([^<]*)</p>`,
    "i",
  );
  return parseRating(html.match(re)?.[1]);
}

/**
 * Normalizes a name for comparison: strips diacritics, lowercases, and reduces
 * to alphanumeric tokens.
 */
function nameTokens(value: string): string[] {
  return value
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter(Boolean);
}

/**
 * Lenient check that the stored first/last name are both present in the FIDE
 * profile name (which is "Last, First ..."). Tolerant of ordering, extra middle
 * names and diacritics; a single stored token needs only appear in the FIDE
 * token set.
 */
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

/**
 * Fetches and parses a player's FIDE profile.
 *
 * Returns the parsed player, or `null` when the FIDE ID has no profile (the
 * page renders without the player-title/rating blocks). **Throws** on a network
 * failure or unexpected non-2xx response, so callers can distinguish a genuine
 * "not found" (a typo'd ID) from FIDE being unreachable.
 */
export async function fetchFidePlayer(
  fideId: number,
): Promise<FidePlayer | null> {
  const res = await fetch(`${FIDE_PROFILE_URL}/${fideId}`, {
    headers: {
      // FIDE serves the profile HTML to browser-like clients.
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

  // The player name lives in the profile header. Its absence is FIDE's
  // "not found" shell (no rating blocks either), so treat it as not found.
  const name = html.match(/<h1 class="player-title">([^<]*)<\/h1>/i)?.[1]?.trim();
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

/**
 * Fetches a player's FIDE profile and persists the ratings, title and
 * name-verification result onto their player_profiles row. Best-effort: logs
 * and returns "failed" if FIDE is unreachable or the write fails, so a batch run
 * can continue past a single bad player. Returns "not_found" when the FIDE ID
 * has no profile (the row is left untouched).
 *
 * Shared by the on-save PATCH route and the monthly cron job so the two paths
 * can't drift.
 */
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
    console.error(`FIDE fetch failed for user ${userId} (fide_id ${fideId}):`, error);
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

/**
 * Builds the player_profiles update from a parsed FIDE player. The title is only
 * set when FIDE reports a recognized one, so a FIDE "None" never wipes an
 * existing (e.g. admin-entered) title. Exposed for reuse by the on-save route,
 * which merges these fields into its own upsert.
 */
export function buildFideProfileUpdate(
  player: FidePlayer,
  firstName: string,
  lastName: string,
  syncedAt: string,
): {
  fide_rating: FideRating;
  fide_rating_synced_at: string;
  fide_name_verified: boolean;
  fide_verified_name: string;
  title?: ChessTitle;
} {
  const update: {
    fide_rating: FideRating;
    fide_rating_synced_at: string;
    fide_name_verified: boolean;
    fide_verified_name: string;
    title?: ChessTitle;
  } = {
    fide_rating: {
      standard: player.standard,
      rapid: player.rapid,
      blitz: player.blitz,
    },
    fide_rating_synced_at: syncedAt,
    fide_name_verified: matchesFideName(firstName, lastName, player.name),
    fide_verified_name: player.name,
  };
  if (player.title) update.title = player.title;
  return update;
}
