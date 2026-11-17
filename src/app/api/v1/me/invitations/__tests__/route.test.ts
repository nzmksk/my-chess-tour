import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { runAfterCallbacks } from "@/test/after";

const { mockRpc, mockGetAuthClaims, mockNotify } = vi.hoisted(() => ({
  mockRpc: vi.fn(),
  mockGetAuthClaims: vi.fn(),
  mockNotify: vi.fn(),
}));

vi.mock("@/services/supabase/admin", () => ({
  supabaseAdmin: { rpc: mockRpc },
}));

vi.mock("@/services/supabase/permission", () => ({
  getAuthClaims: mockGetAuthClaims,
}));

vi.mock("@/services/organizations/notify", () => ({
  notifyInvitationResponded: mockNotify,
}));

import { POST as accept } from "../[id]/accept/route";
import { POST as decline } from "../[id]/decline/route";

const USER_ID = "aaaaaaaa-0000-0000-0000-000000000001";
const ORG_ID = "bbbbbbbb-0000-0000-0000-000000000001";
const INV_ID = "eeeeeeee-0000-0000-0000-000000000001";

const req = () =>
  new NextRequest(`http://localhost/api/v1/me/invitations/${INV_ID}/accept`, {
    method: "POST",
  });
const params = (id = INV_ID) => ({ params: Promise.resolve({ id }) });

beforeEach(() => {
  vi.clearAllMocks();
  mockGetAuthClaims.mockResolvedValue({ id: USER_ID, email: "farid@example.com" });
  mockRpc.mockResolvedValue({
    data: { invitation_id: INV_ID, organization_id: ORG_ID, already_accepted: false },
    error: null,
  });
});

describe("POST /api/v1/me/invitations/:id/accept", () => {
  it("accepts by id as the signed-in user and tells the inviter", async () => {
    const res = await accept(req(), params());
    expect(res.status).toBe(200);
    expect(mockRpc).toHaveBeenCalledWith("accept_organization_invitation_by_id", {
      p_invitation_id: INV_ID,
      p_user_id: USER_ID,
    });
    expect((await res.json()).data.organization_id).toBe(ORG_ID);
    await runAfterCallbacks();
    expect(mockNotify).toHaveBeenCalledWith(INV_ID);
  });

  it("doesn't tell the inviter twice about a repeated accept", async () => {
    mockRpc.mockResolvedValue({
      data: { invitation_id: INV_ID, organization_id: ORG_ID, already_accepted: true },
      error: null,
    });
    await accept(req(), params());
    await runAfterCallbacks();
    expect(mockNotify).not.toHaveBeenCalled();
  });

  it("requires a session", async () => {
    mockGetAuthClaims.mockResolvedValue(null);
    const res = await accept(req(), params());
    expect(res.status).toBe(401);
    expect(mockRpc).not.toHaveBeenCalled();
  });

  it("returns 400 for an invalid id", async () => {
    const res = await accept(req(), params("nope"));
    expect(res.status).toBe(400);
    expect(mockRpc).not.toHaveBeenCalled();
  });

  it("refuses someone else's invitation", async () => {
    mockRpc.mockResolvedValue({
      data: null,
      error: { code: "42501", message: "INVITATION_WRONG_ACCOUNT: different address" },
    });
    const res = await accept(req(), params());
    expect(res.status).toBe(403);
    await runAfterCallbacks();
    expect(mockNotify).not.toHaveBeenCalled();
  });
});

describe("POST /api/v1/me/invitations/:id/decline", () => {
  beforeEach(() => {
    mockRpc.mockResolvedValue({
      data: { invitation_id: INV_ID, organization_id: ORG_ID, already_declined: false },
      error: null,
    });
  });

  it("declines by id as the signed-in user and tells the inviter", async () => {
    const res = await decline(req(), params());
    expect(res.status).toBe(200);
    expect(mockRpc).toHaveBeenCalledWith("decline_organization_invitation_by_id", {
      p_invitation_id: INV_ID,
      p_user_id: USER_ID,
    });
    await runAfterCallbacks();
    expect(mockNotify).toHaveBeenCalledWith(INV_ID);
  });

  it("requires a session, unlike declining from the link", async () => {
    mockGetAuthClaims.mockResolvedValue(null);
    const res = await decline(req(), params());
    expect(res.status).toBe(401);
    expect(mockRpc).not.toHaveBeenCalled();
  });

  it("doesn't tell the inviter twice about a repeated decline", async () => {
    mockRpc.mockResolvedValue({
      data: { invitation_id: INV_ID, organization_id: ORG_ID, already_declined: true },
      error: null,
    });
    await decline(req(), params());
    await runAfterCallbacks();
    expect(mockNotify).not.toHaveBeenCalled();
  });
});
