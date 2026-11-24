import { beforeEach, describe, expect, it, vi } from "vitest";

const { results, calls, mockFrom } = vi.hoisted(() => {
  const results: Record<string, { data: unknown; error: unknown }> = {};
  const calls: Array<[string, string, unknown[]]> = [];
  function makeBuilder(table: string) {
    const b: Record<string, unknown> = {};
    for (const m of ["select", "or", "order", "limit", "in"]) {
      b[m] = vi.fn((...args: unknown[]) => {
        calls.push([table, m, args]);
        return b;
      });
    }
    b.then = (
      onfulfilled: (v: unknown) => unknown,
      onrejected?: (r: unknown) => unknown,
    ) =>
      Promise.resolve(results[table] ?? { data: [], error: null }).then(
        onfulfilled,
        onrejected,
      );
    return b;
  }
  return {
    results,
    calls,
    mockFrom: vi.fn((table: string) => makeBuilder(table)),
  };
});

vi.mock("@/services/supabase/admin", () => ({
  supabaseAdmin: { from: mockFrom },
}));

import { loadBankNameReviews } from "../name-review";

const common = {
  bank_name: "Maybank",
  bank_holder_name: "SOMEONE ELSE",
  is_active: true,
  name_reviewed_at: null,
  name_review_note: null,
};

beforeEach(() => {
  vi.clearAllMocks();
  calls.length = 0;
  for (const k of Object.keys(results)) delete results[k];
});

describe("loadBankNameReviews", () => {
  it("lists both owners' accounts under review, oldest first, masked to the last 4 digits", async () => {
    results.organization_bank_accounts = {
      data: [
        {
          ...common,
          id: "org-acct",
          organization_id: "org-1",
          organization: { name: "KL Chess Club" },
          account_holder: "KL Chess Club",
          account_number: "514012345678",
          status: "name_mismatch",
          created_at: "2026-11-20T00:00:00Z",
        },
      ],
      error: null,
    };
    results.player_bank_accounts = {
      data: [
        {
          ...common,
          id: "player-acct",
          user_id: "u-1",
          user: { first_name: "Ahmad", last_name: "Ali" },
          account_holder: "Ahmad bin Ali",
          account_number: "800000000202",
          status: "name_mismatch",
          created_at: "2026-11-19T00:00:00Z",
        },
      ],
      error: null,
    };
    results.organization_registered_names = {
      data: [
        { organization_id: "org-1", registered_name: "Persatuan Catur KL" },
      ],
      error: null,
    };

    const { data, error } = await loadBankNameReviews();

    expect(error).toBeNull();
    expect(data!.pending.map((r) => r.id)).toEqual(["player-acct", "org-acct"]);
    expect(data!.pending[1]).toMatchObject({
      owner: "organization",
      owner_id: "org-1",
      owner_name: "KL Chess Club",
      expected_name: "Persatuan Catur KL",
      expected_is_registered_name: true,
      account_holder: "KL Chess Club",
      account_number_last4: "5678",
    });
    expect(data!.pending[0]).toMatchObject({
      owner: "player",
      owner_name: "Ahmad Ali",
      expected_name: "Ahmad bin Ali",
      expected_is_registered_name: false,
    });
    expect(JSON.stringify(data)).not.toContain("514012345678");
    expect(calls).toContainEqual([
      "organization_bank_accounts",
      "or",
      [
        "and(status.eq.name_mismatch,is_active.is.true),name_reviewed_at.not.is.null",
      ],
    ]);
  });

  it("falls back to the submitted holder for an organization with no registered name", async () => {
    results.organization_bank_accounts = {
      data: [
        {
          ...common,
          id: "org-acct",
          organization_id: "org-1",
          organization: null,
          account_holder: "KL Chess Club",
          account_number: "514012345678",
          status: "name_mismatch",
          created_at: "2026-11-20T00:00:00Z",
        },
      ],
      error: null,
    };

    const { data } = await loadBankNameReviews();

    expect(data!.pending[0]).toMatchObject({
      owner_name: "Deleted organization",
      expected_name: "KL Chess Club",
      expected_is_registered_name: false,
    });
  });

  it("leaves a superseded account off the queue, so an owner has one review at most", async () => {
    results.organization_bank_accounts = {
      data: [
        {
          ...common,
          id: "replaced",
          organization_id: "org-1",
          organization: { name: "KL Chess Club" },
          account_holder: "KL Chess Club",
          account_number: "514012345678",
          status: "name_mismatch",
          is_active: false,
          created_at: "2026-11-19T00:00:00Z",
        },
        {
          ...common,
          id: "current",
          organization_id: "org-1",
          organization: { name: "KL Chess Club" },
          account_holder: "KL Chess Club",
          account_number: "514012345679",
          status: "name_mismatch",
          created_at: "2026-11-20T00:00:00Z",
        },
      ],
      error: null,
    };

    const { data } = await loadBankNameReviews();

    expect(data!.pending.map((r) => r.id)).toEqual(["current"]);
  });

  it("lists decided accounts newest decision first", async () => {
    results.player_bank_accounts = {
      data: [
        {
          ...common,
          id: "older",
          user_id: "u-1",
          user: null,
          account_holder: "A",
          account_number: "800000000201",
          status: "verified",
          created_at: "2026-11-19T00:00:00Z",
          name_reviewed_at: "2026-11-20T00:00:00Z",
          name_review_note: "ok",
        },
        {
          ...common,
          id: "newer",
          user_id: "u-2",
          user: null,
          account_holder: "B",
          account_number: "800000000202",
          status: "rejected",
          created_at: "2026-11-18T00:00:00Z",
          name_reviewed_at: "2026-11-21T00:00:00Z",
          name_review_note: "not theirs",
        },
      ],
      error: null,
    };

    const { data } = await loadBankNameReviews();

    expect(data!.pending).toEqual([]);
    expect(data!.decided.map((r) => r.id)).toEqual(["newer", "older"]);
    expect(data!.decided[0].owner_name).toBe("Deleted account");
  });

  it("returns the error when a table can't be read", async () => {
    results.player_bank_accounts = {
      data: null,
      error: { message: "db down" },
    };
    await expect(loadBankNameReviews()).resolves.toEqual({
      data: null,
      error: "db down",
    });
  });
});
