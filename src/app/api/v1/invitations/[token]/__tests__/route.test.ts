import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const { mockRpc, mockGetAuthClaims } = vi.hoisted(() => ({
  mockRpc: vi.fn(),
  mockGetAuthClaims: vi.fn(),
}));

vi.mock("@/services/supabase/admin", () => ({
  supabaseAdmin: { rpc: mockRpc },
}));

vi.mock("@/services/supabase/permission", () => ({
  getAuthClaims: mockGetAuthClaims,
}));

import { POST as accept } from "../accept/route";
import { POST as decline } from "../decline/route";
import { hashInvitationToken } from "@/services/organizations/invitations";

const TOKEN = "T".repeat(43);
const USER_ID = "aaaaaaaa-0000-0000-0000-000000000001";
const ORG_ID = "bbbbbbbb-0000-0000-0000-000000000001";

const req = (action: string) =>
  new NextRequest(`http://localhost/api/v1/invitations/${TOKEN}/${action}`, {
    method: "POST",
  });
const params = (token = TOKEN) => ({ params: Promise.resolve({ token }) });

beforeEach(() => {
  vi.clearAllMocks();
  mockGetAuthClaims.mockResolvedValue({ id: USER_ID, email: "farid@example.com" });
  mockRpc.mockResolvedValue({
    data: { organization_id: ORG_ID, already_accepted: false },
    error: null,
  });
});

describe("POST /api/v1/invitations/:token/accept", () => {
  it("accepts as the signed-in user, by the token's hash", async () => {
    const res = await accept(req("accept"), params());
    expect(res.status).toBe(200);
    expect(mockRpc).toHaveBeenCalledWith("accept_organization_invitation", {
      p_token_hash: hashInvitationToken(TOKEN),
      p_user_id: USER_ID,
    });
    expect((await res.json()).data.organization_id).toBe(ORG_ID);
  });

  it("requires a session", async () => {
    mockGetAuthClaims.mockResolvedValue(null);
    const res = await accept(req("accept"), params());
    expect(res.status).toBe(401);
    expect(mockRpc).not.toHaveBeenCalled();
  });

  it("returns 404 for a malformed token without touching the database", async () => {
    const res = await accept(req("accept"), params("short"));
    expect(res.status).toBe(404);
    expect(mockRpc).not.toHaveBeenCalled();
  });

  it("refuses an account the invitation wasn't sent to", async () => {
    mockRpc.mockResolvedValue({
      data: null,
      error: { code: "42501", message: "INVITATION_WRONG_ACCOUNT: different address" },
    });
    const res = await accept(req("accept"), params());
    expect(res.status).toBe(403);
    expect((await res.json()).error.code).toBe("WRONG_ACCOUNT");
  });

  it("refuses an expired invitation with 410", async () => {
    mockRpc.mockResolvedValue({
      data: null,
      error: { code: "P0001", message: "INVITATION_EXPIRED: expired at ..." },
    });
    const res = await accept(req("accept"), params());
    expect(res.status).toBe(410);
  });
});

describe("POST /api/v1/invitations/:token/decline", () => {
  it("declines without a session", async () => {
    mockGetAuthClaims.mockResolvedValue(null);
    const res = await decline(req("decline"), params());
    expect(res.status).toBe(200);
    expect(mockRpc).toHaveBeenCalledWith("decline_organization_invitation", {
      p_token_hash: hashInvitationToken(TOKEN),
      p_user_id: null,
    });
  });

  it("records the signed-in user as the one who declined", async () => {
    await decline(req("decline"), params());
    expect(mockRpc).toHaveBeenCalledWith("decline_organization_invitation", {
      p_token_hash: hashInvitationToken(TOKEN),
      p_user_id: USER_ID,
    });
  });

  it("returns 404 for a malformed token", async () => {
    const res = await decline(req("decline"), params("bad"));
    expect(res.status).toBe(404);
    expect(mockRpc).not.toHaveBeenCalled();
  });

  it("refuses an invitation that is no longer open", async () => {
    mockRpc.mockResolvedValue({
      data: null,
      error: { code: "P0001", message: "INVITATION_CLOSED: this invitation was revoked" },
    });
    const res = await decline(req("decline"), params());
    expect(res.status).toBe(409);
  });
});
