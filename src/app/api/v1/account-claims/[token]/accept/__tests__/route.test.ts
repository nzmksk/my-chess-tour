import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import type { AccountClaimView } from "@/services/guardianship/account-claims";

const { mockRpc, mockCreateUser, mockGetClaim } = vi.hoisted(() => ({
  mockRpc: vi.fn(),
  mockCreateUser: vi.fn(),
  mockGetClaim: vi.fn(),
}));

vi.mock("@/services/supabase/admin", () => ({
  supabaseAdmin: {
    rpc: mockRpc,
    auth: { admin: { createUser: mockCreateUser } },
  },
}));
vi.mock("@/services/guardianship/account-claims", async (importOriginal) => ({
  ...(await importOriginal<
    typeof import("@/services/guardianship/account-claims")
  >()),
  getAccountClaimByToken: mockGetClaim,
}));

import { POST } from "../route";
import { hitWindow } from "@/services/rate-limit/window";
import { TERMS_VERSION } from "@/lib/reference/legal";

const TOKEN = "t".repeat(43);
const GOOD_PASSWORD = "Str0ng!pass";

function claim(overrides: Partial<AccountClaimView> = {}): AccountClaimView {
  return {
    tokenHash: "h".repeat(64),
    state: "pending",
    email: "ada@example.com",
    expiresAt: "2026-11-27T12:00:00Z",
    playerFirstName: "Ada",
    playerLastName: "Adult",
    guardianName: "Gwen Guardian",
    ...overrides,
  };
}

const accept = (body: unknown) =>
  POST(
    new NextRequest(`http://localhost/api/v1/account-claims/${TOKEN}/accept`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    }),
    { params: Promise.resolve({ token: TOKEN }) },
  );

beforeEach(() => {
  vi.clearAllMocks();
  mockGetClaim.mockResolvedValue(claim());
  mockRpc.mockResolvedValue({ data: false, error: null });
  mockCreateUser.mockResolvedValue({
    data: { user: { id: "auth-1" } },
    error: null,
  });
  vi.spyOn(console, "error").mockImplementation(() => {});
});

describe("POST /api/v1/account-claims/[token]/accept", () => {
  it("creates the login on the claim's own address, carrying the claim for the link step", async () => {
    const res = await accept({ password: GOOD_PASSWORD, accept_terms: true });

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ data: { email: "ada@example.com" } });
    expect(mockGetClaim).toHaveBeenCalledWith(TOKEN);
    expect(mockRpc).toHaveBeenCalledWith("email_registered", {
      p_email: "ada@example.com",
    });
    expect(mockCreateUser).toHaveBeenCalledWith({
      email: "ada@example.com",
      password: GOOD_PASSWORD,
      email_confirm: true,
      user_metadata: {
        claim_token_hash: "h".repeat(64),
        terms_version: TERMS_VERSION,
        first_name: "Ada",
        last_name: "Adult",
      },
    });
  });

  it("ignores any address in the request", async () => {
    await accept({
      password: GOOD_PASSWORD,
      accept_terms: true,
      email: "attacker@example.com",
    });
    expect(mockCreateUser.mock.calls[0][0].email).toBe("ada@example.com");
  });

  it.each([
    ["expired", 410],
    ["accepted", 410],
    ["closed", 410],
  ] as const)("refuses a %s claim", async (state, status) => {
    mockGetClaim.mockResolvedValue(claim({ state }));
    const res = await accept({ password: GOOD_PASSWORD, accept_terms: true });
    expect(res.status).toBe(status);
    expect((await res.json()).error.code).toBe("CLAIM_CLOSED");
    expect(mockCreateUser).not.toHaveBeenCalled();
  });

  it("404s for an unknown link", async () => {
    mockGetClaim.mockResolvedValue(null);
    expect(
      (await accept({ password: GOOD_PASSWORD, accept_terms: true })).status,
    ).toBe(404);
  });

  it("needs the Terms accepted and a strong password", async () => {
    expect((await accept({ password: GOOD_PASSWORD })).status).toBe(400);
    expect(
      (await accept({ password: "weak", accept_terms: true })).status,
    ).toBe(400);
    expect(mockCreateUser).not.toHaveBeenCalled();
  });

  it("refuses, and sends to support, when the address already has an account", async () => {
    mockRpc.mockResolvedValue({ data: true, error: null });
    const res = await accept({ password: GOOD_PASSWORD, accept_terms: true });

    expect(res.status).toBe(409);
    expect((await res.json()).error.message).toMatch(
      /contact support@mychesstour\.com/,
    );
    expect(mockCreateUser).not.toHaveBeenCalled();
  });

  it("maps Auth's own duplicate-address refusal the same way", async () => {
    mockCreateUser.mockResolvedValue({
      data: null,
      error: { code: "email_exists", message: "already registered" },
    });
    const res = await accept({ password: GOOD_PASSWORD, accept_terms: true });
    expect(res.status).toBe(409);
  });

  it("reports a link step refusal as a closed link", async () => {
    mockCreateUser.mockResolvedValue({
      data: null,
      error: {
        message: "handle_new_user failed: CLAIM_INVALID: no longer valid",
      },
    });
    const res = await accept({ password: GOOD_PASSWORD, accept_terms: true });
    expect(res.status).toBe(410);
  });

  it("500s on an unexpected Auth error without leaking it", async () => {
    mockCreateUser.mockResolvedValue({
      data: null,
      error: { message: "Database error saving new user" },
    });
    const res = await accept({ password: GOOD_PASSWORD, accept_terms: true });
    expect(res.status).toBe(500);
    expect(JSON.stringify(await res.json())).not.toContain("Database error");
  });

  it("is rate limited per IP", async () => {
    vi.mocked(hitWindow).mockResolvedValueOnce(60);
    const res = await accept({ password: GOOD_PASSWORD, accept_terms: true });
    expect(res.status).toBe(429);
    expect(mockGetClaim).not.toHaveBeenCalled();
  });
});
