import { beforeEach, describe, expect, it, vi } from "vitest";

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

vi.mock(
  "@/app/tournaments/[id]/_components/TournamentDetail",
  () => ({
    default: vi.fn().mockReturnValue(null),
  }),
);

vi.mock(
  "@/app/tournaments/[id]/_components/DetailSkeleton",
  () => ({
    default: vi.fn().mockReturnValue(null),
  }),
);

vi.mock("@/components/NavBar", () => ({
  default: vi.fn().mockReturnValue(null),
}));

vi.mock("@/lib/supabase/server", () => ({
  createClient: vi.fn().mockResolvedValue({
    auth: {
      getUser: vi.fn().mockResolvedValue({ data: { user: null } }),
    },
  }),
}));

// ── Helpers ───────────────────────────────────────────────────

const mockFetch = vi.fn();

function makeTournamentPayload(overrides: Record<string, unknown> = {}) {
  return {
    data: {
      id: "t1",
      name: "KL Open Rapid Championship 2026",
      description: "Annual rapid chess championship.",
      venue_name: "Dewan Bandaraya KL",
      state: "W.P. Kuala Lumpur",
      venue_address: "Jalan Raja Laut, 50350 Kuala Lumpur",
      start_date: "2026-06-01",
      end_date: "2026-06-02",
      registration_deadline: "2026-05-28T23:59:59Z",
      format: { type: "rapid", system: "swiss", rounds: 7 },
      time_control: { base_minutes: 15, increment_seconds: 10, delay_seconds: 0 },
      is_fide_rated: true,
      is_mcf_rated: false,
      entry_fees: { standard: { amount_cents: 5000 } },
      prizes: null,
      restrictions: null,
      max_participants: 120,
      current_participants: 78,
      status: "published",
      organizer: null,
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
        makeTournamentPayload({ description: "Custom tournament description." }),
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

    expect(result.openGraph?.type).toBe("article");
    expect(result.openGraph?.siteName).toBe("MY Chess Tour");
    expect(result.twitter?.card).toBe("summary");
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
