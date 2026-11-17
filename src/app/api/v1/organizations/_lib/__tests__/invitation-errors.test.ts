import { describe, expect, it, vi } from "vitest";
import { invitationErrorResponse } from "../invitation-errors";

async function respond(message: string, code = "P0001") {
  const res = invitationErrorResponse({ code, message }, "testing");
  return { status: res.status, error: (await res.json()).error };
}

describe("invitationErrorResponse", () => {
  it.each([
    ["INVITATION_NOT_FOUND: no invitation for this link", "P0002", 404, "NOT_FOUND"],
    ["INVITATION_WRONG_ACCOUNT: sent to a different address", "42501", 403, "WRONG_ACCOUNT"],
    ["INVITATION_FORBIDDEN: org.invite is required", "42501", 403, "FORBIDDEN"],
    ["INVITATION_ALREADY_MEMBER: a@b.c is already a member", "23505", 409, "CONFLICT"],
    ["INVITATION_INVALID_ROLE: owner cannot be offered", "22023", 400, "VALIDATION_ERROR"],
    ["INVITATION_EXPIRED: this invitation expired at ...", "P0001", 410, "INVITATION_EXPIRED"],
    ["INVITATION_CLOSED: this invitation was revoked", "P0001", 409, "INVITATION_CLOSED"],
    ["INVITATION_ORG_UNAVAILABLE: not approved", "P0001", 403, "FORBIDDEN"],
  ])("maps %s", async (message, code, status, errorCode) => {
    const res = await respond(message, code);
    expect(res.status).toBe(status);
    expect(res.error.code).toBe(errorCode);
    // The database's wording never reaches the client.
    expect(res.error.message).not.toContain("INVITATION_");
  });

  it("treats anything else as an internal error", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const res = await respond("deadlock detected", "40P01");
    expect(res.status).toBe(500);
  });
});
