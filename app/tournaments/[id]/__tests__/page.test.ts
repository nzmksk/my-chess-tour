import { beforeEach, describe, expect, it, vi } from "vitest";

// ── Mocks ─────────────────────────────────────────────────────

vi.mock("next/headers", () => ({
  headers: vi.fn().mockResolvedValue(new Map([["host", "localhost:3000"]])),
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

vi.mock("@/app/_components/NavBar", () => ({
  default: vi.fn().mockReturnValue(null),
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
