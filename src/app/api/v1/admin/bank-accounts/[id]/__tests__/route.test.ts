import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { runAfterCallbacks } from "@/test/after";
import { appIdFor } from "@/test/identity";

const { mockGetClaims, mockRpc, mockReview, mockOnPlayerVerdict } = vi.hoisted(
  () => ({
    mockGetClaims: vi.fn(),
    mockRpc: vi.fn(),
    mockReview: vi.fn(),
    mockOnPlayerVerdict: vi.fn(),
  }),
);

vi.mock("@/services/supabase/admin", () => ({
  supabaseAdmin: { from: vi.fn() },
}));
vi.mock("@/services/supabase/server", () => ({
  createClient: vi.fn().mockResolvedValue({
    auth: { getClaims: mockGetClaims },
    rpc: mockRpc,
  }),
}));
vi.mock("next/headers", () => ({
  cookies: vi.fn().mockResolvedValue({ getAll: () => [], set: vi.fn() }),
}));
vi.mock("@/services/payouts/bank-account", () => ({
  reviewBankAccountName: mockReview,
}));
vi.mock("@/services/prizes/execute", () => ({
  onPlayerBankVerdict: mockOnPlayerVerdict,
}));

import { PATCH } from "../route";

const ADMIN = "aaaaaaaa-0000-4000-8000-000000000001";
const BANK_ID = "bbbbbbbb-0000-4000-8000-000000000001";

function patch(body: unknown, id = BANK_ID) {
  return PATCH(
    new NextRequest(`http://localhost/api/v1/admin/bank-accounts/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: typeof body === "string" ? body : JSON.stringify(body),
    }),
    { params: Promise.resolve({ id }) },
  );
}

describe("PATCH /api/v1/admin/bank-accounts/:id", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetClaims.mockResolvedValue({
      data: { claims: { sub: ADMIN } },
      error: null,
    });
    mockRpc.mockResolvedValue({ data: true, error: null });
    mockReview.mockResolvedValue({
      error: null,
      settled: true,
      status: "verified",
    });
    vi.spyOn(console, "error").mockImplementation(() => {});
  });
  afterEach(() => vi.restoreAllMocks());

  it("400 for a malformed id", async () => {
    const res = await patch({ action: "confirm", note: "ok" }, "nope");
    expect(res.status).toBe(400);
    expect(mockReview).not.toHaveBeenCalled();
  });

  it("401 when signed out", async () => {
    mockGetClaims.mockResolvedValue({ data: { claims: null }, error: null });
    const res = await patch({ action: "confirm", note: "ok" });
    expect(res.status).toBe(401);
  });

  it("403 for a non-admin", async () => {
    mockRpc.mockResolvedValue({ data: false, error: null });
    const res = await patch({ action: "confirm", note: "ok" });
    expect(res.status).toBe(403);
    expect(mockReview).not.toHaveBeenCalled();
  });

  it.each([
    ["an unknown action", { action: "approve", note: "ok" }],
    ["no note", { action: "confirm" }],
    ["a blank note", { action: "reject", note: "   " }],
    [
      "a note over 1000 characters",
      { action: "reject", note: "x".repeat(1001) },
    ],
    ["a body that isn't JSON", "{"],
  ])("400 for %s", async (_label, body) => {
    const res = await patch(body);
    expect(res.status).toBe(400);
    expect(mockReview).not.toHaveBeenCalled();
  });

  it("records the decision as the signed-in admin, with the note trimmed", async () => {
    const res = await patch({
      action: "confirm",
      note: "  Bank shortened it ",
    });

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      data: { id: BANK_ID, status: "verified" },
    });
    expect(mockReview).toHaveBeenCalledWith({
      bankAccountId: BANK_ID,
      reviewerId: appIdFor(ADMIN),
      action: "confirm",
      note: "Bank shortened it",
    });
  });

  it("hands a player's verdict to the prize flow after the response", async () => {
    mockReview.mockResolvedValue({
      error: null,
      settled: true,
      status: "rejected",
      playerVerdict: { userId: "u-1", verified: false },
    });

    await patch({ action: "reject", note: "Not the player's account" });
    expect(mockOnPlayerVerdict).not.toHaveBeenCalled();
    await runAfterCallbacks();
    expect(mockOnPlayerVerdict).toHaveBeenCalledWith("u-1", false);
  });

  it("404 when the account doesn't exist", async () => {
    mockReview.mockResolvedValue({
      error: { code: "P0002", message: "bank account x not found" },
      settled: false,
    });
    const res = await patch({ action: "confirm", note: "ok" });
    expect(res.status).toBe(404);
  });

  it("409 when the account isn't under review, without the database's text", async () => {
    mockReview.mockResolvedValue({
      error: {
        code: "P0001",
        message:
          "NOT_UNDER_REVIEW: this account is verified, not awaiting a name review",
      },
      settled: false,
    });
    const res = await patch({ action: "confirm", note: "ok" });
    expect(res.status).toBe(409);
    const json = await res.json();
    expect(json.error.code).toBe("NOT_UNDER_REVIEW");
    expect(json.error.message).not.toContain("awaiting a name review");
  });

  it("500 on an unexpected error", async () => {
    mockReview.mockResolvedValue({
      error: { code: "XX000", message: "boom" },
      settled: false,
    });
    const res = await patch({ action: "confirm", note: "ok" });
    expect(res.status).toBe(500);
    expect(JSON.stringify(await res.json())).not.toContain("boom");
  });
});
