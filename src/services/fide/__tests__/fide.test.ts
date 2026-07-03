import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const { mockEq, mockUpdate, mockFrom } = vi.hoisted(() => {
  const mockEq = vi.fn();
  const mockUpdate = vi.fn();
  return { mockEq, mockUpdate, mockFrom: vi.fn(() => ({ update: mockUpdate })) };
});

vi.mock("@/services/supabase/admin", () => ({
  supabaseAdmin: { from: mockFrom },
}));

import {
  fetchFidePlayer,
  matchesFideName,
  parseFideTitle,
  parseRating,
  syncFidePlayer,
} from "../fide";

// Minimal HTML mirroring the real ratings.fide.com profile markup the parser
// keys off of (verified live in 2026): player-title header, profile-info-title,
// and the three profile-*/profile-game rating blocks whose first <p> is the ELO.
const titledHtml = `
<html><head><title>Carlsen, Magnus FIDE Profile</title></head><body>
  <h1 class="player-title">Carlsen, Magnus</h1>
  <div class="profile-info-title "><p>Grandmaster</p></div>
  <div class="profile-standart profile-game "><img src="/img/logo_std.svg" alt="standart" height=25><p>2823</p><p style="font-size:8px;">STANDARD</p></div>
  <div class="profile-rapid profile-game "><img src="/img/logo_rpd.svg" alt="rapid" height=25><p>2803</p><p style="font-size:8px;">RAPID</p></div>
  <div class="profile-blitz profile-game "><img src="/img/logo_blitz.svg" alt="blitz" height=25><p>2860</p><p style="font-size:8px;">BLITZ</p></div>
</body></html>`;

const untitledUnratedHtml = `
<html><body>
  <h1 class="player-title">Novice, Jane</h1>
  <div class="profile-info-title "><p>None</p></div>
  <div class="profile-standart profile-game "><img><p>0</p><p>STANDARD</p></div>
  <div class="profile-rapid profile-game "><img><p>0</p><p>RAPID</p></div>
  <div class="profile-blitz profile-game "><img><p>1650</p><p>BLITZ</p></div>
</body></html>`;

// FIDE's not-found shell has no player-title and no rating blocks.
const notFoundHtml = `<html><body><div class="content">nothing here</div></body></html>`;

function okResponse(html: string) {
  return { status: 200, ok: true, text: async () => html };
}

describe("parseRating", () => {
  it("parses a positive integer", () => {
    expect(parseRating("2823")).toBe(2823);
    expect(parseRating(" 1 750 ")).toBe(1750);
  });
  it("maps unrated (0/blank/non-numeric/null) to null", () => {
    expect(parseRating("0")).toBeNull();
    expect(parseRating("")).toBeNull();
    expect(parseRating("Unrated")).toBeNull();
    expect(parseRating(null)).toBeNull();
    expect(parseRating(undefined)).toBeNull();
  });
});

describe("parseFideTitle", () => {
  it("maps each FIDE title string to the enum", () => {
    expect(parseFideTitle("Grandmaster")).toBe("GM");
    expect(parseFideTitle("International Master")).toBe("IM");
    expect(parseFideTitle("FIDE Master")).toBe("FM");
    expect(parseFideTitle("Candidate Master")).toBe("CM");
    expect(parseFideTitle("Woman Grandmaster")).toBe("WGM");
    expect(parseFideTitle("Woman International Master")).toBe("WIM");
    expect(parseFideTitle("Woman FIDE Master")).toBe("WFM");
    expect(parseFideTitle("Woman Candidate Master")).toBe("WCM");
  });
  it("is case/whitespace insensitive", () => {
    expect(parseFideTitle("  grandmaster ")).toBe("GM");
  });
  it("returns null for None / Arena / unknown", () => {
    expect(parseFideTitle("None")).toBeNull();
    expect(parseFideTitle("Arena Grandmaster")).toBeNull();
    expect(parseFideTitle(null)).toBeNull();
  });
});

describe("matchesFideName", () => {
  it("matches exact first/last against FIDE 'Last, First'", () => {
    expect(matchesFideName("Magnus", "Carlsen", "Carlsen, Magnus")).toBe(true);
  });
  it("is tolerant of diacritics and extra middle names", () => {
    expect(matchesFideName("Jozsef", "Palko", "Palkó, József Gábor")).toBe(true);
  });
  it("is tolerant of ordering", () => {
    expect(matchesFideName("Carlsen", "Magnus", "Carlsen, Magnus")).toBe(true);
  });
  it("rejects a genuine mismatch", () => {
    expect(matchesFideName("Alice", "Smith", "Carlsen, Magnus")).toBe(false);
  });
  it("rejects when a stored token is absent from the FIDE name", () => {
    expect(matchesFideName("Magnus", "Nakamura", "Carlsen, Magnus")).toBe(false);
  });
});

describe("fetchFidePlayer", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("parses name, ratings and title from a titled profile", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(okResponse(titledHtml)));
    const player = await fetchFidePlayer(1503014);
    expect(player).toEqual({
      name: "Carlsen, Magnus",
      standard: 2823,
      rapid: 2803,
      blitz: 2860,
      title: "GM",
    });
  });

  it("parses a real ratings.fide.com profile slice (guards against markup drift)", async () => {
    const realHtml = readFileSync(
      join(__dirname, "fixtures", "real-profile.html"),
      "utf-8",
    );
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(okResponse(realHtml)));
    const player = await fetchFidePlayer(1503014);
    expect(player).toEqual({
      name: "Carlsen, Magnus",
      standard: 2823,
      rapid: 2803,
      blitz: 2860,
      title: "GM",
    });
  });

  it("maps unrated categories to null and 'None' title to null", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(okResponse(untitledUnratedHtml)),
    );
    const player = await fetchFidePlayer(123);
    expect(player).toEqual({
      name: "Novice, Jane",
      standard: null,
      rapid: null,
      blitz: 1650,
      title: null,
    });
  });

  it("returns null for a not-found page (no player-title)", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(okResponse(notFoundHtml)));
    expect(await fetchFidePlayer(99999999)).toBeNull();
  });

  it("returns null on HTTP 404", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({ status: 404, ok: false }),
    );
    expect(await fetchFidePlayer(1)).toBeNull();
  });

  it("throws on an unexpected non-2xx response", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({ status: 503, ok: false }),
    );
    await expect(fetchFidePlayer(1503014)).rejects.toThrow(/HTTP 503/);
  });

  it("throws when the network request fails", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockRejectedValue(new Error("network down")),
    );
    await expect(fetchFidePlayer(1503014)).rejects.toThrow("network down");
  });
});

describe("syncFidePlayer", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockUpdate.mockReturnValue({ eq: mockEq });
    mockEq.mockResolvedValue({ error: null });
  });
  afterEach(() => vi.unstubAllGlobals());

  it("writes ratings, title and a positive name match", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(okResponse(titledHtml)));
    const result = await syncFidePlayer(
      "user-1",
      1503014,
      "Magnus",
      "Carlsen",
      "2026-07-02T00:00:00.000Z",
    );
    expect(result).toBe("updated");
    expect(mockFrom).toHaveBeenCalledWith("player_profiles");
    const payload = mockUpdate.mock.calls[0][0];
    expect(payload.fide_rating).toEqual({
      standard: 2823,
      rapid: 2803,
      blitz: 2860,
    });
    expect(payload.title).toBe("GM");
    expect(payload.fide_name_verified).toBe(true);
    expect(payload.fide_verified_name).toBe("Carlsen, Magnus");
    expect(payload.fide_rating_synced_at).toBe("2026-07-02T00:00:00.000Z");
    expect(mockEq).toHaveBeenCalledWith("user_id", "user-1");
  });

  it("flags a name mismatch but still stores ratings", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(okResponse(titledHtml)));
    const result = await syncFidePlayer(
      "user-2",
      1503014,
      "Someone",
      "Else",
      "2026-07-02T00:00:00.000Z",
    );
    expect(result).toBe("updated");
    expect(mockUpdate.mock.calls[0][0].fide_name_verified).toBe(false);
  });

  it("omits title when FIDE reports none", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(okResponse(untitledUnratedHtml)),
    );
    await syncFidePlayer("u", 1, "Jane", "Novice", "2026-07-02T00:00:00.000Z");
    expect("title" in mockUpdate.mock.calls[0][0]).toBe(false);
  });

  it("returns 'not_found' and writes nothing for an unknown ID", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(okResponse(notFoundHtml)));
    const result = await syncFidePlayer(
      "u",
      99999999,
      "A",
      "B",
      "2026-07-02T00:00:00.000Z",
    );
    expect(result).toBe("not_found");
    expect(mockUpdate).not.toHaveBeenCalled();
  });

  it("returns 'failed' when FIDE is unreachable", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("boom")));
    const result = await syncFidePlayer(
      "u",
      1,
      "A",
      "B",
      "2026-07-02T00:00:00.000Z",
    );
    expect(result).toBe("failed");
    expect(mockUpdate).not.toHaveBeenCalled();
  });

  it("returns 'failed' when the DB write errors", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(okResponse(titledHtml)));
    mockEq.mockResolvedValue({ error: { message: "db down" } });
    const result = await syncFidePlayer(
      "u",
      1503014,
      "Magnus",
      "Carlsen",
      "2026-07-02T00:00:00.000Z",
    );
    expect(result).toBe("failed");
  });
});
