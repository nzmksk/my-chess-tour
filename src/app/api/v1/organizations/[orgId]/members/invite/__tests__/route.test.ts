import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest, NextResponse } from "next/server";

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

const { mockAuthorize, mockRpc, mockNotify } = vi.hoisted(() => ({
  mockAuthorize: vi.fn(),
  mockRpc: vi.fn(),
  mockNotify: vi.fn(),
}));

vi.mock("@/app/api/v1/organizations/_lib/authorize-org", () => ({
  authorizeOrgPermission: mockAuthorize,
}));

vi.mock("@/services/supabase/admin", () => ({
  supabaseAdmin: { rpc: mockRpc },
}));

vi.mock("@/services/organizations/notify", () => ({
  notifyMemberInvited: mockNotify,
}));

import { POST } from "../route";
import { hashInvitationToken, INVITATION_TOKEN_RE } from "@/services/organizations/invitations";

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const USER_ID = "aaaaaaaa-0000-0000-0000-000000000001";
const ORG_ID = "bbbbbbbb-0000-0000-0000-000000000001";
const INVITATION_ID = "eeeeeeee-0000-0000-0000-000000000001";
const CREATED_AT = "2026-11-17T01:00:00.000Z";
const EXPIRES_AT = "2026-12-17T01:00:00.000Z";

function makeRequest(body: unknown = { email: "new@example.com", role: "member" }) {
  return new NextRequest(
    `http://localhost/api/v1/organizations/${ORG_ID}/members/invite`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: typeof body === "string" ? body : JSON.stringify(body),
    },
  );
}

const call = (body?: unknown) =>
  POST(makeRequest(body), { params: Promise.resolve({ orgId: ORG_ID }) });

function rpcReturns(overrides: Record<string, unknown> = {}) {
  mockRpc.mockResolvedValue({
    data: {
      id: INVITATION_ID,
      email: "new@example.com",
      role: "member",
      created_at: CREATED_AT,
      expires_at: EXPIRES_AT,
      resent: false,
      ...overrides,
    },
    error: null,
  });
}

function rpcFails(message: string, code = "P0001") {
  mockRpc.mockResolvedValue({ data: null, error: { code, message } });
}

beforeEach(() => {
  vi.clearAllMocks();
  mockAuthorize.mockResolvedValue({ ok: true, userId: USER_ID });
  mockNotify.mockResolvedValue(true);
  rpcReturns();
});

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("POST /api/v1/organizations/:orgId/members/invite", () => {
  describe("authorization", () => {
    it("requires org.invite on the organization", async () => {
      await call();
      expect(mockAuthorize).toHaveBeenCalledWith(ORG_ID, "org.invite");
    });

    it("returns the authorization failure as is, inviting no one", async () => {
      mockAuthorize.mockResolvedValue({
        ok: false,
        response: NextResponse.json(
          { error: { code: "FORBIDDEN", message: "Access denied" } },
          { status: 403 },
        ),
      });
      const res = await call();
      expect(res.status).toBe(403);
      expect(mockRpc).not.toHaveBeenCalled();
      expect(mockNotify).not.toHaveBeenCalled();
    });
  });

  describe("validation", () => {
    it("returns 400 when the body is not JSON", async () => {
      const res = await call("not json");
      expect(res.status).toBe(400);
    });

    it("returns 400 when email is missing", async () => {
      const res = await call({ role: "member" });
      expect(res.status).toBe(400);
      expect(mockRpc).not.toHaveBeenCalled();
    });

    it("returns 400 when email is invalid", async () => {
      const res = await call({ email: "not-an-email", role: "member" });
      expect(res.status).toBe(400);
    });

    it("returns 400 when role is 'owner'", async () => {
      const res = await call({ email: "a@example.com", role: "owner" });
      expect(res.status).toBe(400);
      expect(mockRpc).not.toHaveBeenCalled();
    });
  });

  describe("creating the invitation", () => {
    it("creates it with the normalised email, role, inviter and a token hash", async () => {
      await call({ email: "NEW@Example.com", role: "admin" });

      expect(mockRpc).toHaveBeenCalledWith("create_organization_invitation", {
        p_org_id: ORG_ID,
        p_email: "new@example.com",
        p_role: "admin",
        p_invited_by: USER_ID,
        p_token_hash: expect.stringMatching(/^[0-9a-f]{64}$/),
      });
    });

    it("emails a link whose token hashes to what was stored", async () => {
      await call({ email: "new@example.com", role: "admin" });

      expect(mockNotify).toHaveBeenCalledOnce();
      const args = mockNotify.mock.calls[0][0];
      expect(args).toMatchObject({
        orgId: ORG_ID,
        inviterId: USER_ID,
        email: "new@example.com",
        role: "admin",
      });
      const url = new URL(args.invitationUrl);
      const token = url.pathname.replace("/invitations/", "");
      expect(token).toMatch(INVITATION_TOKEN_RE);
      expect(mockRpc.mock.calls[0][1].p_token_hash).toBe(hashInvitationToken(token));
    });

    it("returns 201 with the pending invitation", async () => {
      const res = await call();
      expect(res.status).toBe(201);
      expect((await res.json()).data).toEqual({
        id: INVITATION_ID,
        email: "new@example.com",
        role: "member",
        status: "pending",
        invited_at: CREATED_AT,
        expires_at: EXPIRES_AT,
        resent: false,
        email_sent: true,
      });
    });

    it("reports a refreshed invitation as resent", async () => {
      rpcReturns({ resent: true });
      const res = await call();
      expect((await res.json()).data.resent).toBe(true);
    });

    it("keeps the invitation and reports email_sent false when the email fails", async () => {
      mockNotify.mockResolvedValue(false);
      const res = await call();
      expect(res.status).toBe(201);
      expect((await res.json()).data.email_sent).toBe(false);
    });
  });

  describe("refusals", () => {
    it("returns 409 when the address already belongs to a member", async () => {
      rpcFails("INVITATION_ALREADY_MEMBER: new@example.com is already a member", "23505");
      const res = await call();
      expect(res.status).toBe(409);
      const json = await res.json();
      expect(json.error.code).toBe("CONFLICT");
      expect(json.error.message).toMatch(/already a member/i);
      expect(mockNotify).not.toHaveBeenCalled();
    });

    it("returns 403 when the database refuses the inviter", async () => {
      rpcFails("INVITATION_FORBIDDEN: org.invite is required", "42501");
      const res = await call();
      expect(res.status).toBe(403);
      expect(mockNotify).not.toHaveBeenCalled();
    });

    it("returns 500 on an unexpected database error", async () => {
      vi.spyOn(console, "error").mockImplementation(() => {});
      rpcFails("connection reset", "08006");
      const res = await call();
      expect(res.status).toBe(500);
      expect(mockNotify).not.toHaveBeenCalled();
    });
  });
});
