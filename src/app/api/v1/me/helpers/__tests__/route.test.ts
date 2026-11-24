import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const {
  mockRpc,
  mockSingle,
  mockMaybeSingle,
  mockFrom,
  mockGetClaims,
  mockLoadOverview,
  mockSendEmail,
} = vi.hoisted(() => {
  const mockSingle = vi.fn();
  const mockMaybeSingle = vi.fn();
  const eq = vi.fn(() => ({
    single: mockSingle,
    maybeSingle: mockMaybeSingle,
  }));
  const select = vi.fn(() => ({ eq }));
  return {
    mockRpc: vi.fn(),
    mockSingle,
    mockMaybeSingle,
    mockFrom: vi.fn(() => ({ select })),
    mockGetClaims: vi.fn(),
    mockLoadOverview: vi.fn(),
    mockSendEmail: vi.fn(),
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
vi.mock("@/services/email/email", () => ({
  sendHelperInvitationEmail: mockSendEmail,
}));
vi.mock("@/services/guardianship/helpers", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("@/services/guardianship/helpers")>();
  return { ...actual, loadHelpersOverview: mockLoadOverview };
});
vi.mock("@/lib/tournaments/datetime", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("@/lib/tournaments/datetime")>();
  return { ...actual, getTodayInTimeZone: () => "2026-11-24" };
});

import { GET, POST } from "../route";
import { DELETE as endHelper } from "../[id]/route";
import { DELETE as withdrawInvitation } from "../../helper-invitations/[id]/route";
import { appIdFor } from "@/test/identity";
import { hitWindow } from "@/services/rate-limit/window";
import { hashInvitationToken } from "@/services/organizations/invitations";

const AUTH_SUB = "bbbbbbbb-0000-0000-0000-000000000001";
const PLAYER = appIdFor(AUTH_SUB);
const ID = "cccccccc-0000-0000-0000-000000000001";

const OVERVIEW = {
  can_invite: true,
  helpers: [],
  invitations: [],
  helping: [],
};

function jsonReq(url: string, method: string, body?: unknown) {
  return new NextRequest(`http://localhost${url}`, {
    method,
    headers: { "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

function ctx(id: string) {
  return { params: Promise.resolve({ id }) };
}

beforeEach(() => {
  vi.clearAllMocks();
  mockGetClaims.mockResolvedValue({
    data: { claims: { sub: AUTH_SUB } },
    error: null,
  });
  mockSingle.mockResolvedValue({
    data: {
      account_type: "self",
      auth_user_id: AUTH_SUB,
      first_name: "Bea",
      last_name: "Player",
    },
    error: null,
  });
  mockMaybeSingle.mockResolvedValue({
    data: { date_of_birth: "1990-01-01" },
    error: null,
  });
  mockLoadOverview.mockImplementation(
    async (_id: string, canInvite: boolean) => ({
      ok: true,
      data: { ...OVERVIEW, can_invite: canInvite },
    }),
  );
  mockSendEmail.mockResolvedValue(undefined);
});

describe("GET /api/v1/me/helpers", () => {
  it("401s without a session", async () => {
    mockGetClaims.mockResolvedValue({ data: null, error: null });
    expect((await GET()).status).toBe(401);
  });

  it("returns the overview, and lets an adult self-managed player invite", async () => {
    const res = await GET();
    expect(res.status).toBe(200);
    expect(mockLoadOverview).toHaveBeenCalledWith(PLAYER, true);
    expect((await res.json()).data.can_invite).toBe(true);
  });

  it("doesn't offer inviting to an under-18 or managed account", async () => {
    mockMaybeSingle.mockResolvedValue({
      data: { date_of_birth: "2010-01-01" },
      error: null,
    });
    await GET();
    expect(mockLoadOverview).toHaveBeenLastCalledWith(PLAYER, false);

    mockMaybeSingle.mockResolvedValue({ data: null, error: null });
    mockSingle.mockResolvedValue({
      data: { account_type: "managed", auth_user_id: null },
      error: null,
    });
    await GET();
    expect(mockLoadOverview).toHaveBeenLastCalledWith(PLAYER, false);
  });

  it("500s when the overview can't be loaded", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    mockLoadOverview.mockResolvedValue({ ok: false, error: { message: "x" } });
    expect((await GET()).status).toBe(500);
  });
});

describe("POST /api/v1/me/helpers", () => {
  beforeEach(() => {
    mockRpc.mockResolvedValue({
      data: {
        invitation_id: ID,
        email: "carer@example.com",
        expires_at: "2026-11-27T00:00:00Z",
      },
      error: null,
    });
  });

  it("401s without a session", async () => {
    mockGetClaims.mockResolvedValue({ data: null, error: null });
    const res = await POST(
      jsonReq("/api/v1/me/helpers", "POST", {
        email: "c@example.com",
        relationship: "carer",
      }),
    );
    expect(res.status).toBe(401);
    expect(mockRpc).not.toHaveBeenCalled();
  });

  it("stores only the token's hash and emails the link", async () => {
    const res = await POST(
      jsonReq("/api/v1/me/helpers", "POST", {
        email: " Carer@Example.com ",
        relationship: "carer",
      }),
    );
    expect(res.status).toBe(201);
    const [fn, args] = mockRpc.mock.calls[0];
    expect(fn).toBe("create_helper_invitation");
    expect(args).toMatchObject({
      p_player_user_id: PLAYER,
      p_email: "carer@example.com",
      p_relationship: "carer",
    });
    expect(args.p_token_hash).toMatch(/^[0-9a-f]{64}$/);

    const [to, params] = mockSendEmail.mock.calls[0];
    expect(to).toBe("carer@example.com");
    expect(params.playerName).toBe("Bea Player");
    expect(params.relationshipLabel).toBe("carer");
    const token = params.invitationUrl.split("/helper-invitations/")[1];
    expect(hashInvitationToken(token)).toBe(args.p_token_hash);
    expect(JSON.stringify(await res.json())).not.toContain(token);
  });

  it("reports email_sent: false when the email fails, keeping the invitation", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    mockSendEmail.mockRejectedValue(new Error("down"));
    const res = await POST(
      jsonReq("/api/v1/me/helpers", "POST", {
        email: "c@example.com",
        relationship: "coach",
      }),
    );
    expect(res.status).toBe(201);
    expect((await res.json()).data.email_sent).toBe(false);
  });

  it.each([
    [{ email: "nope", relationship: "carer" }],
    [{ email: "c@example.com", relationship: "legal_guardian" }],
    [{ email: "c@example.com" }],
  ])("400s for %j", async (body) => {
    const res = await POST(jsonReq("/api/v1/me/helpers", "POST", body));
    expect(res.status).toBe(400);
    expect(mockRpc).not.toHaveBeenCalled();
  });

  it.each([
    ["HELPER_INVITE_NOT_ALLOWED: x", 403],
    ["HELPER_SELF: x", 400],
    ["HELPER_ALREADY_ACTIVE: x", 409],
    ["INVALID_HELPER_INVITATION: x", 400],
  ])("maps %s to %i and sends no email", async (message, status) => {
    mockRpc.mockResolvedValue({
      data: null,
      error: { code: "P0001", message },
    });
    const res = await POST(
      jsonReq("/api/v1/me/helpers", "POST", {
        email: "c@example.com",
        relationship: "carer",
      }),
    );
    expect(res.status).toBe(status);
    expect(mockSendEmail).not.toHaveBeenCalled();
  });

  it("429s when rate limited", async () => {
    vi.mocked(hitWindow).mockResolvedValueOnce(300);
    const res = await POST(
      jsonReq("/api/v1/me/helpers", "POST", {
        email: "c@example.com",
        relationship: "carer",
      }),
    );
    expect(res.status).toBe(429);
    expect(hitWindow).toHaveBeenCalledWith(
      `ratelimit:helperInvite:user:${PLAYER}`,
      expect.any(Number),
      expect.any(Number),
    );
  });
});

describe("DELETE /api/v1/me/helpers/[id]", () => {
  it("ends the relationship from either side", async () => {
    mockRpc.mockResolvedValue({
      data: { guardianship_id: ID, ended_by: "player" },
      error: null,
    });
    const res = await endHelper(
      jsonReq(`/api/v1/me/helpers/${ID}`, "DELETE"),
      ctx(ID),
    );
    expect(res.status).toBe(200);
    expect(mockRpc).toHaveBeenCalledWith("end_helper_guardianship", {
      p_user_id: PLAYER,
      p_guardianship_id: ID,
    });
    expect((await res.json()).data).toEqual({ id: ID, ended_by: "player" });
  });

  it("404s when the caller isn't part of an active relationship", async () => {
    mockRpc.mockResolvedValue({
      data: null,
      error: { code: "P0002", message: "HELPER_NOT_FOUND: none" },
    });
    const res = await endHelper(
      jsonReq(`/api/v1/me/helpers/${ID}`, "DELETE"),
      ctx(ID),
    );
    expect(res.status).toBe(404);
  });

  it("404s for a malformed id and 401s without a session", async () => {
    const bad = await endHelper(
      jsonReq("/api/v1/me/helpers/x", "DELETE"),
      ctx("x"),
    );
    expect(bad.status).toBe(404);
    mockGetClaims.mockResolvedValue({ data: null, error: null });
    const anon = await endHelper(
      jsonReq(`/api/v1/me/helpers/${ID}`, "DELETE"),
      ctx(ID),
    );
    expect(anon.status).toBe(401);
    expect(mockRpc).not.toHaveBeenCalled();
  });
});

describe("DELETE /api/v1/me/helper-invitations/[id]", () => {
  it("withdraws the player's own pending invitation", async () => {
    mockRpc.mockResolvedValue({
      data: { invitation_id: ID, already_revoked: false },
      error: null,
    });
    const res = await withdrawInvitation(
      jsonReq(`/api/v1/me/helper-invitations/${ID}`, "DELETE"),
      ctx(ID),
    );
    expect(res.status).toBe(200);
    expect(mockRpc).toHaveBeenCalledWith("revoke_helper_invitation", {
      p_player_user_id: PLAYER,
      p_invitation_id: ID,
    });
  });

  it("404s for someone else's invitation and 409s for an answered one", async () => {
    mockRpc.mockResolvedValueOnce({
      data: null,
      error: { code: "P0002", message: "INVITATION_NOT_FOUND: x" },
    });
    const notMine = await withdrawInvitation(
      jsonReq(`/api/v1/me/helper-invitations/${ID}`, "DELETE"),
      ctx(ID),
    );
    expect(notMine.status).toBe(404);

    mockRpc.mockResolvedValueOnce({
      data: null,
      error: { code: "P0001", message: "INVITATION_CLOSED: accepted" },
    });
    const answered = await withdrawInvitation(
      jsonReq(`/api/v1/me/helper-invitations/${ID}`, "DELETE"),
      ctx(ID),
    );
    expect(answered.status).toBe(409);
  });
});
