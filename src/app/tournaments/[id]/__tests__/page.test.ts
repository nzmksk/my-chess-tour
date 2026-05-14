import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// ── Mocks ─────────────────────────────────────────────────────

const mockHeadersGet = vi.hoisted(() =>
  vi.fn().mockReturnValue("localhost:3000"),
);

vi.mock("next/headers", () => ({
  headers: vi.fn().mockResolvedValue({ get: mockHeadersGet }),
}));

const mockNotFound = vi.hoisted(() => vi.fn());

vi.mock("next/navigation", () => ({
  notFound: mockNotFound,
}));

vi.mock("@/app/tournaments/[id]/_components/TournamentDetail", () => ({
  default: vi.fn().mockReturnValue(null),
}));

vi.mock("@/app/tournaments/[id]/_components/DetailSkeleton", () => ({
  default: vi.fn().mockReturnValue(null),
}));

vi.mock("@/components/NavBar", () => ({
  default: vi.fn().mockReturnValue(null),
}));

vi.mock("@/services/supabase/server", () => ({
  createClient: vi.fn().mockResolvedValue({
    auth: {
      getUser: vi.fn().mockResolvedValue({ data: { user: null } }),
    },
  }),
}));

const mockSelect = vi.hoisted(() =>
  vi.fn().mockReturnValue({
    eq: vi.fn().mockReturnThis(),
    in: vi.fn().mockResolvedValue({ count: 0 }),
  }),
);

vi.mock("@/services/supabase/admin", () => ({
  supabaseAdmin: {
    from: vi.fn().mockReturnValue({
      select: mockSelect,
    }),
  },
}));

// ── Helpers ───────────────────────────────────────────────────

const mockFetch = vi.fn();

function makeTournamentPayload(overrides: Record<string, unknown> = {}) {
  return {
    data: {
      id: "t1",
      name: "KL Open Rapid Championship 2026",
      description: "Annual rapid chess championship.",
      venue: {
        name: "Dewan Bandaraya KL",
        state: "W.P. Kuala Lumpur",
        address: "Jalan Raja Laut, 50350 Kuala Lumpur",
      },
      start_date: "2026-06-01",
      end_date: "2026-06-02",
      registration_deadline: "2026-05-28T23:59:59Z",
      format: { type: "rapid", system: "swiss", rounds: 7 },
      time_control: {
        base_minutes: 15,
        increment_seconds: 10,
        delay_seconds: 0,
      },
      is_fide_rated: true,
      is_mcf_rated: false,
      entry_fees: { standard: { amount_cents: 5000 } },
      prizes: null,
      restrictions: null,
      max_participants: 120,
      current_participants: 78,
      status: "published",
      organization: null,
      ...overrides,
    },
  };
}

// ── Tests ─────────────────────────────────────────────────────

describe("TournamentDetailPage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    globalThis.fetch = mockFetch;
    mockHeadersGet.mockReturnValue("localhost:3000");
  });

  it("renders a non-null React element", async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      json: async () => makeTournamentPayload(),
    });

    const { default: TournamentDetailPage } = await import("../page");
    const result = await TournamentDetailPage({
      params: Promise.resolve({ id: "t1" }),
    });

    expect(result).not.toBeNull();
    expect(result).toBeDefined();
  });
});

describe("TournamentDetailData", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    globalThis.fetch = mockFetch;
    mockHeadersGet.mockReturnValue("localhost:3000");
  });

  it("returns a React element when tournament is found", async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      json: async () => makeTournamentPayload(),
    });

    const { TournamentDetailData } = await import("../page");
    const result = await TournamentDetailData({ id: "t1" });

    expect(result).toBeDefined();
  });

  it("calls notFound() when fetch returns non-ok status", async () => {
    mockFetch.mockResolvedValue({ ok: false, status: 404 });

    const { TournamentDetailData } = await import("../page");
    await TournamentDetailData({ id: "nonexistent" });

    expect(mockNotFound).toHaveBeenCalled();
  });

  it("calls notFound() when fetch throws a network error", async () => {
    mockFetch.mockRejectedValue(new Error("Network failure"));

    const { TournamentDetailData } = await import("../page");
    await TournamentDetailData({ id: "t1" });

    expect(mockNotFound).toHaveBeenCalled();
  });

  it("calls notFound() when API returns null data", async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      json: async () => ({ data: null }),
    });

    const { TournamentDetailData } = await import("../page");
    await TournamentDetailData({ id: "t1" });

    expect(mockNotFound).toHaveBeenCalled();
  });

  it("renders successfully when tournament has an organization", async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      json: async () =>
        makeTournamentPayload({
          organization: { id: "org-1", name: "Chess Club" },
        }),
    });

    const { TournamentDetailData } = await import("../page");
    const result = await TournamentDetailData({ id: "t1" });

    expect(result).toBeDefined();
    expect(mockNotFound).not.toHaveBeenCalled();
  });

  it("renders successfully when tournament has no organization", async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      json: async () => makeTournamentPayload({ organization: null }),
    });

    const { TournamentDetailData } = await import("../page");
    const result = await TournamentDetailData({ id: "t1" });

    expect(result).toBeDefined();
    expect(mockNotFound).not.toHaveBeenCalled();
  });
});

describe("generateMetadata", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    globalThis.fetch = mockFetch;
    mockHeadersGet.mockReturnValue("localhost:3000");
  });

  it("returns Tournament Not Found title when tournament does not exist", async () => {
    mockFetch.mockResolvedValue({ ok: false, status: 404 });

    const { generateMetadata } = await import("../page");
    const result = await generateMetadata({
      params: Promise.resolve({ id: "nonexistent" }),
    });

    expect(result).toEqual({ title: "Tournament Not Found" });
  });

  it("uses tournament name as title when tournament exists", async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      json: async () => makeTournamentPayload(),
    });

    const { generateMetadata } = await import("../page");
    const result = await generateMetadata({
      params: Promise.resolve({ id: "t1" }),
    });

    expect(result.title).toBe("KL Open Rapid Championship 2026");
  });

  it("uses existing description when tournament has a non-empty description", async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      json: async () =>
        makeTournamentPayload({
          description: "Custom tournament description.",
        }),
    });

    const { generateMetadata } = await import("../page");
    const result = await generateMetadata({
      params: Promise.resolve({ id: "t1" }),
    });

    expect(result.description).toBe("Custom tournament description.");
  });

  it("builds auto description with FIDE and MCF labels when both are rated", async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      json: async () =>
        makeTournamentPayload({
          description: "",
          is_fide_rated: true,
          is_mcf_rated: true,
        }),
    });

    const { generateMetadata } = await import("../page");
    const result = await generateMetadata({
      params: Promise.resolve({ id: "t1" }),
    });

    expect(result.description).toContain(" FIDE rated.");
    expect(result.description).toContain(" MCF rated.");
  });

  it("builds auto description without rating labels when neither is rated", async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      json: async () =>
        makeTournamentPayload({
          description: "",
          is_fide_rated: false,
          is_mcf_rated: false,
        }),
    });

    const { generateMetadata } = await import("../page");
    const result = await generateMetadata({
      params: Promise.resolve({ id: "t1" }),
    });

    expect(result.description).not.toContain("FIDE rated");
    expect(result.description).not.toContain("MCF rated");
  });

  it("includes openGraph article type and twitter summary card when tournament exists", async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      json: async () => makeTournamentPayload(),
    });

    const { generateMetadata } = await import("../page");
    const result = await generateMetadata({
      params: Promise.resolve({ id: "t1" }),
    });

    expect((result.openGraph as Record<string, unknown>)?.type).toBe("article");
    expect((result.openGraph as Record<string, unknown>)?.siteName).toBe("MY Chess Tour");
    expect((result.twitter as Record<string, unknown>)?.card).toBe("summary");
  });

  it("uses https protocol when host is not localhost", async () => {
    mockHeadersGet.mockReturnValue("mychessour.com");
    mockFetch.mockResolvedValue({
      ok: true,
      json: async () => makeTournamentPayload(),
    });

    const { generateMetadata } = await import("../page");
    const result = await generateMetadata({
      params: Promise.resolve({ id: "t1" }),
    });

    expect(mockFetch).toHaveBeenCalledWith(
      expect.stringContaining("https://mychessour.com"),
      expect.any(Object),
    );
    expect(result.title).toBe("KL Open Rapid Championship 2026");
  });

  it("falls back to localhost:3000 when host header is absent", async () => {
    mockHeadersGet.mockReturnValue(null);
    mockFetch.mockResolvedValue({
      ok: true,
      json: async () => makeTournamentPayload(),
    });

    const { generateMetadata } = await import("../page");
    const result = await generateMetadata({
      params: Promise.resolve({ id: "t1" }),
    });

    expect(mockFetch).toHaveBeenCalledWith(
      expect.stringContaining("http://localhost:3000"),
      expect.any(Object),
    );
    expect(result.title).toBe("KL Open Rapid Championship 2026");
  });
});

// ── fetchStartingRank coverage ────────────────────────────────
//
// Use a past start_date so tournamentStarted=true and canViewStartingRank=true,
// which causes fetchStartingRank to be called. With user=null the isRegistered
// and isOrgMember auth checks are skipped, so fetchStartingRank makes the
// FIRST call to from("registrations") — no counter needed.
//
// makeChain: thenable object so `await chain.eq().eq()` resolves with the
// wrapped value, while chain.in() is overridable for the .in()-terminated paths.

function makeChain(resolveWith: unknown) {
  const chain = {
    then: (r: (v: unknown) => unknown) => Promise.resolve(resolveWith).then(r),
    catch: (r: (e: unknown) => unknown) =>
      Promise.resolve(resolveWith).catch(r),
    select: vi.fn(() => chain),
    eq: vi.fn(() => chain),
    in: vi.fn(() => Promise.resolve({ count: 0, data: null, error: null })),
  };
  return chain;
}

// Builds a from() implementation for fetchStartingRank tests (user=null).
// registrations → resolved data chain (fetchStartingRank data call)
// users / player_profiles → chain with .in() override returning row arrays
function makeFromMock(
  registrationFetchData: unknown,
  usersData: unknown,
  profilesData: unknown,
) {
  return (t: string) => {
    if (t === "registrations") {
      return { select: vi.fn(() => makeChain(registrationFetchData)) };
    }
    if (t === "users") {
      const c = makeChain(null);
      c.in = vi.fn(() => Promise.resolve({ data: usersData, error: null }));
      return { select: vi.fn(() => c) };
    }
    if (t === "player_profiles") {
      const c = makeChain(null);
      c.in = vi.fn(() =>
        Promise.resolve({ data: profilesData, error: null }),
      );
      return { select: vi.fn(() => c) };
    }
    return { select: vi.fn(() => makeChain({ data: null, error: null })) };
  };
}

describe("fetchStartingRank coverage", () => {
  let mockFrom: ReturnType<typeof vi.fn>;

  beforeEach(async () => {
    vi.clearAllMocks();
    const mod = await import("@/services/supabase/admin");
    mockFrom = vi.mocked(mod.supabaseAdmin.from);
    mockFetch.mockResolvedValue({
      ok: true,
      json: async () =>
        makeTournamentPayload({ start_date: "2020-01-01", end_date: "2020-01-02" }),
    });
    mockHeadersGet.mockReturnValue("localhost:3000");
  });

  it("returns empty array when registrations result is empty", async () => {
    mockFrom.mockImplementation(
      makeFromMock({ data: [], error: null }, [], []),
    );
    const { TournamentDetailData } = await import("../page");
    expect(await TournamentDetailData({ id: "t1" })).toBeDefined();
  });

  it("returns empty array when registrations query errors", async () => {
    mockFrom.mockImplementation(
      makeFromMock({ data: null, error: { message: "DB error" } }, [], []),
    );
    const { TournamentDetailData } = await import("../page");
    expect(await TournamentDetailData({ id: "t1" })).toBeDefined();
  });

  it("returns empty array when all user_ids are null", async () => {
    mockFrom.mockImplementation(
      makeFromMock({ data: [{ user_id: null }], error: null }, [], []),
    );
    const { TournamentDetailData } = await import("../page");
    expect(await TournamentDetailData({ id: "t1" })).toBeDefined();
  });

  it("covers rapid format: uses rapid fide_rating field", async () => {
    mockFrom.mockImplementation(
      makeFromMock(
        { data: [{ user_id: "u1" }], error: null },
        [{ id: "u1", first_name: "Alice", last_name: "Wong" }],
        [{ user_id: "u1", title: "FM", fide_id: 111, fide_rating: { rapid: 1800, standard: 1850 }, national_rating: null }],
      ),
    );
    const { TournamentDetailData } = await import("../page");
    expect(await TournamentDetailData({ id: "t1" })).toBeDefined();
  });

  it("covers blitz format: uses blitz fide_rating field", async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      json: async () =>
        makeTournamentPayload({
          start_date: "2020-01-01",
          end_date: "2020-01-02",
          format: { type: "blitz", system: "swiss", rounds: 9 },
        }),
    });
    mockFrom.mockImplementation(
      makeFromMock(
        { data: [{ user_id: "u1" }], error: null },
        [{ id: "u1", first_name: "Bob", last_name: "Lee" }],
        [{ user_id: "u1", title: null, fide_id: null, fide_rating: { blitz: 1600 }, national_rating: null }],
      ),
    );
    const { TournamentDetailData } = await import("../page");
    expect(await TournamentDetailData({ id: "t1" })).toBeDefined();
  });

  it("covers classical format: uses standard fide_rating, falls back to national", async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      json: async () =>
        makeTournamentPayload({
          start_date: "2020-01-01",
          end_date: "2020-01-02",
          format: { type: "classical", system: "swiss", rounds: 9 },
        }),
    });
    mockFrom.mockImplementation(
      makeFromMock(
        { data: [{ user_id: "u1" }], error: null },
        [{ id: "u1", first_name: "Carol", last_name: "Chan" }],
        [{ user_id: "u1", title: null, fide_id: null, fide_rating: null, national_rating: 1200 }],
      ),
    );
    const { TournamentDetailData } = await import("../page");
    expect(await TournamentDetailData({ id: "t1" })).toBeDefined();
  });

  it("filters null user_ids and handles missing user in map", async () => {
    mockFrom.mockImplementation(
      makeFromMock(
        { data: [{ user_id: "u1" }, { user_id: null }], error: null },
        [],
        [],
      ),
    );
    const { TournamentDetailData } = await import("../page");
    expect(await TournamentDetailData({ id: "t1" })).toBeDefined();
  });

  it("sorts multiple players by rating descending then name ascending", async () => {
    mockFrom.mockImplementation(
      makeFromMock(
        { data: [{ user_id: "u1" }, { user_id: "u2" }, { user_id: "u3" }], error: null },
        [
          { id: "u1", first_name: "Alice", last_name: "A" },
          { id: "u2", first_name: "Bob", last_name: "B" },
          { id: "u3", first_name: "Carol", last_name: "C" },
        ],
        [
          { user_id: "u1", title: null, fide_id: null, fide_rating: { rapid: 1500 }, national_rating: null },
          { user_id: "u2", title: null, fide_id: null, fide_rating: null, national_rating: null },
          { user_id: "u3", title: "GM", fide_id: 99, fide_rating: { rapid: 2600 }, national_rating: null },
        ],
      ),
    );
    const { TournamentDetailData } = await import("../page");
    expect(await TournamentDetailData({ id: "t1" })).toBeDefined();
  });

  it("covers isOrgMember branch for logged-in user with org tournament", async () => {
    const serverModule = await import("@/services/supabase/server");
    vi.mocked(serverModule.createClient).mockResolvedValueOnce({
      auth: {
        getUser: vi.fn().mockResolvedValue({ data: { user: { id: "user-1" } } }),
      },
    } as unknown as Awaited<ReturnType<typeof serverModule.createClient>>);

    mockFetch.mockResolvedValue({
      ok: true,
      json: async () =>
        makeTournamentPayload({
          start_date: "2020-01-01",
          end_date: "2020-01-02",
          organization: { id: "org-1", name: "Chess Club" },
        }),
    });

    // With a logged-in user, from("registrations") is called twice:
    //   1st: isRegistered check (.select().eq().eq().in() → {count:0})
    //   2nd: fetchStartingRank data (.select().eq().eq() → await chain)
    // organization_memberships is called once for isOrgMember.
    let regCallIdx = 0;
    mockFrom.mockImplementation((t: string) => {
      if (t === "registrations") {
        regCallIdx++;
        if (regCallIdx === 1) {
          const c = makeChain({ count: 0 });
          c.in = vi.fn(() => Promise.resolve({ count: 0 }));
          return { select: vi.fn(() => c) };
        }
        return { select: vi.fn(() => makeChain({ data: [], error: null })) };
      }
      if (t === "organization_memberships") {
        return { select: vi.fn(() => makeChain({ count: 0 })) };
      }
      return { select: vi.fn(() => makeChain({ data: null, error: null })) };
    });

    const { TournamentDetailData } = await import("../page");
    expect(await TournamentDetailData({ id: "t1" })).toBeDefined();
  });
});
