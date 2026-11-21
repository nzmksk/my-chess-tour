import { beforeEach, describe, expect, it, vi } from "vitest";

const { results, calls, mockFrom } = vi.hoisted(() => {
  const results: Array<{ data: unknown; error: unknown }> = [];
  const calls: Array<{ table: string; ops: Array<[string, ...unknown[]]> }> = [];
  function makeBuilder(table: string) {
    const call = { table, ops: [] as Array<[string, ...unknown[]]> };
    calls.push(call);
    const b: Record<string, unknown> = {};
    for (const m of ["select", "eq", "neq", "is", "in", "or", "order", "limit"]) {
      b[m] = vi.fn((...args: unknown[]) => {
        call.ops.push([m, ...args]);
        return b;
      });
    }
    b.then = (onfulfilled: (v: unknown) => unknown, onrejected?: (r: unknown) => unknown) =>
      Promise.resolve(results.shift() ?? { data: [], error: null }).then(onfulfilled, onrejected);
    return b;
  }
  return { results, calls, mockFrom: vi.fn((table: string) => makeBuilder(table)) };
});

vi.mock("@/services/supabase/admin", () => ({ supabaseAdmin: { from: mockFrom } }));

import { canRetryAward, listAdminAwards, listTournamentAwards } from "../awards";

function row(overrides: Record<string, unknown> = {}) {
  return {
    id: "a1",
    tournament_id: "t1",
    user_id: "u1",
    category: "Open",
    place: "1",
    amount_cents: 30000,
    settled_amount_cents: null,
    approval: "pending",
    status: "pending",
    rejection_reason: null,
    failure_reason: null,
    chip_receipt_url: null,
    entered_at: "2026-11-18T00:00:00Z",
    reviewed_at: null,
    processed_at: null,
    tournament: { name: "KL Open", organization: { name: "Chess Club" } },
    winner: { first_name: "Aina", last_name: "Rahman" },
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  results.length = 0;
  calls.length = 0;
});

describe("listTournamentAwards", () => {
  it("shapes rows with names and each winner's active bank status", async () => {
    results.push(
      {
        data: [
          row(),
          row({ id: "a2", user_id: "u2", winner: { first_name: "Ben", last_name: null } }),
          row({ id: "a3", user_id: "u1", place: null }),
        ],
        error: null,
      },
      { data: [{ user_id: "u1", status: "verified" }], error: null },
    );

    const result = await listTournamentAwards("t1");

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.awards.map((a) => [a.id, a.winner_name, a.winner_bank_status])).toEqual([
      ["a1", "Aina Rahman", "verified"],
      ["a2", "Ben", null],
      ["a3", "Aina Rahman", "verified"],
    ]);
    expect(result.awards[0]).toMatchObject({ tournament_name: "KL Open", organization_name: "Chess Club" });
    expect(result.awards[0]).not.toHaveProperty("tournament");
    expect(result.awards[0]).not.toHaveProperty("winner");

    expect(calls[0].table).toBe("prize_awards");
    expect(calls[0].ops).toContainEqual(["eq", "tournament_id", "t1"]);
    expect(calls[1].table).toBe("player_bank_accounts");
    expect(calls[1].ops).toContainEqual(["in", "user_id", ["u1", "u2"]]);
    expect(calls[1].ops).toContainEqual(["eq", "is_active", true]);
  });

  it("names a deleted winner and skips the bank lookup when nobody has an account id", async () => {
    results.push({
      data: [row({ user_id: null, winner: null, tournament: { name: null, organization: null } })],
      error: null,
    });

    const result = await listTournamentAwards("t1");

    expect(result).toEqual({
      ok: true,
      awards: [
        expect.objectContaining({
          winner_name: "Deleted account",
          winner_bank_status: null,
          tournament_name: null,
          organization_name: null,
        }),
      ],
    });
    expect(calls).toHaveLength(1);
  });

  it("treats a missing tournament join and null data as empty", async () => {
    results.push({ data: [row({ tournament: null, winner: { first_name: null, last_name: null } })], error: null });
    results.push({ data: null, error: null });

    const result = await listTournamentAwards("t1");

    expect(result.ok && result.awards[0]).toMatchObject({
      tournament_name: null,
      organization_name: null,
      winner_name: "Deleted account",
      winner_bank_status: null,
    });

    results.push({ data: null, error: null });
    expect(await listTournamentAwards("t1")).toEqual({ ok: true, awards: [] });
  });

  it("reports a failed award query", async () => {
    results.push({ data: null, error: { code: "57014", message: "timeout" } });
    expect(await listTournamentAwards("t1")).toEqual({
      ok: false,
      error: { code: "57014", message: "timeout" },
    });
  });

  it("reports a failed bank lookup", async () => {
    results.push({ data: [row()], error: null }, { data: null, error: { code: "XX000", message: "down" } });
    expect(await listTournamentAwards("t1")).toEqual({
      ok: false,
      error: { code: "XX000", message: "down" },
    });
  });
});

describe("listAdminAwards", () => {
  it("puts open awards before recent closed ones", async () => {
    results.push(
      { data: [row({ id: "open" })], error: null },
      { data: [row({ id: "done", approval: "approved", status: "paid" })], error: null },
      { data: [], error: null },
    );

    const result = await listAdminAwards();

    expect(result.ok && result.awards.map((a) => a.id)).toEqual(["open", "done"]);
    expect(calls[0].ops).toContainEqual(["neq", "approval", "rejected"]);
    expect(calls[0].ops).toContainEqual(["is", "processed_at", null]);
    expect(calls[1].ops).toContainEqual(["or", "processed_at.not.is.null,approval.eq.rejected"]);
    expect(calls[1].ops).toContainEqual(["limit", 50]);
  });

  it("copes with null data from both queries", async () => {
    results.push({ data: null, error: null }, { data: null, error: null });
    expect(await listAdminAwards()).toEqual({ ok: true, awards: [] });
  });

  it("reports either query failing", async () => {
    results.push({ data: null, error: { message: "open failed" } }, { data: [], error: null });
    expect(await listAdminAwards()).toEqual({ ok: false, error: { code: undefined, message: "open failed" } });

    results.push({ data: [], error: null }, { data: null, error: { code: "1", message: "recent failed" } });
    expect(await listAdminAwards()).toEqual({ ok: false, error: { code: "1", message: "recent failed" } });
  });
});

describe("canRetryAward", () => {
  const base = { approval: "approved", status: "pending", processed_at: null };

  it.each([
    ["an approved pending award", base, true],
    ["a claim with no instruction", { ...base, status: "processing", chip_send_instruction_id: null }, true],
    ["a claim with no instruction field", { ...base, status: "processing" }, true],
    ["a send already with CHIP", { ...base, status: "processing", chip_send_instruction_id: 9 }, false],
    ["an award awaiting review", { ...base, approval: "pending" }, false],
    ["a rejected award", { ...base, approval: "rejected" }, false],
    ["a settled award", { ...base, processed_at: "2026-11-18T00:00:00Z" }, false],
    ["a failed award", { ...base, status: "failed" }, false],
  ])("%s → %s", (_label, award, expected) => {
    expect(canRetryAward(award)).toBe(expected);
  });
});
