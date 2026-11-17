import { beforeEach, describe, expect, it, vi } from "vitest";

const { mockFrom, result, builder, queue } = vi.hoisted(() => {
  const result: { data: unknown; error: unknown } = { data: null, error: null };
  // When non-empty, each awaited query takes the next result from here instead.
  const queue: Array<{ data: unknown; error: unknown }> = [];
  const builder: Record<string, unknown> = {};
  for (const m of ["select", "eq", "is", "gt", "order", "maybeSingle"]) {
    builder[m] = vi.fn(() => builder);
  }
  builder.then = (
    onfulfilled: (v: unknown) => unknown,
    onrejected?: (r: unknown) => unknown,
  ) => Promise.resolve(queue.shift() ?? result).then(onfulfilled, onrejected);
  return { mockFrom: vi.fn(() => builder), result, builder, queue };
});

vi.mock("@/services/supabase/admin", () => ({
  supabaseAdmin: { from: mockFrom },
}));

import {
  daysUntil,
  generateInvitationToken,
  getInvitationByToken,
  hashInvitationToken,
  INVITATION_TOKEN_RE,
  invitationState,
  invitationUrl,
  listInvitationsForUser,
} from "../invitations";

const TOKEN = "a".repeat(43);
const FUTURE = new Date(Date.now() + 86_400_000).toISOString();
const PAST = new Date(Date.now() - 1000).toISOString();

function givenRow(overrides: Record<string, unknown> = {}) {
  result.data = {
    id: "inv-1",
    email: "farid@example.com",
    status: "pending",
    expires_at: FUTURE,
    roles: { name: "admin" },
    organizations: {
      id: "org-1",
      name: "KL Chess Club",
      approval_status: "approved",
      deleted_at: null,
    },
    inviter: { first_name: "Aisha", last_name: "Rahman" },
    ...overrides,
  };
  result.error = null;
}

beforeEach(() => {
  vi.clearAllMocks();
  result.data = null;
  result.error = null;
  queue.length = 0;
});

describe("invitation tokens", () => {
  it("generates 43-character url-safe tokens that differ each time", () => {
    const a = generateInvitationToken();
    const b = generateInvitationToken();
    expect(a).toMatch(INVITATION_TOKEN_RE);
    expect(b).toMatch(INVITATION_TOKEN_RE);
    expect(a).not.toBe(b);
  });

  it("hashes to the SHA-256 hex the database stores", () => {
    // sha256("abc")
    expect(hashInvitationToken("abc")).toBe(
      "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad",
    );
  });

  it("links to the invitation page", () => {
    expect(invitationUrl(TOKEN)).toMatch(new RegExp(`/invitations/${TOKEN}$`));
  });
});

describe("invitationState", () => {
  it("reads a pending invitation past its expiry as expired", () => {
    expect(invitationState("pending", PAST)).toBe("expired");
    expect(invitationState("pending", FUTURE)).toBe("pending");
  });

  it("keeps a closed invitation's status after expiry", () => {
    expect(invitationState("accepted", PAST)).toBe("accepted");
    expect(invitationState("revoked", PAST)).toBe("revoked");
  });
});

describe("daysUntil", () => {
  const now = new Date("2026-11-17T00:00:00Z");

  it("rounds part of a day up", () => {
    expect(daysUntil("2026-12-17T00:00:00Z", now)).toBe(30);
    expect(daysUntil("2026-11-17T01:00:00Z", now)).toBe(1);
  });

  it("is 0 once expired", () => {
    expect(daysUntil("2026-11-16T00:00:00Z", now)).toBe(0);
  });
});

describe("getInvitationByToken", () => {
  it("looks the invitation up by the token's hash", async () => {
    givenRow();
    const view = await getInvitationByToken(TOKEN);

    expect(builder.eq).toHaveBeenCalledWith("token_hash", hashInvitationToken(TOKEN));
    expect(view).toEqual({
      id: "inv-1",
      email: "farid@example.com",
      role: "admin",
      state: "pending",
      expiresAt: FUTURE,
      daysLeft: 1,
      organization: { id: "org-1", name: "KL Chess Club", available: true },
      inviterName: "Aisha Rahman",
    });
  });

  it("never queries for a malformed token", async () => {
    expect(await getInvitationByToken("not-a-token")).toBeNull();
    expect(mockFrom).not.toHaveBeenCalled();
  });

  it("returns null when nothing matches", async () => {
    expect(await getInvitationByToken(TOKEN)).toBeNull();
  });

  it("marks an expired invitation and an unavailable organization", async () => {
    givenRow({
      expires_at: PAST,
      organizations: {
        id: "org-1",
        name: "KL Chess Club",
        approval_status: "approved",
        deleted_at: "2026-01-01T00:00:00Z",
      },
    });
    const view = await getInvitationByToken(TOKEN);
    expect(view?.state).toBe("expired");
    expect(view?.organization.available).toBe(false);
  });

  it("throws on a database error", async () => {
    result.error = { message: "boom" };
    await expect(getInvitationByToken(TOKEN)).rejects.toThrow(/boom/);
  });
});

describe("listInvitationsForUser", () => {
  const row = (overrides: Record<string, unknown> = {}) => ({
    id: "inv-1",
    email: "farid@example.com",
    status: "pending",
    expires_at: FUTURE,
    roles: { name: "member" },
    organizations: {
      id: "org-1",
      name: "KL Chess Club",
      approval_status: "approved",
      deleted_at: null,
    },
    inviter: { first_name: "Aisha", last_name: null },
    ...overrides,
  });

  it("lists the open invitations addressed to the user's email", async () => {
    queue.push(
      { data: { email: "Farid@Example.com" }, error: null },
      { data: [row()], error: null },
    );
    const list = await listInvitationsForUser("user-1");

    expect(builder.eq).toHaveBeenCalledWith("id", "user-1");
    expect(builder.eq).toHaveBeenCalledWith("email", "farid@example.com");
    expect(builder.eq).toHaveBeenCalledWith("status", "pending");
    expect(builder.gt).toHaveBeenCalledWith("expires_at", expect.any(String));
    expect(list).toHaveLength(1);
    expect(list[0]).toMatchObject({ id: "inv-1", role: "member", inviterName: "Aisha" });
  });

  it("leaves out organizations that can't take members", async () => {
    queue.push(
      { data: { email: "farid@example.com" }, error: null },
      {
        data: [
          row(),
          row({
            id: "inv-2",
            organizations: {
              id: "org-2",
              name: "Gone",
              approval_status: "approved",
              deleted_at: "2026-01-01T00:00:00Z",
            },
          }),
        ],
        error: null,
      },
    );
    const list = await listInvitationsForUser("user-1");
    expect(list.map((i) => i.id)).toEqual(["inv-1"]);
  });

  it("is empty for an account with no email on file", async () => {
    queue.push({ data: null, error: null });
    expect(await listInvitationsForUser("user-1")).toEqual([]);
    expect(mockFrom).toHaveBeenCalledTimes(1);
  });

  it("throws on a database error", async () => {
    queue.push(
      { data: { email: "farid@example.com" }, error: null },
      { data: null, error: { message: "boom" } },
    );
    await expect(listInvitationsForUser("user-1")).rejects.toThrow(/boom/);
  });
});
