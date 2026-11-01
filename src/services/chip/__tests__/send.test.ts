import crypto from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  ChipSendError,
  chipBankAccountOutcome,
  chipSendChecksum,
  chipSendHeaders,
  chipSendOutcome,
  createChipSendInstruction,
  getChipSendAccounts,
  getChipSendInstruction,
  increaseChipSendLimit,
  registerChipBankAccount,
  resendChipSendLimitApproval,
  toChipSendInstructionAmount,
  toChipSendLimitAmount,
} from "../send";

const API_KEY = "mct-test-key-0001";
const API_SECRET = "mct-test-secret-0001";
const STAGING_URL = "https://staging-api.chip-in.asia/api";

// ---------------------------------------------------------------------------
// Checksum
// ---------------------------------------------------------------------------

describe("chipSendChecksum", () => {
  // Our OWN pinned vector: a fixed secret plus a digest computed once and
  // hardcoded. This is the primary regression guard.
  it("matches the project's pinned vector", () => {
    expect(chipSendChecksum("1700000000", API_KEY, API_SECRET)).toBe(
      "7f05dd2003045197f833e4387a151269d3684a6ba056646db2c5c53f407212ff5be5b32b894254207a7a82af82dff91ad18bc6f4e45ad3314a5d1d67eb266f24",
    );
  });

  // The vendor fixture from https://docs.chip-in.asia/openapi/chip-send.yaml.
  //
  // History, so nobody "fixes" this the wrong way: older revisions of the CHIP
  // Send docs published the epoch, API key and expected digest but NOT the API
  // Secret, which made the vector unreproducible (HMAC needs the key). Issue #519
  // was written against that revision. The spec as of 2026-11-01 states the
  // secret (a118729e-…) and the digest reproduces, so it is asserted here. If
  // the vendor ever rotates the example again, update all four constants
  // together from the spec — never just the digest.
  it("reproduces the vendor's published example", () => {
    expect(
      chipSendChecksum(
        1689826456,
        "e0645c9e-fcf2-4f29-a327-202f7ed3d969",
        "a118729e-4243-4145-83b3-0b8cb213fe8e",
      ),
    ).toBe(
      "45bee62dba8087ab1e7e767d92f8d6e26f8bd19ee5fd2fef6386bb9425976498a86ffdbddb7a49919998e993c20626196ea652320f438a9528d2b8c9d19ec266",
    );
  });

  it("signs epoch + apiKey with NO separator", () => {
    const epoch = "1700000000";
    const independent = crypto
      .createHmac("sha512", API_SECRET)
      .update(epoch + API_KEY)
      .digest("hex");
    expect(chipSendChecksum(epoch, API_KEY, API_SECRET)).toBe(independent);

    // Every plausible separator produces a different digest.
    for (const sep of [":", "|", " ", "\n", ","]) {
      const withSep = crypto
        .createHmac("sha512", API_SECRET)
        .update(`${epoch}${sep}${API_KEY}`)
        .digest("hex");
      expect(chipSendChecksum(epoch, API_KEY, API_SECRET)).not.toBe(withSep);
    }

    // Order matters: apiKey + epoch is wrong.
    const reversed = crypto
      .createHmac("sha512", API_SECRET)
      .update(API_KEY + epoch)
      .digest("hex");
    expect(chipSendChecksum(epoch, API_KEY, API_SECRET)).not.toBe(reversed);
  });

  it("is lowercase hex SHA-512 — not base64, not SHA-256", () => {
    const digest = chipSendChecksum("1700000000", API_KEY, API_SECRET);
    expect(digest).toMatch(/^[0-9a-f]{128}$/);

    const sha256 = crypto
      .createHmac("sha256", API_SECRET)
      .update("1700000000" + API_KEY)
      .digest("hex");
    expect(digest).not.toBe(sha256);
    expect(sha256).toHaveLength(64);

    const base64 = crypto
      .createHmac("sha512", API_SECRET)
      .update("1700000000" + API_KEY)
      .digest("base64");
    expect(digest).not.toBe(base64);
  });

  it("is keyed on the secret, not the api key", () => {
    expect(chipSendChecksum("1700000000", API_KEY, API_SECRET)).not.toBe(
      chipSendChecksum("1700000000", API_KEY, API_KEY),
    );
  });
});

// ---------------------------------------------------------------------------
// Headers
// ---------------------------------------------------------------------------

describe("chipSendHeaders", () => {
  beforeEach(() => {
    vi.stubEnv("CHIP_SEND_API_KEY", API_KEY);
    vi.stubEnv("CHIP_SEND_API_SECRET", API_SECRET);
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllEnvs();
  });

  it("sends the three auth headers with a checksum over the current epoch", () => {
    vi.setSystemTime(new Date(1_700_000_000_500));
    const h = chipSendHeaders();
    expect(h.Authorization).toBe(`Bearer ${API_KEY}`);
    expect(h.epoch).toBe("1700000000"); // seconds, floored
    expect(h.checksum).toBe(chipSendChecksum("1700000000", API_KEY, API_SECRET));
    expect(h["Content-Type"]).toBe("application/json");
  });

  it("computes a fresh epoch and checksum on every call (never memoized)", () => {
    vi.setSystemTime(new Date(1_700_000_000_000));
    const first = chipSendHeaders();
    vi.setSystemTime(new Date(1_700_000_045_000));
    const second = chipSendHeaders();

    expect(second.epoch).toBe("1700000045");
    expect(second.epoch).not.toBe(first.epoch);
    expect(second.checksum).not.toBe(first.checksum);
    expect(second.checksum).toBe(
      chipSendChecksum("1700000045", API_KEY, API_SECRET),
    );
  });

  it("never puts the secret in a header", () => {
    const h = chipSendHeaders();
    for (const value of Object.values(h)) {
      expect(value).not.toContain(API_SECRET);
    }
  });

  it("throws without credentials", () => {
    vi.stubEnv("CHIP_SEND_API_SECRET", "");
    expect(() => chipSendHeaders()).toThrow(/CHIP_SEND_API_SECRET/);
  });
});

// ---------------------------------------------------------------------------
// Amount conversion
// ---------------------------------------------------------------------------

describe("amount conversion", () => {
  it("send limit amount is a JSON number", () => {
    expect(toChipSendLimitAmount(12345)).toBe(123.45);
    expect(typeof toChipSendLimitAmount(100)).toBe("number");
  });

  it("send instruction amount is a 2dp string", () => {
    expect(toChipSendInstructionAmount(12345)).toBe("123.45");
    expect(toChipSendInstructionAmount(100)).toBe("1.00");
    expect(toChipSendInstructionAmount(5)).toBe("0.05");
    expect(toChipSendInstructionAmount(1_000_000_07)).toBe("1000000.07");
    expect(typeof toChipSendInstructionAmount(100)).toBe("string");
  });

  it("rejects non-integer, zero and negative cents", () => {
    for (const bad of [0, -100, 1.5, Number.NaN]) {
      expect(() => toChipSendLimitAmount(bad)).toThrow(RangeError);
      expect(() => toChipSendInstructionAmount(bad)).toThrow(RangeError);
    }
  });
});

// ---------------------------------------------------------------------------
// HTTP calls
// ---------------------------------------------------------------------------

describe("CHIP Send HTTP calls", () => {
  const fetchMock = vi.fn();

  beforeEach(() => {
    vi.stubEnv("CHIP_SEND_API_KEY", API_KEY);
    vi.stubEnv("CHIP_SEND_API_SECRET", API_SECRET);
    vi.stubEnv("CHIP_SEND_API_URL", "");
    vi.stubGlobal("fetch", fetchMock);
    fetchMock.mockReset();
    fetchMock.mockImplementation(() =>
      Promise.resolve(new Response(JSON.stringify({ id: 1 }), { status: 200 })),
    );
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  function lastCall(): { url: string; init: RequestInit; body: unknown } {
    const [url, init] = fetchMock.mock.calls.at(-1) as [string, RequestInit];
    return {
      url,
      init,
      body: init.body ? JSON.parse(init.body as string) : undefined,
    };
  }

  it("defaults to the staging host", async () => {
    await getChipSendAccounts();
    const { url, init } = lastCall();
    expect(url).toBe(`${STAGING_URL}/send/accounts`);
    expect(init.method).toBe("GET");
    const headers = init.headers as Record<string, string>;
    expect(headers.Authorization).toBe(`Bearer ${API_KEY}`);
    expect(headers.epoch).toMatch(/^\d+$/);
    expect(headers.checksum).toMatch(/^[0-9a-f]{128}$/);
  });

  it("honours CHIP_SEND_API_URL (trailing slash tolerated)", async () => {
    vi.stubEnv("CHIP_SEND_API_URL", "https://api.chip-in.asia/api/");
    await getChipSendAccounts();
    expect(lastCall().url).toBe("https://api.chip-in.asia/api/send/accounts");
  });

  it("signs each request independently", async () => {
    vi.useFakeTimers();
    try {
      vi.setSystemTime(new Date(1_700_000_000_000));
      await getChipSendAccounts();
      const h1 = fetchMock.mock.calls[0][1].headers as Record<string, string>;
      vi.setSystemTime(new Date(1_700_000_031_000));
      await getChipSendAccounts();
      const h2 = fetchMock.mock.calls[1][1].headers as Record<string, string>;
      expect(h1.epoch).not.toBe(h2.epoch);
      expect(h1.checksum).not.toBe(h2.checksum);
    } finally {
      vi.useRealTimers();
    }
  });

  it("increaseChipSendLimit sends amount as a NUMBER", async () => {
    await increaseChipSendLimit(50_000);
    const { url, init, body } = lastCall();
    expect(url).toBe(`${STAGING_URL}/send/send_limits`);
    expect(init.method).toBe("POST");
    expect(body).toEqual({ amount: 500 });
    expect(typeof (body as { amount: unknown }).amount).toBe("number");
  });

  it("resendChipSendLimitApproval hits the resend path", async () => {
    await resendChipSendLimitApproval(42);
    const { url, init } = lastCall();
    expect(url).toBe(`${STAGING_URL}/send/send_limits/42/resend_approval_requests`);
    expect(init.method).toBe("POST");
  });

  it("registerChipBankAccount posts the recipient", async () => {
    const req = {
      account_number: "157380112229",
      bank_code: "MBBEMYKL",
      name: "Ahmad Razali",
      reference: "c0ffee00-0000-4000-8000-000000000000",
    };
    await registerChipBankAccount(req);
    const { url, body } = lastCall();
    expect(url).toBe(`${STAGING_URL}/send/bank_accounts`);
    expect(body).toEqual(req);
  });

  it("createChipSendInstruction sends amount as a STRING", async () => {
    await createChipSendInstruction({
      bank_account_id: 84,
      amountCents: 15_000,
      email: "org@example.com",
      description: "Prize payout",
      reference: "payout-1",
      send_recipient_receipt: true,
    });
    const { url, body } = lastCall();
    expect(url).toBe(`${STAGING_URL}/send/send_instructions`);
    expect(body).toEqual({
      bank_account_id: 84,
      amount: "150.00",
      email: "org@example.com",
      description: "Prize payout",
      reference: "payout-1",
      send_recipient_receipt: true,
    });
    expect(typeof (body as { amount: unknown }).amount).toBe("string");
    expect(body).not.toHaveProperty("amountCents");
  });

  it("getChipSendInstruction fetches by id", async () => {
    await getChipSendInstruction(8);
    const { url, init } = lastCall();
    expect(url).toBe(`${STAGING_URL}/send/send_instructions/8`);
    expect(init.method).toBe("GET");
  });

  it("a 403 on create-send-instruction is insufficient balance", async () => {
    fetchMock.mockResolvedValue(
      new Response('{"message":"forbidden"}', { status: 403 }),
    );
    const err = await createChipSendInstruction({
      bank_account_id: 1,
      amountCents: 100,
      email: "a@b.c",
      description: "d",
      reference: "r",
    }).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ChipSendError);
    expect((err as ChipSendError).status).toBe(403);
    expect((err as ChipSendError).insufficientBalance).toBe(true);
    expect((err as ChipSendError).message).toMatch(/insufficient balance/i);
  });

  it("a 403 elsewhere is NOT flagged as insufficient balance", async () => {
    fetchMock.mockResolvedValue(new Response("nope", { status: 403 }));
    const err = (await increaseChipSendLimit(100).catch(
      (e: unknown) => e,
    )) as ChipSendError;
    expect(err.insufficientBalance).toBe(false);
  });

  it("ChipSendError carries status + body but never the credentials", async () => {
    fetchMock.mockResolvedValue(
      new Response('{"message":"Unauthorized"}', { status: 401 }),
    );
    const err = (await getChipSendAccounts().catch(
      (e: unknown) => e,
    )) as ChipSendError;
    expect(err.status).toBe(401);
    expect(err.body).toBe('{"message":"Unauthorized"}');
    const serialized = JSON.stringify(err) + err.message + String(err.stack);
    expect(serialized).not.toContain(API_SECRET);
    expect(serialized).not.toContain(API_KEY);
    expect(serialized).not.toMatch(/[0-9a-f]{128}/);
  });
});

// ---------------------------------------------------------------------------
// Outcome classifiers
// ---------------------------------------------------------------------------

describe("chipBankAccountOutcome", () => {
  it("maps verified by status or event", () => {
    expect(chipBankAccountOutcome("verified")).toBe("verified");
    expect(chipBankAccountOutcome(undefined, "bank_account.verified")).toBe(
      "verified",
    );
    expect(chipBankAccountOutcome("VERIFIED")).toBe("verified");
  });

  it("maps rejected by status or event", () => {
    expect(chipBankAccountOutcome("rejected")).toBe("rejected");
    expect(chipBankAccountOutcome(undefined, "bank_account.rejected")).toBe(
      "rejected",
    );
  });

  it("treats everything else as pending", () => {
    expect(chipBankAccountOutcome("pending")).toBe("pending");
    expect(chipBankAccountOutcome("unverified")).toBe("pending");
    expect(chipBankAccountOutcome()).toBe("pending");
    expect(chipBankAccountOutcome("completed", "send_instruction.completed")).toBe(
      "pending",
    );
  });
});

describe("chipSendOutcome", () => {
  it("only completed is success", () => {
    expect(chipSendOutcome("completed")).toBe("completed");
    expect(chipSendOutcome(undefined, "send_instruction.completed")).toBe(
      "completed",
    );
  });

  it("rejected and deleted are terminal failures", () => {
    expect(chipSendOutcome("rejected")).toBe("failed");
    expect(chipSendOutcome("deleted")).toBe("failed");
    expect(chipSendOutcome(undefined, "send_instruction.rejected")).toBe(
      "failed",
    );
  });

  it("in-flight states (incl. accepted) are pending", () => {
    for (const s of [
      "received",
      "enquiring",
      "executing",
      "reviewing",
      "accepted",
      undefined,
    ]) {
      expect(chipSendOutcome(s)).toBe("pending");
    }
    expect(chipSendOutcome("verified", "bank_account.verified")).toBe("pending");
  });
});
