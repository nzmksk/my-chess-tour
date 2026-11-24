import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import type { DependentView } from "@/services/guardianship/dependents";

const { mockRpc, mockGetClaims, mockGetDependent, mockSendAwaiting } =
  vi.hoisted(() => ({
    mockRpc: vi.fn(),
    mockGetClaims: vi.fn(),
    mockGetDependent: vi.fn(),
    mockSendAwaiting: vi.fn(),
  }));

vi.mock("@/services/supabase/admin", () => ({
  supabaseAdmin: { rpc: mockRpc },
}));
vi.mock("@/services/supabase/server", () => ({
  createClient: vi.fn().mockResolvedValue({
    auth: { getClaims: mockGetClaims },
  }),
}));
vi.mock("next/headers", () => ({
  cookies: vi.fn().mockResolvedValue({ getAll: () => [], set: vi.fn() }),
}));
vi.mock("@/services/guardianship/dependents", async (importOriginal) => ({
  ...(await importOriginal<
    typeof import("@/services/guardianship/dependents")
  >()),
  getDependent: mockGetDependent,
}));
vi.mock("@/services/prizes/execute", () => ({
  sendAwardsAwaitingBank: mockSendAwaiting,
}));

import { DELETE, PUT } from "../[id]/bank-account/route";
import { appIdFor } from "@/test/identity";
import { runAfterCallbacks } from "@/test/after";

const AUTH_SUB = "bbbbbbbb-0000-0000-0000-000000000002";
const HELPER = appIdFor(AUTH_SUB);
const ADULT_ID = "cccccccc-0000-0000-0000-000000000002";
const URL = `http://localhost/api/v1/me/dependents/${ADULT_ID}/bank-account`;

function view(overrides: Partial<DependentView> = {}): DependentView {
  return {
    id: ADULT_ID,
    guardianship_id: "dddddddd-0000-0000-0000-000000000002",
    first_name: "Aziz",
    last_name: "Adult",
    account_type: "managed",
    contact_email: null,
    relationship: "carer",
    basis: "authorised",
    authorisation_method: "guardian_attestation",
    terms_version: "2026-11-24",
    terms_accepted_at: "2026-11-24T00:00:00Z",
    added_at: "2026-11-24T00:00:00Z",
    date_of_birth: "1960-01-01",
    gender: null,
    nationality: null,
    fide_id: null,
    mcf_id: null,
    title: null,
    national_rating: null,
    oku_status: "none",
    ...overrides,
  };
}

const params = { params: Promise.resolve({ id: ADULT_ID }) };
const VALID = {
  bank_code: "MBBEMYKL",
  account_holder: "Aziz bin Adult",
  account_number: "514100000002",
};

const put = (body: unknown) =>
  PUT(
    new NextRequest(URL, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    }),
    params,
  );

beforeEach(() => {
  vi.clearAllMocks();
  mockGetClaims.mockResolvedValue({ data: { claims: { sub: AUTH_SUB } } });
  mockGetDependent.mockResolvedValue({ ok: true, data: view() });
  mockRpc.mockResolvedValue({
    data: {
      changed: true,
      id: "bank-1",
      status: "pending",
      account_number_last4: "0002",
    },
    error: null,
  });
  vi.spyOn(console, "error").mockImplementation(() => {});
});

describe("PUT /api/v1/me/dependents/[id]/bank-account", () => {
  it("saves an adult dependent's details as entered by the helper", async () => {
    const res = await put(VALID);

    expect(res.status).toBe(200);
    expect(mockRpc).toHaveBeenCalledWith("set_player_bank_account", {
      p_user_id: ADULT_ID,
      p_bank_code: "MBBEMYKL",
      p_bank_name: expect.any(String),
      p_account_holder: "Aziz bin Adult",
      p_account_number: "514100000002",
      p_entered_by: HELPER,
    });
    expect(JSON.stringify(await res.json())).not.toContain("514100000002");
    await runAfterCallbacks();
    expect(mockSendAwaiting).toHaveBeenCalledWith(ADULT_ID);
  });

  it("refuses an account held in anyone else's name", async () => {
    const res = await put({ ...VALID, account_holder: "Hana Helper" });

    expect(res.status).toBe(422);
    expect((await res.json()).error.code).toBe("HOLDER_NOT_PLAYER");
    expect(mockRpc).not.toHaveBeenCalled();
  });

  it("refuses a minor dependent: their prize goes to the guardian", async () => {
    mockGetDependent.mockResolvedValue({
      ok: true,
      data: view({
        basis: "minor",
        relationship: "parent",
        authorisation_method: null,
      }),
    });

    const res = await put(VALID);

    expect(res.status).toBe(409);
    expect((await res.json()).error.code).toBe("MINOR_DEPENDENT");
    expect(mockRpc).not.toHaveBeenCalled();
  });

  it("maps the database's MINOR_DEPENDENT backstop", async () => {
    mockRpc.mockResolvedValue({
      data: null,
      error: {
        code: "P0001",
        message:
          "MINOR_DEPENDENT: a minor's prizes are paid to their guardian's bank account",
      },
    });
    const res = await put(VALID);
    expect(res.status).toBe(409);
    expect((await res.json()).error.code).toBe("MINOR_DEPENDENT");
  });

  it("asks for the player's financial consent first", async () => {
    mockRpc.mockResolvedValue({
      data: null,
      error: {
        code: "P0001",
        message:
          "CONSENT_REQUIRED: bank details need the player's financial data consent",
      },
    });
    const res = await put(VALID);
    expect(res.status).toBe(409);
    expect((await res.json()).error.code).toBe("CONSENT_REQUIRED");
  });

  it("404s a guardianship revoked meanwhile", async () => {
    mockRpc.mockResolvedValue({
      data: null,
      error: {
        code: "42501",
        message:
          "NOT_GUARDIAN: only the player or someone acting for them can set their bank details",
      },
    });
    const res = await put(VALID);
    expect(res.status).toBe(404);
  });

  it("404s a player the caller doesn't act for", async () => {
    mockGetDependent.mockResolvedValue({ ok: true, data: null });
    const res = await put(VALID);
    expect(res.status).toBe(404);
    expect(mockRpc).not.toHaveBeenCalled();
  });

  it("validates the request like the player's own form", async () => {
    const res = await put({ ...VALID, bank_code: "NOPE" });
    expect(res.status).toBe(400);
    expect(mockRpc).not.toHaveBeenCalled();
  });
});

describe("DELETE /api/v1/me/dependents/[id]/bank-account", () => {
  it("clears the details as the helper, which withdraws the consent", async () => {
    mockRpc.mockResolvedValue({
      data: { changed: true, id: null },
      error: null,
    });

    const res = await DELETE(
      new NextRequest(URL, { method: "DELETE" }),
      params,
    );

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ data: null });
    expect(mockRpc).toHaveBeenCalledWith("set_player_bank_account", {
      p_user_id: ADULT_ID,
      p_bank_code: null,
      p_bank_name: null,
      p_account_holder: null,
      p_account_number: null,
      p_entered_by: HELPER,
    });
  });

  it("clears a minor's details too", async () => {
    mockGetDependent.mockResolvedValue({
      ok: true,
      data: view({ basis: "minor" }),
    });
    mockRpc.mockResolvedValue({
      data: { changed: false, id: null },
      error: null,
    });

    const res = await DELETE(
      new NextRequest(URL, { method: "DELETE" }),
      params,
    );

    expect(res.status).toBe(200);
  });
});
