import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

// ---------------------------------------------------------------------------
// Mocks: the database, CHIP Send's GET, and the payout services the run drives.
// chipSendOutcome and chipSendAmountToCents stay real, so a state is classified
// here exactly as the webhook classifies it.
// ---------------------------------------------------------------------------

const {
  mockFrom,
  mockRpc,
  payoutQueries,
  responses,
  mockExecute,
  mockSettle,
  mockGetInstruction,
} = vi.hoisted(() => {
  // Each from("payouts") query records its filters; the stuck pass is the one
  // filtering on updated_at.
  const payoutQueries: Array<Record<string, unknown>> = [];
  const responses = {
    stuck: { data: [] as unknown, error: null as unknown },
    pending: { data: [] as unknown, error: null as unknown },
  };

  function makeBuilder() {
    const filters: Record<string, unknown> = {};
    payoutQueries.push(filters);
    const b: Record<string, unknown> = {};
    b.select = vi.fn(() => b);
    b.order = vi.fn(() => b);
    for (const m of ["eq", "is", "lt"]) {
      b[m] = vi.fn((col: string, val: unknown) => {
        filters[`${m}:${col}`] = val;
        return b;
      });
    }
    b.then = (
      onfulfilled: (v: unknown) => unknown,
      onrejected?: (r: unknown) => unknown,
    ) =>
      Promise.resolve(
        "lt:updated_at" in filters ? responses.stuck : responses.pending,
      ).then(onfulfilled, onrejected);
    return b;
  }

  return {
    payoutQueries,
    responses,
    mockFrom: vi.fn(() => makeBuilder()),
    mockRpc: vi.fn(),
    mockExecute: vi.fn(),
    mockSettle: vi.fn(),
    mockGetInstruction: vi.fn(),
  };
});

vi.mock("@/services/supabase/admin", () => ({
  supabaseAdmin: { from: mockFrom, rpc: mockRpc },
}));
vi.mock("@/services/payouts/execute", () => ({
  executePayout: mockExecute,
}));
vi.mock("@/services/payouts/settle", () => ({
  settlePayout: mockSettle,
}));
vi.mock("@/services/chip/send", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/services/chip/send")>();
  return { ...actual, getChipSendInstruction: mockGetInstruction };
});

import { POST } from "../route";
import {
  MIN_PAYOUT_CENTS,
  PAYOUT_CONCURRENCY,
  PAYOUT_HOLD_DAYS,
  PAYOUT_STUCK_HOURS,
} from "@/services/payouts/constants";

const SECRET = "test-cron-secret";

function makeReq(auth?: string) {
  return new NextRequest("http://localhost/api/v1/cron/payouts", {
    method: "POST",
    headers: auth ? { Authorization: auth } : {},
  });
}

const authed = () => POST(makeReq(`Bearer ${SECRET}`));

const ZERO = {
  sent: 0,
  paid: 0,
  failed: 0,
  awaiting_budget: 0,
  blocked: 0,
  skipped: 0,
  error: 0,
};

/** Wires the RPCs: the payable list, and queue_payout by tournament id. */
function setRpcs(
  payable: string[],
  queue: (tournamentId: string) => unknown = (id) => ({
    data: `payout-${id}`,
    error: null,
  }),
  listError: unknown = null,
) {
  mockRpc.mockImplementation(async (name: string, args: Record<string, unknown>) => {
    if (name === "list_payable_tournaments") {
      return listError
        ? { data: null, error: listError }
        : {
            data: payable.map((id) => ({ tournament_id: id, available_cents: 10000 })),
            error: null,
          };
    }
    if (name === "queue_payout") return queue(args.p_tournament_id as string);
    throw new Error(`unexpected rpc ${name}`);
  });
}

function instruction(id: number, state: string, amount = "100.00") {
  return { id, state, amount, receipt_url: `https://receipt.test/${id}` };
}

describe("POST /api/v1/cron/payouts", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    payoutQueries.length = 0;
    responses.stuck = { data: [], error: null };
    responses.pending = { data: [], error: null };
    vi.stubEnv("CRON_SECRET", SECRET);
    setRpcs([]);
    mockExecute.mockResolvedValue("sent");
    mockSettle.mockResolvedValue({ error: null, settled: true });
    vi.spyOn(console, "info").mockImplementation(() => {});
    vi.spyOn(console, "warn").mockImplementation(() => {});
    vi.spyOn(console, "error").mockImplementation(() => {});
  });
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });

  // ----- the guard ---------------------------------------------------------

  it("401s without the bearer secret", async () => {
    const res = await POST(makeReq());
    expect(res.status).toBe(401);
    expect(mockFrom).not.toHaveBeenCalled();
    expect(mockRpc).not.toHaveBeenCalled();
  });

  it("401s with a wrong secret", async () => {
    const res = await POST(makeReq("Bearer nope"));
    expect(res.status).toBe(401);
    expect(mockRpc).not.toHaveBeenCalled();
    expect(mockExecute).not.toHaveBeenCalled();
  });

  it("500s when CRON_SECRET is not configured", async () => {
    vi.stubEnv("CRON_SECRET", "");
    const res = await POST(makeReq("Bearer "));
    expect(res.status).toBe(500);
    const body = await res.json();
    expect(body.error.code).toBe("MISCONFIGURED");
    expect(mockRpc).not.toHaveBeenCalled();
  });

  // ----- the sweep ---------------------------------------------------------

  it("queues and sends the automatic payout of every payable tournament", async () => {
    setRpcs(["t1", "t2"]);
    mockExecute.mockImplementation(async (id: string) =>
      id === "payout-t1" ? "sent" : "paid",
    );

    const res = await authed();
    expect(res.status).toBe(200);
    const { data } = await res.json();

    expect(mockRpc).toHaveBeenCalledWith("list_payable_tournaments", {
      p_hold_days: PAYOUT_HOLD_DAYS,
      p_min_cents: MIN_PAYOUT_CENTS,
    });
    expect(mockRpc).toHaveBeenCalledWith("queue_payout", {
      p_tournament_id: "t1",
      p_kind: "automatic",
      p_amount_cents: null,
      p_requested_by: null,
    });
    expect(mockExecute).toHaveBeenCalledWith("payout-t1");
    expect(mockExecute).toHaveBeenCalledWith("payout-t2");
    expect(data.sweep).toEqual({ ...ZERO, swept: 2, queued: 2, sent: 1, paid: 1 });
  });

  it("counts a payout parked on budget", async () => {
    setRpcs(["t1"]);
    mockExecute.mockResolvedValue("awaiting_budget");

    const { data } = await (await authed()).json();
    expect(data.sweep).toEqual({ ...ZERO, swept: 1, queued: 1, awaiting_budget: 1 });
  });

  it("doesn't let one tournament's failure fail the run", async () => {
    setRpcs(["throws", "db-error", "refused", "ok", "execute-throws"], (id) => {
      if (id === "throws") throw new Error("connection reset");
      if (id === "db-error") return { data: null, error: { code: "08006", message: "down" } };
      if (id === "refused") {
        return { data: null, error: { code: "P0001", message: "PAYOUT_BLOCKED: refund_pending" } };
      }
      return { data: `payout-${id}`, error: null };
    });
    mockExecute.mockImplementation(async (id: string) => {
      if (id === "payout-execute-throws") throw new Error("boom");
      return "paid";
    });

    const res = await authed();
    expect(res.status).toBe(200);
    const { data } = await res.json();
    expect(data.sweep).toEqual({
      ...ZERO,
      swept: 5,
      queued: 2,
      paid: 1,
      skipped: 1, // the refusal
      error: 3, // the throw, the database error, the execute throw
    });
    expect(mockExecute).toHaveBeenCalledWith("payout-ok");
  });

  it("queues nothing on a re-run", async () => {
    // queue_payout returns NULL when a live automatic payout already exists.
    setRpcs(["t1", "t2"], () => ({ data: null, error: null }));

    const res = await authed();
    expect(res.status).toBe(200);
    const { data } = await res.json();
    expect(data.sweep).toEqual({ ...ZERO, swept: 2, queued: 0, skipped: 2 });
    expect(mockExecute).not.toHaveBeenCalled();
  });

  it(`never has more than PAYOUT_CONCURRENCY (${PAYOUT_CONCURRENCY}) payouts in flight`, async () => {
    const ids = Array.from({ length: PAYOUT_CONCURRENCY * 2 + 1 }, (_, i) => `t${i}`);
    setRpcs(ids);
    let inFlight = 0;
    let peak = 0;
    mockExecute.mockImplementation(async () => {
      inFlight++;
      peak = Math.max(peak, inFlight);
      await new Promise((resolve) => setTimeout(resolve, 1));
      inFlight--;
      return "sent";
    });

    const { data } = await (await authed()).json();
    expect(data.sweep.sent).toBe(ids.length);
    expect(peak).toBe(PAYOUT_CONCURRENCY);
  });

  // ----- stuck payouts -----------------------------------------------------

  it(`only treats a payout as stuck after ${PAYOUT_STUCK_HOURS}h processing`, async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-11-15T01:00:00Z"));
    try {
      await authed();
    } finally {
      vi.useRealTimers();
    }
    const stuck = payoutQueries.find((q) => "lt:updated_at" in q);
    expect(stuck).toMatchObject({
      "eq:status": "processing",
      "is:processed_at": null,
      "lt:updated_at": new Date(
        Date.parse("2026-11-15T01:00:00Z") - PAYOUT_STUCK_HOURS * 3_600_000,
      ).toISOString(),
    });
  });

  it("settles stuck payouts from CHIP's record of the instruction", async () => {
    responses.stuck = {
      data: [
        { id: "p-done", chip_send_instruction_id: 11 },
        { id: "p-rejected", chip_send_instruction_id: 12 },
        { id: "p-waiting", chip_send_instruction_id: 13 },
        { id: "p-unreadable", chip_send_instruction_id: 14 },
      ],
      error: null,
    };
    mockGetInstruction.mockImplementation(async (id: number) => {
      if (id === 11) return instruction(11, "completed", "250.50");
      if (id === 12) return instruction(12, "rejected");
      if (id === 13) return instruction(13, "accepted");
      throw new Error("timeout");
    });

    const res = await authed();
    expect(res.status).toBe(200);
    const { data } = await res.json();

    expect(mockSettle).toHaveBeenCalledWith({
      payoutId: "p-done",
      chipSendInstructionId: 11,
      paid: true,
      amountCents: 25050,
      receiptUrl: "https://receipt.test/11",
      failureReason: null,
    });
    expect(mockSettle).toHaveBeenCalledWith({
      payoutId: "p-rejected",
      chipSendInstructionId: 12,
      paid: false,
      amountCents: null,
      receiptUrl: null,
      failureReason: "send_instruction_rejected",
    });
    // Still under review at CHIP, or unreadable: left processing.
    expect(mockSettle).toHaveBeenCalledTimes(2);
    expect(mockExecute).not.toHaveBeenCalled();
    expect(data.stuck).toEqual({
      ...ZERO,
      checked: 4,
      paid: 1,
      failed: 1,
      sent: 1,
      error: 1,
    });
  });

  it("resumes a stuck payout that was claimed with no instruction", async () => {
    responses.stuck = {
      data: [{ id: "p-claimed", chip_send_instruction_id: null }],
      error: null,
    };
    mockExecute.mockResolvedValue("paid");

    const { data } = await (await authed()).json();
    expect(mockGetInstruction).not.toHaveBeenCalled();
    expect(mockExecute).toHaveBeenCalledWith("p-claimed");
    expect(data.stuck).toEqual({ ...ZERO, checked: 1, paid: 1 });
  });

  it("reports a stuck payout the webhook already settled as skipped", async () => {
    responses.stuck = { data: [{ id: "p1", chip_send_instruction_id: 21 }], error: null };
    mockGetInstruction.mockResolvedValue(instruction(21, "completed"));
    mockSettle.mockResolvedValue({ error: null, settled: false });

    const { data } = await (await authed()).json();
    expect(data.stuck).toEqual({ ...ZERO, checked: 1, skipped: 1 });
  });

  it("counts a failed settlement as an error and leaves the row", async () => {
    responses.stuck = { data: [{ id: "p1", chip_send_instruction_id: 22 }], error: null };
    mockGetInstruction.mockResolvedValue(instruction(22, "completed"));
    mockSettle.mockResolvedValue({ error: { code: "57014", message: "timeout" }, settled: false });

    const res = await authed();
    expect(res.status).toBe(200);
    const { data } = await res.json();
    expect(data.stuck).toEqual({ ...ZERO, checked: 1, error: 1 });
  });

  // ----- pending payouts ---------------------------------------------------

  it("retries every approved payout still pending", async () => {
    responses.pending = { data: [{ id: "p-budget" }, { id: "p-blocked" }], error: null };
    mockExecute.mockImplementation(async (id: string) =>
      id === "p-budget" ? "sent" : "blocked",
    );

    const { data } = await (await authed()).json();
    const pending = payoutQueries.find((q) => !("lt:updated_at" in q));
    expect(pending).toMatchObject({
      "eq:status": "pending",
      "eq:approval": "approved",
      "is:processed_at": null,
    });
    expect(mockExecute).toHaveBeenCalledWith("p-budget");
    expect(mockExecute).toHaveBeenCalledWith("p-blocked");
    expect(data.retried).toEqual({ ...ZERO, checked: 2, sent: 1, blocked: 1 });
  });

  it("retries pending payouts before sweeping, so a fresh one isn't retried at once", async () => {
    responses.pending = { data: [{ id: "p-old" }], error: null };
    setRpcs(["t1"]);

    await authed();
    expect(mockExecute.mock.calls.map(([id]) => id)).toEqual(["p-old", "payout-t1"]);
  });

  // ----- a pass that can't run ---------------------------------------------

  it("500s when a pass can't load its work, after running the others", async () => {
    responses.pending = { data: null, error: { code: "08006", message: "down" } };
    setRpcs(["t1"]);

    const res = await authed();
    expect(res.status).toBe(500);
    const body = await res.json();
    expect(body.error.code).toBe("INTERNAL_ERROR");
    expect(body.data.retried).toBeNull();
    expect(body.data.stuck).toEqual({ ...ZERO, checked: 0 });
    expect(body.data.sweep).toEqual({ ...ZERO, swept: 1, queued: 1, sent: 1 });
  });

  it("500s when the payable list fails", async () => {
    setRpcs([], undefined, { code: "42883", message: "no such function" });

    const res = await authed();
    expect(res.status).toBe(500);
    const body = await res.json();
    expect(body.data.sweep).toBeNull();
    expect(mockExecute).not.toHaveBeenCalled();
  });
});
