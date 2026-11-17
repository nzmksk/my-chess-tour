import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest, NextResponse } from "next/server";

const { mockAuthorize, mockRpc, mockFrom, builder, listResult } = vi.hoisted(() => {
  const listResult: { data: unknown; error: unknown } = { data: [], error: null };
  const builder: Record<string, unknown> = {};
  for (const m of ["select", "eq", "order"]) {
    builder[m] = vi.fn(() => builder);
  }
  builder.then = (
    onfulfilled: (v: unknown) => unknown,
    onrejected?: (r: unknown) => unknown,
  ) => Promise.resolve(listResult).then(onfulfilled, onrejected);
  return {
    mockAuthorize: vi.fn(),
    mockRpc: vi.fn(),
    mockFrom: vi.fn(() => builder),
    builder,
    listResult,
  };
});

vi.mock("@/app/api/v1/organizations/_lib/authorize-org", () => ({
  authorizeOrgPermission: mockAuthorize,
  UUID_RE: /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i,
}));

vi.mock("@/services/supabase/admin", () => ({
  supabaseAdmin: { from: mockFrom, rpc: mockRpc },
}));

import { GET } from "../route";
import { DELETE } from "../[id]/route";

const USER_ID = "aaaaaaaa-0000-0000-0000-000000000001";
const ORG_ID = "bbbbbbbb-0000-0000-0000-000000000001";
const INV_ID = "eeeeeeee-0000-0000-0000-000000000001";
const FUTURE = new Date(Date.now() + 10 * 86_400_000 - 1000).toISOString();
const PAST = new Date(Date.now() - 1000).toISOString();

const req = () => new NextRequest(`http://localhost/api/v1/organizations/${ORG_ID}/invitations`);

beforeEach(() => {
  vi.clearAllMocks();
  mockAuthorize.mockResolvedValue({ ok: true, userId: USER_ID });
  listResult.data = [];
  listResult.error = null;
  mockRpc.mockResolvedValue({ data: { id: INV_ID, email: "x@example.com" }, error: null });
});

describe("GET /api/v1/organizations/:orgId/invitations", () => {
  it("lists the organization's pending invitations for an inviter", async () => {
    listResult.data = [
      {
        id: INV_ID,
        email: "farid@example.com",
        status: "pending",
        created_at: "2026-11-17T00:00:00Z",
        expires_at: FUTURE,
        roles: { name: "admin" },
        inviter: { first_name: "Aisha", last_name: "Rahman" },
      },
      {
        id: "eeeeeeee-0000-0000-0000-000000000002",
        email: "old@example.com",
        status: "pending",
        created_at: "2026-10-01T00:00:00Z",
        expires_at: PAST,
        roles: { name: "member" },
        inviter: null,
      },
    ];

    const res = await GET(req(), { params: Promise.resolve({ orgId: ORG_ID }) });

    expect(mockAuthorize).toHaveBeenCalledWith(ORG_ID, "org.invite");
    expect(builder.eq).toHaveBeenCalledWith("organization_id", ORG_ID);
    expect(builder.eq).toHaveBeenCalledWith("status", "pending");
    expect(res.status).toBe(200);
    const { data } = await res.json();
    expect(data[0]).toEqual({
      id: INV_ID,
      email: "farid@example.com",
      role: "admin",
      invited_at: "2026-11-17T00:00:00Z",
      expires_at: FUTURE,
      days_left: 10,
      expired: false,
      invited_by: "Aisha Rahman",
    });
    expect(data[1]).toMatchObject({ expired: true, days_left: 0, invited_by: null });
  });

  it("returns the authorization failure as is", async () => {
    mockAuthorize.mockResolvedValue({
      ok: false,
      response: NextResponse.json({ error: { code: "FORBIDDEN" } }, { status: 403 }),
    });
    const res = await GET(req(), { params: Promise.resolve({ orgId: ORG_ID }) });
    expect(res.status).toBe(403);
    expect(mockFrom).not.toHaveBeenCalled();
  });

  it("returns 500 when the query fails", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    listResult.error = { message: "boom" };
    const res = await GET(req(), { params: Promise.resolve({ orgId: ORG_ID }) });
    expect(res.status).toBe(500);
  });
});

describe("DELETE /api/v1/organizations/:orgId/invitations/:id", () => {
  const del = (id = INV_ID) =>
    DELETE(req(), { params: Promise.resolve({ orgId: ORG_ID, id }) });

  it("revokes the invitation as the acting user", async () => {
    const res = await del();
    expect(res.status).toBe(200);
    expect(mockAuthorize).toHaveBeenCalledWith(ORG_ID, "org.invite");
    expect(mockRpc).toHaveBeenCalledWith("revoke_organization_invitation", {
      p_invitation_id: INV_ID,
      p_org_id: ORG_ID,
      p_user_id: USER_ID,
    });
  });

  it("returns 400 for an invalid id", async () => {
    const res = await del("nope");
    expect(res.status).toBe(400);
    expect(mockRpc).not.toHaveBeenCalled();
  });

  it("returns 409 for an invitation that was already answered", async () => {
    mockRpc.mockResolvedValue({
      data: null,
      error: { code: "P0001", message: "INVITATION_CLOSED: this invitation was accepted" },
    });
    const res = await del();
    expect(res.status).toBe(409);
  });

  it("returns 404 for an invitation of another organization", async () => {
    mockRpc.mockResolvedValue({
      data: null,
      error: { code: "P0002", message: "INVITATION_NOT_FOUND: invitation not found" },
    });
    const res = await del();
    expect(res.status).toBe(404);
  });
});
