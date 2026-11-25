import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

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
  syncFidePlayer,
  type LichessFidePlayer,
} from "../fide";

const UNTITLED: LichessFidePlayer = {
  id: 2309114,
  name: "Magnusdottir, Veronika Steinunn",
  federation: "ISL",
  year: 1998,
  standard: 1711,
  rapid: 1708,
  blitz: 1708,
  gender: "F",
};

const TITLED: LichessFidePlayer = {
  id: 1503014,
  name: "Carlsen, Magnus",
  federation: "NOR",
  year: 1990,
  title: "GM",
  standard: 2823,
  rapid: 2801,
  blitz: 2860,
  gender: "M",
};

const BLITZ_ONLY: LichessFidePlayer = {
  id: 5702100,
  name: "Moy, Chee Ban",
  federation: "MAS",
  year: null,
  blitz: 1469,
};

function okResponse(body: unknown) {
  return { status: 200, ok: true, json: async () => body };
}

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

  it("asks the Lichess FIDE player API for the ID", async () => {
    const fetchSpy = vi.fn().mockResolvedValue(okResponse(UNTITLED));
    vi.stubGlobal("fetch", fetchSpy);
    await fetchFidePlayer(2309114);
    expect(fetchSpy).toHaveBeenCalledWith(
      "https://lichess.org/api/fide/player/2309114",
      expect.objectContaining({ cache: "no-store" }),
    );
  });

  it("maps an untitled player's name and ratings", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(okResponse(UNTITLED)));
    expect(await fetchFidePlayer(2309114)).toEqual({
      name: "Magnusdottir, Veronika Steinunn",
      standard: 1711,
      rapid: 1708,
      blitz: 1708,
      title: null,
    });
  });

  it("maps a FIDE title onto the chess_title enum", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(okResponse(TITLED)));
    expect(await fetchFidePlayer(1503014)).toEqual({
      name: "Carlsen, Magnus",
      standard: 2823,
      rapid: 2801,
      blitz: 2860,
      title: "GM",
    });
  });

  it("maps categories Lichess leaves out to null", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(okResponse(BLITZ_ONLY)));
    expect(await fetchFidePlayer(5702100)).toEqual({
      name: "Moy, Chee Ban",
      standard: null,
      rapid: null,
      blitz: 1469,
      title: null,
    });
  });

  it("ignores a title outside the chess_title enum", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(okResponse({ ...UNTITLED, title: "LM" })),
    );
    expect((await fetchFidePlayer(2309114))?.title).toBeNull();
  });

  it("returns null on HTTP 404", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({ status: 404, ok: false }),
    );
    expect(await fetchFidePlayer(1)).toBeNull();
  });

  it("returns null when the name is blank", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(okResponse({ ...UNTITLED, name: "  " })),
    );
    expect(await fetchFidePlayer(2309114)).toBeNull();
  });

  it("throws on a body that isn't a player", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(okResponse(null)));
    await expect(fetchFidePlayer(2309114)).rejects.toThrow(/unexpected body/);
  });

  it("throws on an unexpected non-2xx response", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({ status: 429, ok: false }),
    );
    await expect(fetchFidePlayer(1503014)).rejects.toThrow(/HTTP 429/);
  });

  it("throws when the network request fails", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockRejectedValue(new Error("network down")),
    );
    await expect(fetchFidePlayer(1503014)).rejects.toThrow("network down");
  });

  it("rejects an out-of-range / non-integer id without hitting the network", async () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);
    for (const bad of [0, -1, 1.5, 2147483648, NaN]) {
      await expect(fetchFidePlayer(bad)).rejects.toThrow(/Invalid FIDE ID/);
    }
    expect(fetchSpy).not.toHaveBeenCalled();
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
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(okResponse(TITLED)));
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
      rapid: 2801,
      blitz: 2860,
    });
    expect(payload.title).toBe("GM");
    expect(payload.fide_name_verified).toBe(true);
    expect(payload.fide_verified_name).toBe("Carlsen, Magnus");
    expect(payload.fide_rating_synced_at).toBe("2026-07-02T00:00:00.000Z");
    expect(mockEq).toHaveBeenCalledWith("user_id", "user-1");
  });

  it("flags a name mismatch and drops the ratings and title", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(okResponse(TITLED)));
    const result = await syncFidePlayer(
      "user-2",
      1503014,
      "Someone",
      "Else",
      "2026-07-02T00:00:00.000Z",
    );
    expect(result).toBe("updated");
    const payload = mockUpdate.mock.calls[0][0];
    expect(payload.fide_name_verified).toBe(false);
    expect(payload.fide_verified_name).toBe("Carlsen, Magnus");
    expect(payload.fide_rating).toBeNull();
    expect("title" in payload).toBe(false);
    expect(payload.fide_rating_synced_at).toBe("2026-07-02T00:00:00.000Z");
  });

  it("omits title when FIDE reports none", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(okResponse(UNTITLED)));
    await syncFidePlayer(
      "u",
      2309114,
      "Veronika Steinunn",
      "Magnusdottir",
      "2026-07-02T00:00:00.000Z",
    );
    expect("title" in mockUpdate.mock.calls[0][0]).toBe(false);
  });

  it("returns 'not_found' and writes nothing for an unknown ID", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({ status: 404, ok: false }),
    );
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
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(okResponse(TITLED)));
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
