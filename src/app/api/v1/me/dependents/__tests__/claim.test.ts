import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import type { DependentView } from "@/services/guardianship/dependents";

const { mockRpc, mockFrom, mockGetClaims, mockGetDependent, mockSendClaim } =
  vi.hoisted(() => {
    const builder: Record<string, unknown> = {};
    for (const m of ["select", "eq"]) builder[m] = vi.fn(() => builder);
    builder.maybeSingle = vi.fn().mockResolvedValue({
      data: { first_name: "Gwen", last_name: "Guardian" },
      error: null,
    });
    return {
      mockRpc: vi.fn(),
      mockFrom: vi.fn(() => builder),
      mockGetClaims: vi.fn(),
      mockGetDependent: vi.fn(),
      mockSendClaim: vi.fn(),
    };
  });

vi.mock("@/services/supabase/admin", () => ({
  supabaseAdmin: { from: mockFrom, rpc: mockRpc },
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
vi.mock("@/services/email/email", () => ({
  sendAccountClaimEmail: mockSendClaim,
}));

import { DELETE, POST } from "../[id]/claim/route";
import { appIdFor } from "@/test/identity";
import { hitWindow } from "@/services/rate-limit/window";
import { hashInvitationToken } from "@/services/organizations/invitations";

const AUTH_SUB = "bbbbbbbb-0000-0000-0000-000000000001";
const GUARDIAN = appIdFor(AUTH_SUB);
const ADULT_ID = "cccccccc-0000-0000-0000-000000000002";
const URL = `http://localhost/api/v1/me/dependents/${ADULT_ID}/claim`;

function view(overrides: Partial<DependentView> = {}): DependentView {
  return {
    id: ADULT_ID,
    guardianship_id: "dddddddd-0000-0000-0000-000000000001",
    first_name: "Ada",
    last_name: "Adult",
    account_type: "managed",
    contact_email: null,
    relationship: "carer",
    basis: "authorised",
    authorisation_method: "guardian_attestation",
    terms_version: "2026-11-24",
    terms_accepted_at: "2026-11-24T00:00:00Z",
    added_at: "2026-11-24T00:00:00Z",
    date_of_birth: "1990-01-01",
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
const start = (body: unknown) =>
  POST(
    new NextRequest(URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    }),
    params,
  );
const cancel = () => DELETE(new NextRequest(URL, { method: "DELETE" }), params);

beforeEach(() => {
  vi.clearAllMocks();
  mockGetClaims.mockResolvedValue({
    data: { claims: { sub: AUTH_SUB, email: "g@example.com" } },
    error: null,
  });
  mockGetDependent.mockResolvedValue({ ok: true, data: view() });
  mockRpc.mockResolvedValue({
    data: {
      claim_id: "claim-1",
      email: "ada@example.com",
      expires_at: "2026-11-27T12:00:00Z",
    },
    error: null,
  });
  mockSendClaim.mockResolvedValue(undefined);
  vi.spyOn(console, "error").mockImplementation(() => {});
});

describe("POST /api/v1/me/dependents/[id]/claim", () => {
  it("starts a handover and emails the player a link whose token isn't stored", async () => {
    const res = await start({ email: " Ada@Example.com " });

    expect(res.status).toBe(201);
    expect(await res.json()).toEqual({
      data: {
        email: "ada@example.com",
        expires_at: "2026-11-27T12:00:00Z",
        email_sent: true,
      },
    });
    const args = mockRpc.mock.calls[0][1] as Record<string, string>;
    expect(mockRpc.mock.calls[0][0]).toBe("create_account_claim");
    expect(args).toMatchObject({
      p_guardian_user_id: GUARDIAN,
      p_dependent_user_id: ADULT_ID,
      p_email: "ada@example.com",
    });
    const sent = mockSendClaim.mock.calls[0];
    expect(sent[0]).toBe("ada@example.com");
    expect(sent[1]).toMatchObject({
      playerName: "Ada",
      guardianName: "Gwen Guardian",
    });
    const token = (sent[1].claimUrl as string).split("/claim/")[1];
    expect(token).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(args.p_token_hash).toBe(hashInvitationToken(token));
  });

  it("still reports the claim when the email doesn't go out", async () => {
    mockSendClaim.mockRejectedValue(new Error("resend down"));
    const res = await start({ email: "ada@example.com" });
    expect(res.status).toBe(201);
    expect((await res.json()).data.email_sent).toBe(false);
  });

  it("sends a taken address to support instead of merging", async () => {
    mockRpc.mockResolvedValue({
      data: null,
      error: { message: "EMAIL_TAKEN: an account already uses this email" },
    });
    const res = await start({ email: "ada@example.com" });

    expect(res.status).toBe(409);
    const json = await res.json();
    expect(json.error.code).toBe("EMAIL_TAKEN");
    expect(json.error.message).toMatch(/contact support@mychesstour\.com/);
    expect(mockSendClaim).not.toHaveBeenCalled();
  });

  it("refuses a minor", async () => {
    mockRpc.mockResolvedValue({
      data: null,
      error: { message: "UNDER_18: a player must be 18 or over" },
    });
    expect((await start({ email: "kid@example.com" })).status).toBe(422);
  });

  it("refuses an invalid address before calling the database", async () => {
    const res = await start({ email: "not-an-email" });
    expect(res.status).toBe(400);
    expect(mockRpc).not.toHaveBeenCalled();
  });

  it("404s for anyone who isn't the active guardian", async () => {
    mockGetDependent.mockResolvedValue({ ok: true, data: null });
    const res = await start({ email: "ada@example.com" });
    expect(res.status).toBe(404);
    expect(mockRpc).not.toHaveBeenCalled();
    expect(mockSendClaim).not.toHaveBeenCalled();
  });

  it("is rate limited", async () => {
    vi.mocked(hitWindow).mockResolvedValueOnce(60);
    const res = await start({ email: "ada@example.com" });
    expect(res.status).toBe(429);
    expect(mockRpc).not.toHaveBeenCalled();
  });
});

describe("DELETE /api/v1/me/dependents/[id]/claim", () => {
  it("cancels the pending handover", async () => {
    mockRpc.mockResolvedValue({ data: true, error: null });
    const res = await cancel();

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ data: { cancelled: true } });
    expect(mockRpc).toHaveBeenCalledWith("cancel_account_claim", {
      p_guardian_user_id: GUARDIAN,
      p_dependent_user_id: ADULT_ID,
    });
  });

  it("404s for anyone who isn't the active guardian", async () => {
    mockGetDependent.mockResolvedValue({ ok: true, data: null });
    expect((await cancel()).status).toBe(404);
    expect(mockRpc).not.toHaveBeenCalled();
  });
});
