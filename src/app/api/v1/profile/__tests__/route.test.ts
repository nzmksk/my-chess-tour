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
import { hitWindow } from "@/services/rate-limit/window";
import { appIdFor } from "@/test/identity";

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

  it("429s a save once the user is over the profile-save limit, saving nothing", async () => {
    vi.mocked(hitWindow).mockResolvedValueOnce(300);
    const res = await PATCH(makeReq({ nationality: "Malaysia" }));

    expect(hitWindow).toHaveBeenCalledWith(
      `ratelimit:profileSave:user:${appIdFor(USER)}`,
      30,
      600,
    );
    expect(res.status).toBe(429);
    expect(res.headers.get("Retry-After")).toBe("300");
    expect(mockUpsert).not.toHaveBeenCalled();
  });

  it("counts only new FIDE IDs against the lookup limit", async () => {
    await PATCH(makeReq({ nationality: "Malaysia" }));
    expect(hitWindow).not.toHaveBeenCalledWith(
      expect.stringContaining("ratelimit:fideLookup:"),
      expect.anything(),
      expect.anything(),
    );
  });

  it("429s a new FIDE ID once over the lookup limit, without calling FIDE", async () => {
    // The profile-save bucket passes; the FIDE lookup bucket is over.
    vi.mocked(hitWindow).mockResolvedValueOnce(0).mockResolvedValueOnce(1800);
    const res = await PATCH(makeReq({ fide_id: 1503014 }));

    expect(hitWindow).toHaveBeenCalledWith(
      `ratelimit:fideLookup:user:${appIdFor(USER)}`,
      10,
      3600,
    );
    expect(res.status).toBe(429);
    expect(res.headers.get("Retry-After")).toBe("1800");
    expect(mockFetchFidePlayer).not.toHaveBeenCalled();
    expect(mockUpsert).not.toHaveBeenCalled();
  });
});

describe("PATCH /api/v1/profile — under-18 date of birth", () => {
  const thisYear = Number(
    new Intl.DateTimeFormat("en-CA", {
      timeZone: "Asia/Kuala_Lumpur",
      year: "numeric",
    }).format(new Date()),
  );
  const CHILD_DOB = `${thisYear - 10}-06-15`;

  beforeEach(() => {
    vi.clearAllMocks();
    mockGetClaims.mockResolvedValue({
      data: { claims: { sub: USER } },
      error: null,
    });
    mockMaybeSingle.mockResolvedValue({ data: null, error: null });
    mockSingle.mockResolvedValue({
      data: { account_type: "self" },
      error: null,
    });
    mockUpsert.mockResolvedValue({ error: null });
  });

  it("refuses an under-18 date of birth on a self-managed account, pointing to a guardian", async () => {
    const res = await PATCH(makeReq({ date_of_birth: CHILD_DOB }));
    expect(res.status).toBe(422);
    const json = await res.json();
    expect(json.error.code).toBe("UNDER_18");
    expect(json.error.message).toMatch(/18 or over/);
    expect(json.error.message).toMatch(/parent or guardian/);
    expect(mockUpsert).not.toHaveBeenCalled();
  });

  it("saves an adult date of birth without looking up the account type", async () => {
    const res = await PATCH(makeReq({ date_of_birth: "1990-01-01" }));
    expect(res.status).toBe(200);
    expect(mockSingle).not.toHaveBeenCalled();
    expect(mockUpsert.mock.calls[0][0].date_of_birth).toBe("1990-01-01");
  });

  it("exempts a managed account", async () => {
    mockSingle.mockResolvedValue({
      data: { account_type: "managed" },
      error: null,
    });
    const res = await PATCH(makeReq({ date_of_birth: CHILD_DOB }));
    expect(res.status).toBe(200);
    expect(mockUpsert.mock.calls[0][0].date_of_birth).toBe(CHILD_DOB);
  });

  it("doesn't re-check a date of birth that is already stored", async () => {
    mockMaybeSingle.mockResolvedValue({
      data: { date_of_birth: CHILD_DOB },
      error: null,
    });
    const res = await PATCH(
      makeReq({ date_of_birth: CHILD_DOB, nationality: "Malaysia" }),
    );
    expect(res.status).toBe(200);
    expect(mockSingle).not.toHaveBeenCalled();
  });

  it("500s when the account type can't be read", async () => {
    mockSingle.mockResolvedValue({ data: null, error: { message: "db down" } });
    const res = await PATCH(makeReq({ date_of_birth: CHILD_DOB }));
    expect(res.status).toBe(500);
    expect(JSON.stringify(await res.json())).not.toContain("db down");
    expect(mockUpsert).not.toHaveBeenCalled();
  });
});
