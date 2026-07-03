import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import type { FidePlayer } from "@/services/fide/fide";

const {
  mockUpsert,
  mockMaybeSingle,
  mockSingle,
  mockFrom,
  mockGetClaims,
  mockFetchFidePlayer,
} = vi.hoisted(() => {
  const mockUpsert = vi.fn();
  const mockMaybeSingle = vi.fn();
  const mockSingle = vi.fn();
  const eq = vi.fn(() => ({
    maybeSingle: mockMaybeSingle,
    single: mockSingle,
  }));
  const select = vi.fn(() => ({ eq }));
  const mockFrom = vi.fn(() => ({ select, upsert: mockUpsert }));
  return {
    mockUpsert,
    mockMaybeSingle,
    mockSingle,
    mockFrom,
    mockGetClaims: vi.fn(),
    mockFetchFidePlayer: vi.fn(),
  };
});

vi.mock("@/services/supabase/admin", () => ({
  supabaseAdmin: { from: mockFrom },
}));
vi.mock("@/services/supabase/server", () => ({
  createClient: vi.fn().mockResolvedValue({
    auth: { getClaims: mockGetClaims },
  }),
}));
vi.mock("next/headers", () => ({
  cookies: vi.fn().mockResolvedValue({ getAll: () => [], set: vi.fn() }),
}));
// Keep the real buildFideProfileUpdate/matchesFideName; only stub the network fetch.
vi.mock("@/services/fide/fide", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/services/fide/fide")>();
  return { ...actual, fetchFidePlayer: mockFetchFidePlayer };
});

import { PATCH } from "../route";

const USER = "bbbbbbbb-0000-0000-0000-000000000001";

const CARLSEN: FidePlayer = {
  name: "Carlsen, Magnus",
  standard: 2823,
  rapid: 2803,
  blitz: 2860,
  title: "GM",
};

function makeReq(body: object) {
  return new NextRequest("http://localhost/api/v1/profile", {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

describe("PATCH /api/v1/profile — FIDE sync", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetClaims.mockResolvedValue({
      data: { claims: { sub: USER } },
      error: null,
    });
    // No existing profile row by default (all fields null).
    mockMaybeSingle.mockResolvedValue({ data: null, error: null });
    // users name lookup for name validation.
    mockSingle.mockResolvedValue({
      data: { first_name: "Magnus", last_name: "Carlsen" },
      error: null,
    });
    mockUpsert.mockResolvedValue({ error: null });
  });
  afterEach(() => vi.restoreAllMocks());

  it("fetches and stores ratings/title/flags when a new FIDE ID resolves", async () => {
    mockFetchFidePlayer.mockResolvedValue(CARLSEN);
    const res = await PATCH(makeReq({ fide_id: 1503014 }));
    expect(res.status).toBe(200);
    expect(mockFetchFidePlayer).toHaveBeenCalledWith(1503014);
    const payload = mockUpsert.mock.calls[0][0];
    expect(payload.fide_id).toBe(1503014);
    expect(payload.fide_rating).toEqual({
      standard: 2823,
      rapid: 2803,
      blitz: 2860,
    });
    expect(payload.title).toBe("GM");
    expect(payload.fide_name_verified).toBe(true);
    expect(payload.fide_verified_name).toBe("Carlsen, Magnus");
    expect(typeof payload.fide_rating_synced_at).toBe("string");
  });

  it("flags a mismatch when the stored name differs", async () => {
    mockSingle.mockResolvedValue({
      data: { first_name: "Someone", last_name: "Else" },
      error: null,
    });
    mockFetchFidePlayer.mockResolvedValue(CARLSEN);
    const res = await PATCH(makeReq({ fide_id: 1503014 }));
    expect(res.status).toBe(200);
    expect(mockUpsert.mock.calls[0][0].fide_name_verified).toBe(false);
  });

  it("rejects a FIDE ID that does not exist on FIDE (404/not found)", async () => {
    mockFetchFidePlayer.mockResolvedValue(null);
    const res = await PATCH(makeReq({ fide_id: 999999999 }));
    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({
      error: { code: "VALIDATION_ERROR" },
    });
    expect(mockUpsert).not.toHaveBeenCalled();
  });

  it("still saves the FIDE ID (without ratings) when FIDE is unreachable", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    mockFetchFidePlayer.mockRejectedValue(new Error("network down"));
    const res = await PATCH(makeReq({ fide_id: 1503014 }));
    expect(res.status).toBe(200);
    const payload = mockUpsert.mock.calls[0][0];
    expect(payload.fide_id).toBe(1503014);
    expect(payload.fide_rating).toBeUndefined();
    expect(payload.fide_rating_synced_at).toBeUndefined();
  });

  it("does not call FIDE for a non-FIDE field update", async () => {
    const res = await PATCH(makeReq({ nationality: "Malaysia" }));
    expect(res.status).toBe(200);
    expect(mockFetchFidePlayer).not.toHaveBeenCalled();
  });

  it("does not re-fetch when the submitted FIDE ID equals the existing one", async () => {
    mockMaybeSingle.mockResolvedValue({
      data: { fide_id: 1503014 },
      error: null,
    });
    const res = await PATCH(makeReq({ fide_id: 1503014 }));
    expect(res.status).toBe(200);
    expect(mockFetchFidePlayer).not.toHaveBeenCalled();
  });
});
