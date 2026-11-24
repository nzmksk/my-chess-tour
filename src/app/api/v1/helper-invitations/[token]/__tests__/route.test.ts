import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const { mockRpc, mockGetClaims } = vi.hoisted(() => ({
  mockRpc: vi.fn(),
  mockGetClaims: vi.fn(),
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

import { POST as accept } from "../accept/route";
import { POST as decline } from "../decline/route";
import { appIdFor } from "@/test/identity";
import { hashInvitationToken } from "@/services/organizations/invitations";
import { TERMS_VERSION } from "@/lib/reference/legal";

const AUTH_SUB = "bbbbbbbb-0000-0000-0000-000000000002";
const HELPER = appIdFor(AUTH_SUB);
const TOKEN = "a".repeat(43);

function req(action: string, body?: unknown) {
  return new NextRequest(
    `http://localhost/api/v1/helper-invitations/${TOKEN}/${action}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body),
    },
  );
}

function ctx(token = TOKEN) {
  return { params: Promise.resolve({ token }) };
}

beforeEach(() => {
  vi.clearAllMocks();
  mockGetClaims.mockResolvedValue({
    data: { claims: { sub: AUTH_SUB } },
    error: null,
  });
});

describe("POST /api/v1/helper-invitations/[token]/accept", () => {
  it("accepts as the signed-in helper with the server's Terms version", async () => {
    mockRpc.mockResolvedValue({
      data: { invitation_id: "i", guardianship_id: "g", player_user_id: "p" },
      error: null,
    });
    const res = await accept(req("accept", { accept_terms: true }), ctx());
    expect(res.status).toBe(200);
    expect(mockRpc).toHaveBeenCalledWith("accept_helper_invitation", {
      p_token_hash: hashInvitationToken(TOKEN),
      p_helper_user_id: HELPER,
      p_terms_version: TERMS_VERSION,
    });
  });

  it("requires a session", async () => {
    mockGetClaims.mockResolvedValue({ data: null, error: null });
    const res = await accept(req("accept", { accept_terms: true }), ctx());
    expect(res.status).toBe(401);
    expect(mockRpc).not.toHaveBeenCalled();
  });

  it("requires the Terms to be accepted", async () => {
    const res = await accept(req("accept"), ctx());
    expect(res.status).toBe(400);
    expect(mockRpc).not.toHaveBeenCalled();
  });

  it("404s for a malformed token without a lookup", async () => {
    const res = await accept(
      req("accept", { accept_terms: true }),
      ctx("short"),
    );
    expect(res.status).toBe(404);
    expect(mockRpc).not.toHaveBeenCalled();
  });

  it.each([
    ["INVITATION_NOT_FOUND: x", 404],
    ["INVITATION_WRONG_ACCOUNT: x", 403],
    ["INVITATION_EXPIRED: x", 410],
    ["INVITATION_CLOSED: accepted", 409],
    ["HELPER_NOT_ELIGIBLE: x", 403],
    ["HELPER_SELF: x", 400],
    ["HELPER_ALREADY_ACTIVE: x", 409],
    ["GUARDIANSHIP_LIMIT_REACHED: x", 422],
  ])("maps %s to %i", async (message, status) => {
    mockRpc.mockResolvedValue({
      data: null,
      error: { code: "P0001", message },
    });
    const res = await accept(req("accept", { accept_terms: true }), ctx());
    expect(res.status).toBe(status);
  });

  it("hides an unexpected error behind a 500", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    mockRpc.mockResolvedValue({
      data: null,
      error: { code: "XX000", message: "secret" },
    });
    const res = await accept(req("accept", { accept_terms: true }), ctx());
    expect(res.status).toBe(500);
    expect(JSON.stringify(await res.json())).not.toContain("secret");
  });
});

describe("POST /api/v1/helper-invitations/[token]/decline", () => {
  it("declines without an account", async () => {
    mockGetClaims.mockResolvedValue({ data: null, error: null });
    mockRpc.mockResolvedValue({
      data: { invitation_id: "i", already_declined: false },
      error: null,
    });
    const res = await decline(req("decline"), ctx());
    expect(res.status).toBe(200);
    expect(mockRpc).toHaveBeenCalledWith("decline_helper_invitation", {
      p_token_hash: hashInvitationToken(TOKEN),
      p_user_id: null,
    });
  });

  it("records who declined when signed in", async () => {
    mockRpc.mockResolvedValue({
      data: { invitation_id: "i", already_declined: true },
      error: null,
    });
    await decline(req("decline"), ctx());
    expect(mockRpc.mock.calls[0][1].p_user_id).toBe(HELPER);
  });

  it("410s for an expired invitation", async () => {
    mockRpc.mockResolvedValue({
      data: null,
      error: { code: "P0001", message: "INVITATION_EXPIRED: x" },
    });
    const res = await decline(req("decline"), ctx());
    expect(res.status).toBe(410);
  });
});
