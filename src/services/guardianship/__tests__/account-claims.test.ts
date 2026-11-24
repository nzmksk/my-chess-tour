import { beforeEach, describe, expect, it, vi } from "vitest";

const { mockFrom, tables } = vi.hoisted(() => {
  const tables: Record<string, Array<{ data: unknown; error: unknown }>> = {};
  function makeBuilder(table: string) {
    const b: Record<string, unknown> = {};
    for (const m of ["select", "eq", "maybeSingle"]) {
      b[m] = vi.fn(() => b);
    }
    b.then = (
      onfulfilled: (v: unknown) => unknown,
      onrejected?: (r: unknown) => unknown,
    ) =>
      Promise.resolve(
        tables[table]?.shift() ?? { data: null, error: null },
      ).then(onfulfilled, onrejected);
    return b;
  }
  return {
    tables,
    mockFrom: vi.fn((table: string) => makeBuilder(table)),
  };
});

vi.mock("@/services/supabase/admin", () => ({
  supabaseAdmin: { from: mockFrom },
}));

import {
  accountClaimErrorResponse,
  accountClaimUrl,
  getAccountClaimByToken,
} from "../account-claims";
import { hashInvitationToken } from "@/services/organizations/invitations";

const TOKEN = "a".repeat(43);
const NOW = new Date("2026-11-24T12:00:00Z");

function claimRow(overrides: Record<string, unknown> = {}) {
  return {
    status: "pending",
    email: "ada@example.com",
    expires_at: "2026-11-27T12:00:00Z",
    guardian_user_id: "g-1",
    dependent_user_id: "d-1",
    dependent: {
      first_name: "Ada",
      last_name: "Adult",
      account_type: "managed",
    },
    guardian: { first_name: "Gwen", last_name: "Guardian" },
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  for (const k of Object.keys(tables)) delete tables[k];
});

describe("getAccountClaimByToken", () => {
  it("reads a live claim by the token's hash", async () => {
    tables.account_claims = [{ data: claimRow(), error: null }];
    tables.guardianships = [{ data: { id: "gs-1" }, error: null }];

    expect(await getAccountClaimByToken(TOKEN, NOW)).toEqual({
      tokenHash: hashInvitationToken(TOKEN),
      state: "pending",
      email: "ada@example.com",
      expiresAt: "2026-11-27T12:00:00Z",
      playerFirstName: "Ada",
      playerLastName: "Adult",
      guardianName: "Gwen Guardian",
    });
  });

  it.each([
    ["expired", { expires_at: "2026-11-24T11:00:00Z" }],
    ["accepted", { status: "accepted" }],
    ["closed", { status: "cancelled" }],
  ])("reports a %s claim", async (state, overrides) => {
    tables.account_claims = [{ data: claimRow(overrides), error: null }];
    expect((await getAccountClaimByToken(TOKEN, NOW))?.state).toBe(state);
  });

  it("closes a claim whose guardian no longer acts for the player", async () => {
    tables.account_claims = [{ data: claimRow(), error: null }];
    tables.guardianships = [{ data: null, error: null }];
    expect((await getAccountClaimByToken(TOKEN, NOW))?.state).toBe("closed");
  });

  it("closes a claim for a record that already has a login", async () => {
    tables.account_claims = [
      {
        data: claimRow({
          dependent: {
            first_name: "Ada",
            last_name: "Adult",
            account_type: "self",
          },
        }),
        error: null,
      },
    ];
    tables.guardianships = [{ data: { id: "gs-1" }, error: null }];
    expect((await getAccountClaimByToken(TOKEN, NOW))?.state).toBe("closed");
  });

  it("returns null for a malformed or unknown token, without a lookup for malformed", async () => {
    expect(await getAccountClaimByToken("short", NOW)).toBeNull();
    expect(mockFrom).not.toHaveBeenCalled();
    tables.account_claims = [{ data: null, error: null }];
    expect(await getAccountClaimByToken(TOKEN, NOW)).toBeNull();
  });

  it("throws when the lookup fails", async () => {
    tables.account_claims = [{ data: null, error: { message: "db down" } }];
    await expect(getAccountClaimByToken(TOKEN, NOW)).rejects.toThrow(/db down/);
  });
});

describe("accountClaimErrorResponse", () => {
  it.each([
    ["DEPENDENT_NOT_FOUND: x", 404, "NOT_FOUND"],
    ["EMAIL_TAKEN: x", 409, "EMAIL_TAKEN"],
    ["UNDER_18: x", 422, "UNDER_18"],
    ["CLAIM_NOT_ALLOWED: x", 422, "CLAIM_NOT_ALLOWED"],
    ["INVALID_EMAIL: x", 400, "VALIDATION_ERROR"],
    ["handle_new_user failed: CLAIM_INVALID: x", 410, "CLAIM_CLOSED"],
    ["CLAIM_EMAIL_MISMATCH: x", 410, "CLAIM_CLOSED"],
  ])("maps %s to %i", async (message, status, code) => {
    const res = accountClaimErrorResponse({ message }, "testing");
    expect(res.status).toBe(status);
    expect((await res.json()).error.code).toBe(code);
  });

  it("sends a taken address to support", async () => {
    const res = accountClaimErrorResponse(
      { message: "EMAIL_TAKEN: x" },
      "testing",
    );
    expect((await res.json()).error.message).toMatch(
      /contact support@mychesstour\.com/,
    );
  });

  it("500s on anything else without leaking it", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const res = accountClaimErrorResponse({ message: "boom" }, "testing");
    expect(res.status).toBe(500);
    expect(JSON.stringify(await res.json())).not.toContain("boom");
  });
});

describe("accountClaimUrl", () => {
  it("points at the claim page", () => {
    expect(accountClaimUrl(TOKEN)).toMatch(new RegExp(`/claim/${TOKEN}$`));
  });
});
