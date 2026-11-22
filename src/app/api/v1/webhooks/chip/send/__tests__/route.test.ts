import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import crypto from "node:crypto";

const {
  mockFrom,
  lookups,
  mockSettle,
  mockSettlePayout,
  mockSettleAward,
  mockOnPlayerVerdict,
  eqCalls,
} = vi.hoisted(() => {
  const lookups: Array<{ data: unknown; error: unknown }> = [];
  const eqCalls: Array<[string, unknown]> = [];

  function makeBuilder() {
    const b: Record<string, unknown> = {};
    for (const m of ["select", "order", "limit", "maybeSingle"]) {
      b[m] = vi.fn(() => b);
    }
    b.eq = vi.fn((col: string, val: unknown) => {
      eqCalls.push([col, val]);
      return b;
    });
    b.then = (
      onfulfilled: (v: unknown) => unknown,
      onrejected?: (r: unknown) => unknown,
    ) =>
      Promise.resolve(lookups.shift() ?? { data: null, error: null }).then(
        onfulfilled,
        onrejected,
      );
    return b;
  }

  return {
    lookups,
    eqCalls,
    mockFrom: vi.fn(() => makeBuilder()),
    mockSettle: vi.fn(),
    mockSettlePayout: vi.fn(),
    mockSettleAward: vi.fn(),
    mockOnPlayerVerdict: vi.fn(),
  };
});

vi.mock("@/services/supabase/admin", () => ({
  supabaseAdmin: { from: mockFrom },
}));

vi.mock("@/services/payouts/bank-account", () => ({
  settleBankAccountVerification: mockSettle,
}));

vi.mock("@/services/payouts/settle", () => ({
  settlePayout: mockSettlePayout,
}));

vi.mock("@/services/prizes/settle", () => ({
  settlePrizeAward: mockSettleAward,
}));

vi.mock("@/services/prizes/execute", () => ({
  onPlayerBankVerdict: mockOnPlayerVerdict,
}));

import { POST } from "../route";
import { runAfterCallbacks } from "@/test/after";

const BANK_ID = "22222222-2222-4222-8222-222222222222";

function rsaKeyPair() {
  return crypto.generateKeyPairSync("rsa", {
    modulusLength: 2048,
    publicKeyEncoding: { type: "spki", format: "pem" },
    privateKeyEncoding: { type: "pkcs8", format: "pem" },
  });
}

const { publicKey, privateKey } = rsaKeyPair();

function sign(body: string, key: string = privateKey, algorithm = "sha512"): string {
  return crypto.sign(algorithm, Buffer.from(body), key).toString("base64");
}

const BANK_EVENT = "bank_account_status";
const SEND_EVENT = "send_instruction_status";

function makeRequest(
  payload: unknown,
  signature?: string | null,
  eventType?: string,
) {
  const body = typeof payload === "string" ? payload : JSON.stringify(payload);
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  const sig = signature === undefined ? sign(body) : signature;
  if (sig !== null) headers["x-signature"] = sig;
  if (eventType) headers["event-type"] = eventType;
  return new NextRequest("http://localhost/api/v1/webhooks/chip/send", {
    method: "POST",
    headers,
    body,
  });
}

const bankRequest = (payload: unknown, signature?: string | null) =>
  makeRequest(payload, signature, BANK_EVENT);

const sendRequest = (payload: unknown, signature?: string | null) =>
  makeRequest(payload, signature, SEND_EVENT);

const PAYOUT_ID = "33333333-3333-4333-8333-333333333333";

const CHIP_FIXTURE = {
  signature:
    "pSorKUKouXdoUgspzqDTtIGxl/b7dQbH04UV569sO1vCwTqmDyDhKGHOE4BuXck9HBLiLQVivDFZHcrVUv6OVQJa2GPO2ULghL9aL2KptqjKTd8Gl/G4TwGWzmwdm15WxzzunyBxXLuNxdyPYRCrja68ztNPXnkvno+AenVZVoKheAlGNDqmJd5E3Pztk38BKrDBTPkpU3YMKNvdEjH1qEOr53tBl9xGGf10MA2XxmeYZi8fKnd4J6xvOxBA/zEgXUr5BFZXvNAvMzxDkFk4CpLKjmNn15YkrLBS3yQ+SJOK5sNFboUsrJ9hGZhG36DJfIPfuAPXWU+7XrQSrhQDlA==",
  publicKey: [
    "-----BEGIN PUBLIC KEY-----",
    "MIIBIjANBgkqhkiG9w0BAQEFAAOCAQ8AMIIBCgKCAQEAszvfKDOe2l/LVUJ9C2gJ",
    "hY6XK+OsGmpAcHGJKgBe1qckTcj58Z5jNjY+SaljWWeZGl9UV0Kk/uUZRpGWUC39",
    "H75TSb3hu9tfacHhrw2kRoKzNefil4/Exx5fyggqHH8m51QItfcoUqaMR6tA7hxv",
    "u4tbX92EmRxEuYMAnVkfri3kssd6STv0o6LkD7qg1FJ3H23YbUpPvgpvxkY8KZS9",
    "rJ5xmo3VHXb4yPjrNVF/sMRssg7Gc+uPjTFISvT+W86tPWhbp2+s1eV8bwaiN0Rg",
    "rHSOiXTpO9+H4biUfp9kbluobtFB1vPNOnYgCDdr1uApuU5KeqEupEbvxYkpXS4h",
    "AQIDAQAB",
    "-----END PUBLIC KEY-----",
  ].join("\n"),
  body: JSON.stringify(
    {
      id: 1042,
      status: "verified",
      account_number: "1234567890",
      bank_code: "MBBEMYKL",
      group_id: 17,
      name: "ACME TRADING SDN BHD",
      reference: "payroll-main",
      created_at: "2026-11-11T02:14:07.512Z",
      is_debiting_account: false,
      is_crediting_account: false,
      updated_at: "2026-11-11T02:14:09.884Z",
      deleted_at: null,
      rejection_reason: null,
    },
    null,
    2,
  ),
};

const completedEvent = {
  id: 8,
  reference: PAYOUT_ID,
  state: "completed",
  amount: "99.50",
  receipt_url: "https://chip.test/r/8",
};

const verifiedEvent = {
  id: 84,
  account_number: "1234567890",
  bank_code: "MBBEMYKL",
  reference: BANK_ID,
  status: "verified",
  rejection_reason: null,
  name: "KL CHESS CLUB",
};

beforeEach(() => {
  vi.clearAllMocks();
  lookups.length = 0;
  eqCalls.length = 0;
  vi.stubEnv("CHIP_SEND_WEBHOOK_PUBLIC_KEY", publicKey);
  mockSettle.mockResolvedValue({ error: null, settled: true });
  mockSettlePayout.mockResolvedValue({ error: null, settled: true });
  mockSettleAward.mockResolvedValue({ error: null, settled: true });
  vi.spyOn(console, "warn").mockImplementation(() => {});
  vi.spyOn(console, "error").mockImplementation(() => {});
  vi.spyOn(console, "info").mockImplementation(() => {});
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("signature verification", () => {
  it("processes a validly signed delivery", async () => {
    lookups.push({ data: { id: BANK_ID }, error: null });
    const res = await POST(bankRequest(verifiedEvent));
    expect(res.status).toBe(200);
    expect(mockSettle).toHaveBeenCalledWith({
      bankAccountId: BANK_ID,
      chipBankAccountId: 84,
      verified: true,
      reason: null,
      bankHolderName: "KL CHESS CLUB",
    });
  });

  it("returns 200 WITHOUT processing on a bad signature (not 401)", async () => {
    const res = await POST(bankRequest(verifiedEvent, sign("other body")));
    expect(res.status).toBe(200);
    expect(mockFrom).not.toHaveBeenCalled();
    expect(mockSettle).not.toHaveBeenCalled();
    expect(console.warn).toHaveBeenCalled();
  });

  it("verifies CHIP's published fixture", async () => {
    lookups.push({ data: { id: BANK_ID }, error: null });
    vi.stubEnv("CHIP_SEND_WEBHOOK_PUBLIC_KEY", CHIP_FIXTURE.publicKey);
    const res = await POST(makeRequest(CHIP_FIXTURE.body, CHIP_FIXTURE.signature));
    expect(res.status).toBe(200);
    expect(eqCalls[0]).toEqual(["chip_bank_account_id", 1042]);
    expect(mockSettle).toHaveBeenCalledWith(
      expect.objectContaining({ chipBankAccountId: 1042, verified: true }),
    );
  });

  it("rejects CHIP's fixture with one byte changed", async () => {
    vi.stubEnv("CHIP_SEND_WEBHOOK_PUBLIC_KEY", CHIP_FIXTURE.publicKey);
    const tampered = CHIP_FIXTURE.body.replace('"verified"', '"rejected"');
    const res = await POST(makeRequest(tampered, CHIP_FIXTURE.signature));
    expect(res.status).toBe(200);
    expect(mockSettle).not.toHaveBeenCalled();
  });

  it("rejects a signature from a different key (e.g. another webhook's)", async () => {
    const body = JSON.stringify(verifiedEvent);
    const other = rsaKeyPair();
    const res = await POST(makeRequest(body, sign(body, other.privateKey)));
    expect(res.status).toBe(200);
    expect(mockSettle).not.toHaveBeenCalled();
  });

  it("rejects a Collect-style RSA-SHA256 signature", async () => {
    const body = JSON.stringify(verifiedEvent);
    const res = await POST(makeRequest(body, sign(body, privateKey, "sha256")));
    expect(res.status).toBe(200);
    expect(mockSettle).not.toHaveBeenCalled();
  });

  it("rejects a hex HMAC-SHA512 signature (the scheme CHIP does NOT use)", async () => {
    const body = JSON.stringify(verifiedEvent);
    const hmac = crypto.createHmac("sha512", "any-secret").update(body).digest("hex");
    const res = await POST(makeRequest(body, hmac));
    expect(res.status).toBe(200);
    expect(mockSettle).not.toHaveBeenCalled();
  });

  it.each([
    ["missing", null],
    ["empty", ""],
    ["too short", "abcd"],
    ["not base64", "not base64!"],
    ["valid base64, wrong length", Buffer.from("abcd").toString("base64")],
  ])("a %s header does not throw and is ignored", async (_label, sig) => {
    const res = await POST(bankRequest(verifiedEvent, sig));
    expect(res.status).toBe(200);
    expect(mockSettle).not.toHaveBeenCalled();
  });

  it("signs the raw bytes: re-serialised JSON does not verify", async () => {
    const body = JSON.stringify(verifiedEvent);
    const reformatted = JSON.stringify(verifiedEvent, null, 2);
    const res = await POST(makeRequest(reformatted, sign(body)));
    expect(res.status).toBe(200);
    expect(mockSettle).not.toHaveBeenCalled();
  });

  it("accepts a key stored quoted with literal \\n (Netlify-style)", async () => {
    lookups.push({ data: { id: BANK_ID }, error: null });
    vi.stubEnv(
      "CHIP_SEND_WEBHOOK_PUBLIC_KEY",
      `"${publicKey.trim().replace(/\n/g, "\\n")}"`,
    );
    const res = await POST(bankRequest(verifiedEvent));
    expect(res.status).toBe(200);
    expect(mockSettle).toHaveBeenCalled();
  });

  it("returns 500 when the public key is not configured, so CHIP retries", async () => {
    vi.stubEnv("CHIP_SEND_WEBHOOK_PUBLIC_KEY", "");
    const res = await POST(bankRequest(verifiedEvent));
    expect(res.status).toBe(500);
    expect(mockSettle).not.toHaveBeenCalled();
  });

  it("returns 500 when the public key is not a valid PEM, so CHIP retries", async () => {
    vi.stubEnv(
      "CHIP_SEND_WEBHOOK_PUBLIC_KEY",
      "-----BEGIN PUBLIC KEY-----\nnope\n-----END PUBLIC KEY-----",
    );
    const res = await POST(bankRequest(verifiedEvent));
    expect(res.status).toBe(500);
    expect(mockSettle).not.toHaveBeenCalled();
    expect(console.error).toHaveBeenCalled();
  });
});

describe("bank account events", () => {
  it("correlates on reference first", async () => {
    lookups.push({ data: { id: BANK_ID }, error: null });
    await POST(bankRequest(verifiedEvent));
    expect(eqCalls[0]).toEqual(["id", BANK_ID]);
    expect(mockFrom).toHaveBeenCalledTimes(1);
  });

  it("falls back to chip_bank_account_id when reference is unknown", async () => {
    lookups.push({ data: null, error: null });
    lookups.push({ data: null, error: null });
    lookups.push({ data: { id: BANK_ID }, error: null });
    await POST(bankRequest(verifiedEvent));
    expect(eqCalls[2]).toEqual(["chip_bank_account_id", 84]);
    expect(mockSettle).toHaveBeenCalledWith(
      expect.objectContaining({ bankAccountId: BANK_ID }),
    );
  });

  it("finds a player's prize account by reference before any chip id (#523)", async () => {
    lookups.push({ data: null, error: null });
    lookups.push({ data: { id: BANK_ID }, error: null });
    await POST(bankRequest(verifiedEvent));
    expect(mockFrom.mock.calls.map((c) => (c as unknown[])[0])).toEqual([
      "organization_bank_accounts",
      "player_bank_accounts",
    ]);
    expect(eqCalls).toEqual([
      ["id", BANK_ID],
      ["id", BANK_ID],
    ]);
    expect(mockSettle).toHaveBeenCalledWith(
      expect.objectContaining({ bankAccountId: BANK_ID, verified: true }),
    );
  });

  it("falls back to chip id when reference is not one of ours", async () => {
    lookups.push({ data: { id: BANK_ID }, error: null });
    await POST(bankRequest({ ...verifiedEvent, reference: "VENDOR-001" }));
    expect(eqCalls[0]).toEqual(["chip_bank_account_id", 84]);
    expect(mockSettle).toHaveBeenCalled();
  });

  it("settles a rejection with CHIP's reason", async () => {
    lookups.push({ data: { id: BANK_ID }, error: null });
    await POST(
      bankRequest({
        id: 84,
        reference: BANK_ID,
        status: "rejected",
        rejection_reason: "Account closed",
      }),
    );
    expect(mockSettle).toHaveBeenCalledWith({
      bankAccountId: BANK_ID,
      chipBankAccountId: 84,
      verified: false,
      reason: "Account closed",
      bankHolderName: null,
    });
  });

  it("ignores a holder name that isn't a string", async () => {
    lookups.push({ data: { id: BANK_ID }, error: null });
    await POST(bankRequest({ ...verifiedEvent, name: 42 }));
    expect(mockSettle).toHaveBeenCalledWith(
      expect.objectContaining({ bankHolderName: null }),
    );
  });

  it("accepts a string id", async () => {
    lookups.push({ data: { id: BANK_ID }, error: null });
    await POST(bankRequest({ id: "84", reference: BANK_ID, status: "verified" }));
    expect(mockSettle).toHaveBeenCalledWith(
      expect.objectContaining({ chipBankAccountId: 84, verified: true }),
    );
  });

  it.each(["received", "pending", "reviewing"])(
    "acks a %s status without touching the DB",
    async (status) => {
      const res = await POST(bankRequest({ id: 84, status }));
      expect(res.status).toBe(200);
      expect(mockFrom).not.toHaveBeenCalled();
    },
  );

  it("recognises a bank account by its fields when there is no Event-Type", async () => {
    lookups.push({ data: { id: BANK_ID }, error: null });
    await POST(makeRequest(verifiedEvent));
    expect(mockSettle).toHaveBeenCalledWith(
      expect.objectContaining({ bankAccountId: BANK_ID, verified: true }),
    );
  });

  it("acks an unknown reference without settling", async () => {
    lookups.push({ data: null, error: null });
    lookups.push({ data: null, error: null });
    const res = await POST(bankRequest(verifiedEvent));
    expect(res.status).toBe(200);
    expect(mockSettle).not.toHaveBeenCalled();
  });

  it("returns 500 when the lookup fails, so CHIP re-delivers", async () => {
    lookups.push({ data: null, error: { message: "db down" } });
    const res = await POST(bankRequest(verifiedEvent));
    expect(res.status).toBe(500);
    expect(mockSettle).not.toHaveBeenCalled();
  });

  it("returns 500 when settlement fails with a DB error", async () => {
    lookups.push({ data: { id: BANK_ID }, error: null });
    mockSettle.mockResolvedValue({
      error: { code: "40001", message: "serialization failure" },
      settled: false,
    });
    const res = await POST(bankRequest(verifiedEvent));
    expect(res.status).toBe(500);
  });

  it("acks when the row vanished before settlement (P0002)", async () => {
    lookups.push({ data: { id: BANK_ID }, error: null });
    mockSettle.mockResolvedValue({
      error: { code: "P0002", message: "not found" },
      settled: false,
    });
    const res = await POST(bankRequest(verifiedEvent));
    expect(res.status).toBe(200);
  });
});

describe("send instruction events", () => {
  it("settles a completed instruction, correlating on reference first", async () => {
    lookups.push({ data: { id: PAYOUT_ID }, error: null });
    const res = await POST(sendRequest(completedEvent));
    expect(res.status).toBe(200);
    expect(mockFrom).toHaveBeenCalledWith("payouts");
    expect(eqCalls[0]).toEqual(["id", PAYOUT_ID]);
    expect(mockSettlePayout).toHaveBeenCalledWith({
      payoutId: PAYOUT_ID,
      chipSendInstructionId: 8,
      paid: true,
      amountCents: 9950,
      receiptUrl: "https://chip.test/r/8",
      failureReason: null,
    });
    expect(mockSettle).not.toHaveBeenCalled();
  });

  it("falls back to chip_send_instruction_id when reference misses", async () => {
    lookups.push({ data: null, error: null });
    lookups.push({ data: { id: PAYOUT_ID }, error: null });
    await POST(sendRequest(completedEvent));
    expect(eqCalls[1]).toEqual(["chip_send_instruction_id", 8]);
    expect(mockSettlePayout).toHaveBeenCalledWith(
      expect.objectContaining({ payoutId: PAYOUT_ID, paid: true }),
    );
  });

  it("accepts a string id", async () => {
    lookups.push({ data: { id: PAYOUT_ID }, error: null });
    await POST(
      sendRequest({ id: "8", reference: PAYOUT_ID, state: "completed", amount: "10.00" }),
    );
    expect(mockSettlePayout).toHaveBeenCalledWith(
      expect.objectContaining({ chipSendInstructionId: 8, paid: true, amountCents: 1000 }),
    );
  });

  it("is not mistaken for a bank account by its nested bank_account_details", async () => {
    lookups.push({ data: { id: PAYOUT_ID }, error: null });
    await POST(
      makeRequest({
        ...completedEvent,
        bank_account_id: 84,
        bank_account_details: { name: "A", bank_code: "MBBEMYKL", account_number: "1234567890" },
      }),
    );
    expect(mockSettle).not.toHaveBeenCalled();
    expect(mockSettlePayout).toHaveBeenCalled();
  });

  it("recognises an instruction by its state when there is no Event-Type", async () => {
    lookups.push({ data: { id: PAYOUT_ID }, error: null });
    await POST(makeRequest({ id: 8, reference: PAYOUT_ID, state: "completed" }));
    expect(mockSettlePayout).toHaveBeenCalled();
  });

  it("leaves the amount to the recorded one when CHIP's is unusable", async () => {
    lookups.push({ data: { id: PAYOUT_ID }, error: null });
    await POST(sendRequest({ ...completedEvent, amount: undefined }));
    expect(mockSettlePayout).toHaveBeenCalledWith(
      expect.objectContaining({ amountCents: null }),
    );
  });

  it.each([
    ["rejected", "send_instruction_rejected"],
    ["deleted", "send_instruction_deleted"],
  ])("settles %s as a terminal failure", async (state, failureReason) => {
    lookups.push({ data: { id: PAYOUT_ID }, error: null });
    const res = await POST(sendRequest({ id: 8, reference: PAYOUT_ID, state }));
    expect(res.status).toBe(200);
    expect(mockSettlePayout).toHaveBeenCalledWith({
      payoutId: PAYOUT_ID,
      chipSendInstructionId: 8,
      paid: false,
      amountCents: null,
      receiptUrl: null,
      failureReason,
    });
  });

  it.each([
    ["received", "received"],
    ["enquiring", "enquiring"],
    ["executing", "executing"],
    ["reviewing", "reviewing"],
    ["accepted, which can still end rejected", "accepted"],
    ["an unrecognised state", "something_new"],
    ["a missing state", undefined],
  ])("acks %s with no state change", async (_label, state) => {
    const res = await POST(sendRequest({ id: 8, reference: PAYOUT_ID, state }));
    expect(res.status).toBe(200);
    expect(mockFrom).not.toHaveBeenCalled();
    expect(mockSettlePayout).not.toHaveBeenCalled();
  });

  it("acks an event matching no payout without settling", async () => {
    lookups.push({ data: null, error: null });
    lookups.push({ data: null, error: null });
    const res = await POST(sendRequest(completedEvent));
    expect(res.status).toBe(200);
    expect(mockSettlePayout).not.toHaveBeenCalled();
    expect(console.warn).toHaveBeenCalled();
  });

  it("returns 500 when the lookup fails, so CHIP re-delivers", async () => {
    lookups.push({ data: null, error: { message: "db down" } });
    const res = await POST(sendRequest(completedEvent));
    expect(res.status).toBe(500);
    expect(mockSettlePayout).not.toHaveBeenCalled();
    expect(console.error).toHaveBeenCalledWith(
      expect.stringMatching(new RegExp(`failed to look up payout ${PAYOUT_ID};.* db down$`)),
    );
  });

  it("returns 500 when settlement fails with a DB error, so CHIP re-delivers", async () => {
    lookups.push({ data: { id: PAYOUT_ID }, error: null });
    mockSettlePayout.mockResolvedValue({
      error: { code: "40001", message: "serialization failure" },
      settled: false,
    });
    const res = await POST(sendRequest(completedEvent));
    expect(res.status).toBe(500);
    expect(console.error).toHaveBeenCalledWith(
      expect.stringMatching(
        new RegExp(`settle_payout failed for payout ${PAYOUT_ID} \\(paid\\);.* 40001: serialization failure$`),
      ),
    );
  });

  it("acks when the payout vanished before settlement (P0002)", async () => {
    lookups.push({ data: { id: PAYOUT_ID }, error: null });
    mockSettlePayout.mockResolvedValue({
      error: { code: "P0002", message: "not found" },
      settled: false,
    });
    const res = await POST(sendRequest(completedEvent));
    expect(res.status).toBe(200);
    expect(console.warn).toHaveBeenCalledWith(
      expect.stringContaining(`payout ${PAYOUT_ID} disappeared`),
    );
  });

  it("logs what each delivery carried, but no amount or receipt", async () => {
    lookups.push({ data: { id: PAYOUT_ID }, error: null });
    await POST(sendRequest(completedEvent));
    expect(console.info).toHaveBeenCalledWith(
      "CHIP Send webhook: send instruction event",
      {
        state: "completed",
        chipId: 8,
        reference: PAYOUT_ID,
        outcome: "completed",
        rejectionReason: null,
      },
    );
  });

  it("logs CHIP's rejection reason with long digit runs redacted", async () => {
    lookups.push({ data: { id: PAYOUT_ID }, error: null });
    await POST(
      sendRequest({
        id: 8,
        reference: PAYOUT_ID,
        state: "rejected",
        rejection_reason: "Account 1234567890 is closed",
      }),
    );
    expect(console.info).toHaveBeenCalledWith(
      "CHIP Send webhook: send instruction event",
      expect.objectContaining({ rejectionReason: "Account [redacted] is closed" }),
    );
  });

  it("ignores a badly signed instruction event", async () => {
    const res = await POST(sendRequest(completedEvent, sign("other body")));
    expect(res.status).toBe(200);
    expect(mockSettlePayout).not.toHaveBeenCalled();
  });
});

describe("other deliveries", () => {
  it("acks a budget allocation event with no state change", async () => {
    const res = await POST(
      makeRequest(
        { id: 5, transaction_type: "in", status: "approved" },
        undefined,
        "budget_allocation_status",
      ),
    );
    expect(res.status).toBe(200);
    expect(mockFrom).not.toHaveBeenCalled();
    expect(mockSettle).not.toHaveBeenCalled();
    expect(mockSettlePayout).not.toHaveBeenCalled();
  });

  it("routes by the Event-Type header, not the body's shape", async () => {
    const res = await POST(
      makeRequest(verifiedEvent, undefined, "budget_allocation_status"),
    );
    expect(res.status).toBe(200);
    expect(mockFrom).not.toHaveBeenCalled();
  });

  it("acks a signed but non-JSON body", async () => {
    const res = await POST(makeRequest("not json"));
    expect(res.status).toBe(200);
    expect(mockSettle).not.toHaveBeenCalled();
  });
});

describe("prize award events", () => {
  const AWARD_ID = "55555555-5555-4555-8555-555555555555";

  it("settles a completed instruction for a prize award when no payout matches", async () => {
    lookups.push({ data: null, error: null });
    lookups.push({ data: null, error: null });
    lookups.push({ data: { id: AWARD_ID }, error: null });
    const res = await POST(sendRequest({ ...completedEvent, reference: AWARD_ID }));
    expect(res.status).toBe(200);
    expect(mockSettlePayout).not.toHaveBeenCalled();
    expect(mockSettleAward).toHaveBeenCalledWith({
      awardId: AWARD_ID,
      chipSendInstructionId: 8,
      paid: true,
      amountCents: 9950,
      receiptUrl: "https://chip.test/r/8",
      failureReason: null,
    });
  });

  it("records a rejected prize transfer as failed", async () => {
    lookups.push({ data: null, error: null });
    lookups.push({ data: null, error: null });
    lookups.push({ data: { id: AWARD_ID }, error: null });
    await POST(
      sendRequest({
        id: 9,
        reference: AWARD_ID,
        state: "rejected",
      }),
    );
    expect(mockSettleAward).toHaveBeenCalledWith(
      expect.objectContaining({ paid: false, failureReason: "send_instruction_rejected" }),
    );
  });

  it("returns 500 when settle_prize_award fails, so CHIP redelivers", async () => {
    lookups.push({ data: null, error: null });
    lookups.push({ data: null, error: null });
    lookups.push({ data: { id: AWARD_ID }, error: null });
    mockSettleAward.mockResolvedValue({ error: { message: "db down" }, settled: false });
    const res = await POST(sendRequest({ ...completedEvent, reference: AWARD_ID }));
    expect(res.status).toBe(500);
  });

  it("sends prizes waiting on a winner's account once CHIP verifies it", async () => {
    lookups.push({ data: null, error: null });
    lookups.push({ data: { id: BANK_ID }, error: null });
    mockSettle.mockResolvedValue({
      error: null,
      settled: true,
      playerVerdict: { userId: "user-1", verified: true },
    });
    await POST(bankRequest(verifiedEvent));
    expect(mockOnPlayerVerdict).not.toHaveBeenCalled();
    await runAfterCallbacks();
    expect(mockOnPlayerVerdict).toHaveBeenCalledWith("user-1", true);
  });

  it("does nothing more for an organization's verdict", async () => {
    lookups.push({ data: { id: BANK_ID }, error: null });
    await POST(bankRequest(verifiedEvent));
    await runAfterCallbacks();
    expect(mockOnPlayerVerdict).not.toHaveBeenCalled();
  });
});

