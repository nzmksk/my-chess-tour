import { beforeEach, describe, expect, it, vi } from "vitest";
import { runAfterCallbacks } from "@/test/after";

const {
  results,
  calls,
  mockFrom,
  mockRpc,
  mockCreatePurchase,
  mockCancelPurchase,
  mockSendRequest,
  mockSendListed,
  mockRevalidate,
  mockRecipients,
  mockPool,
} = vi.hoisted(() => {
  const results: Array<{ data: unknown; error: unknown }> = [];
  const calls: Array<{ table: string; update?: unknown; filters: Record<string, unknown> }> = [];
  function makeBuilder(table: string) {
    const call: { table: string; update?: unknown; filters: Record<string, unknown> } = {
      table,
      filters: {},
    };
    calls.push(call);
    const b: Record<string, unknown> = {};
    for (const m of ["select", "order", "maybeSingle"]) b[m] = vi.fn(() => b);
    b.update = vi.fn((payload: unknown) => {
      call.update = payload;
      return b;
    });
    for (const m of ["eq", "is"]) {
      b[m] = vi.fn((col: string, val: unknown) => {
        call.filters[`${m}:${col}`] = val;
        return b;
      });
    }
    b.then = (onfulfilled: (v: unknown) => unknown, onrejected?: (r: unknown) => unknown) =>
      Promise.resolve(results.shift() ?? { data: null, error: null }).then(onfulfilled, onrejected);
    return b;
  }
  return {
    results,
    calls,
    mockFrom: vi.fn((table: string) => makeBuilder(table)),
    mockRpc: vi.fn(),
    mockCreatePurchase: vi.fn(),
    mockCancelPurchase: vi.fn(),
    mockSendRequest: vi.fn(),
    mockSendListed: vi.fn(),
    mockRevalidate: vi.fn(),
    mockRecipients: vi.fn(),
    mockPool: vi.fn(),
  };
});

vi.mock("@/services/supabase/admin", () => ({ supabaseAdmin: { from: mockFrom, rpc: mockRpc } }));
vi.mock("@/services/chip/chip", () => ({
  createChipPurchase: mockCreatePurchase,
  cancelChipPurchase: mockCancelPurchase,
}));
vi.mock("@/services/email/email", () => ({
  sendPrizeFundingRequestEmail: mockSendRequest,
  sendTournamentListedEmail: mockSendListed,
}));
vi.mock("@/services/payouts/recipients", () => ({ loadOrganizationRecipients: mockRecipients }));
vi.mock("../pool", () => ({ loadPrizePoolPosition: mockPool }));
vi.mock("../notify", () => ({
  prizeLabel: (category: string, place: string | null) => (place ? `${category} — ${place}` : category),
}));
vi.mock("next/cache", () => ({ revalidateTag: mockRevalidate }));

import {
  createMissingFundingLinks,
  onTournamentListed,
  prizesFundedBy,
  sweepPrizeFundingRequests,
  syncPrizeFundingRequests,
} from "../funding-requests";

const PRIZES = {
  categories: [
    {
      name: "Open",
      funding: { source: "sponsor" as const, funder_name: "ACME" },
      entries: [
        { place: "1st", amount_cents: 30000 },
        { place: "2nd", amount_cents: 15000 },
        { place: "3rd", amount_cents: 0 },
      ],
    },
  ],
  special: [
    { name: "Best Junior", funding: { source: "sponsor" as const, funder_name: " acme " }, amount_cents: 5000 },
    { name: "Best Female", funding: { source: "grant" as const, funder_name: "Ministry" }, amount_cents: 2000 },
  ],
  distribution: "platform" as const,
};

const ROW = {
  id: "f-1",
  tournament_id: "t-1",
  funder_name: "ACME",
  funder_email: "pay@acme.test",
  amount_cents: 50000,
};

beforeEach(() => {
  vi.clearAllMocks();
  results.length = 0;
  calls.length = 0;
  mockCreatePurchase.mockResolvedValue({ id: "purchase-1", checkout_url: "https://gate.test/p/1" });
  mockCancelPurchase.mockResolvedValue(undefined);
  mockSendRequest.mockResolvedValue(undefined);
  mockSendListed.mockResolvedValue(undefined);
  vi.spyOn(console, "error").mockImplementation(() => {});
  vi.spyOn(console, "warn").mockImplementation(() => {});
});

describe("prizesFundedBy", () => {
  it("lists the prizes with money that a funder pays for", () => {
    expect(prizesFundedBy(PRIZES, "Acme")).toBe("Open — 1st, Open — 2nd, Best Junior");
    expect(prizesFundedBy(PRIZES, "ministry")).toBe("Best Female");
    expect(prizesFundedBy(null, "Acme")).toBe("");
  });

  it("skips prizes with no funder, no money or missing parts", () => {
    const prizes = {
      categories: [
        { name: "Unfunded", entries: [{ place: "1st", amount_cents: 100 }] },
        { name: "Other", funding: { source: "sponsor" as const, funder_name: "Ministry" }, entries: [] },
        { funding: { source: "sponsor" as const, funder_name: "Acme" } },
        {
          funding: { source: "sponsor" as const, funder_name: "Acme" },
          entries: [{ amount_cents: 100 }, { place: "2nd" }],
        },
      ],
      special: [
        { name: "No funder", amount_cents: 100 },
        { name: "Free", funding: { source: "sponsor" as const, funder_name: "Acme" } },
        { funding: { source: "sponsor" as const, funder_name: "Acme" }, amount_cents: 100 },
      ],
      distribution: "platform" as const,
    };
    expect(prizesFundedBy(prizes as never, "acme")).toBe(", ");
    expect(prizesFundedBy({ distribution: "platform" } as never, "acme")).toBe("");
  });
});

describe("createMissingFundingLinks", () => {
  it("creates the purchase, records it on the open request, and emails the funder after", async () => {
    results.push(
      { data: [ROW], error: null },
      { data: { name: "Merdeka Open", prizes: PRIZES, organization: { name: "KL Chess" } }, error: null },
      { data: [{ id: "f-1" }], error: null },
    );

    const out = await createMissingFundingLinks({ tournamentId: "t-1" });

    expect(out).toEqual({ linked: 1, failed: 0 });
    expect(calls[0].filters).toMatchObject({
      "eq:status": "pending",
      "is:cancelled_at": null,
      "is:checkout_url": null,
      "eq:tournament_id": "t-1",
    });
    expect(mockCreatePurchase).toHaveBeenCalledWith(
      expect.objectContaining({
        reference: "f-1",
        client: { email: "pay@acme.test", full_name: "ACME" },
        purchase: expect.objectContaining({
          products: [expect.objectContaining({ price: 50000 })],
        }),
      }),
    );
    expect(calls[2].update).toEqual({
      chip_transaction_id: "purchase-1",
      checkout_url: "https://gate.test/p/1",
    });
    expect(calls[2].filters).toMatchObject({ "is:cancelled_at": null, "is:checkout_url": null });

    expect(mockSendRequest).not.toHaveBeenCalled();
    await runAfterCallbacks();
    expect(mockSendRequest).toHaveBeenCalledWith("pay@acme.test", {
      funderName: "ACME",
      organizerName: "KL Chess",
      tournamentName: "Merdeka Open",
      amountCents: 50000,
      prizeList: "Open — 1st, Open — 2nd, Best Junior",
      checkoutUrl: "https://gate.test/p/1",
    });
  });

  it("leaves the request open for a retry when CHIP fails", async () => {
    results.push(
      { data: [ROW], error: null },
      { data: { name: "Merdeka Open", prizes: PRIZES, organization: null }, error: null },
    );
    mockCreatePurchase.mockRejectedValue(new Error("CHIP 503"));

    const out = await createMissingFundingLinks();

    expect(out).toEqual({ linked: 0, failed: 1 });
    expect(calls.some((c) => c.update)).toBe(false);
    await runAfterCallbacks();
    expect(mockSendRequest).not.toHaveBeenCalled();
  });

  it("cancels the purchase when the request was linked or cancelled meanwhile", async () => {
    results.push(
      { data: [ROW], error: null },
      { data: { name: "Merdeka Open", prizes: PRIZES, organization: null }, error: null },
      { data: [], error: null },
    );

    const out = await createMissingFundingLinks();

    expect(out).toEqual({ linked: 0, failed: 1 });
    expect(mockCancelPurchase).toHaveBeenCalledWith("purchase-1");
    await runAfterCallbacks();
    expect(mockSendRequest).not.toHaveBeenCalled();
  });

  it("cancels the purchase it couldn't record, and survives that cancel failing", async () => {
    results.push(
      { data: [ROW], error: null },
      { data: { name: "Merdeka Open", prizes: PRIZES, organization: null }, error: null },
      { data: null, error: { message: "write failed" } },
    );
    mockCancelPurchase.mockRejectedValueOnce(new Error("CHIP 500")).mockRejectedValueOnce("plain");

    expect(await createMissingFundingLinks()).toEqual({ linked: 0, failed: 1 });
    expect(mockCancelPurchase).toHaveBeenCalledWith("purchase-1");

    results.push(
      { data: [ROW], error: null },
      { data: { name: "Merdeka Open", prizes: PRIZES, organization: null }, error: null },
      { data: null, error: null },
    );
    expect(await createMissingFundingLinks()).toEqual({ linked: 0, failed: 1 });
  });

  it("reports nothing when the requests can't be listed", async () => {
    results.push({ data: null, error: { message: "down" } });
    expect(await createMissingFundingLinks()).toEqual({ linked: 0, failed: 0 });
    expect(mockCreatePurchase).not.toHaveBeenCalled();

    results.push({ data: null, error: null });
    expect(await createMissingFundingLinks()).toEqual({ linked: 0, failed: 0 });
  });

  it("counts a request whose tournament can't be loaded as failed", async () => {
    results.push(
      { data: [ROW, { ...ROW, id: "f-2", tournament_id: "t-2" }], error: null },
      { data: null, error: { message: "timeout" } },
      { data: null, error: null },
    );
    expect(await createMissingFundingLinks()).toEqual({ linked: 0, failed: 2 });
    expect(mockCreatePurchase).not.toHaveBeenCalled();
  });

  it("names the organizer generically, and logs an email that fails", async () => {
    results.push(
      { data: [ROW], error: null },
      { data: { name: "Merdeka Open", prizes: PRIZES, organization: null }, error: null },
      { data: [{ id: "f-1" }], error: null },
      { data: [{ ...ROW, id: "f-2" }], error: null },
      { data: { name: "Merdeka Open", prizes: PRIZES, organization: { name: null } }, error: null },
      { data: [{ id: "f-2" }], error: null },
    );
    mockSendRequest.mockRejectedValueOnce(new Error("Resend 500")).mockRejectedValueOnce("plain");

    await createMissingFundingLinks();
    await createMissingFundingLinks();
    await runAfterCallbacks();

    expect(mockSendRequest).toHaveBeenCalledTimes(2);
    expect(mockSendRequest.mock.calls.map((c) => c[1].organizerName)).toEqual([
      "The organizer",
      "The organizer",
    ]);
    expect(console.error).toHaveBeenCalledWith("Prize funding f-1: failed to email the funder", "Resend 500");
    expect(console.error).toHaveBeenCalledWith("Prize funding f-2: failed to email the funder", "plain");
  });
});

describe("syncPrizeFundingRequests", () => {
  it("cancels superseded purchases, links new requests, and reports missing contacts", async () => {
    mockRpc.mockResolvedValue({
      data: {
        created: ["f-2"],
        cancelled: [
          { id: "f-1", chip_transaction_id: "purchase-old" },
          { id: "f-0", chip_transaction_id: null },
        ],
        missing_contacts: ["Ministry"],
        released: false,
      },
      error: null,
    });
    results.push(
      { data: [{ ...ROW, id: "f-2" }], error: null },
      { data: { name: "Merdeka Open", prizes: PRIZES, organization: null }, error: null },
      { data: [{ id: "f-2" }], error: null },
    );

    const out = await syncPrizeFundingRequests("t-1", "u-1");

    expect(mockRpc).toHaveBeenCalledWith("reconcile_prize_funding_requests", {
      p_tournament_id: "t-1",
      p_actor: "u-1",
    });
    expect(mockCancelPurchase).toHaveBeenCalledTimes(1);
    expect(mockCancelPurchase).toHaveBeenCalledWith("purchase-old");
    expect(out).toEqual({
      error: null,
      released: false,
      linked: 1,
      unlinked: 0,
      missingContacts: ["Ministry"],
    });
    expect(mockRevalidate).not.toHaveBeenCalled();
  });

  it("refreshes the public pages when the reconcile listed the tournament", async () => {
    mockRpc.mockResolvedValue({
      data: { created: [], cancelled: [], missing_contacts: [], released: true },
      error: null,
    });
    results.push(
      { data: [], error: null },
      { data: { slug: "merdeka-open" }, error: null },
    );

    const out = await syncPrizeFundingRequests("t-1", null);

    expect(out.released).toBe(true);
    expect(mockRevalidate).toHaveBeenCalledWith("tournaments", expect.anything());
    expect(mockRevalidate).toHaveBeenCalledWith(expect.stringContaining("merdeka-open"), expect.anything());
  });

  it("logs a superseded purchase CHIP won't cancel, and carries on", async () => {
    mockRpc.mockResolvedValue({
      data: {
        created: [],
        cancelled: [
          { id: "f-1", chip_transaction_id: "purchase-1" },
          { id: "f-2", chip_transaction_id: "purchase-2" },
        ],
        missing_contacts: [],
        released: false,
      },
      error: null,
    });
    mockCancelPurchase.mockRejectedValueOnce(new Error("CHIP 500")).mockRejectedValueOnce("plain");
    results.push({ data: [], error: null });

    const out = await syncPrizeFundingRequests("t-1", null);

    expect(out.error).toBeNull();
    expect(console.error).toHaveBeenCalledWith("Prize funding f-1: failed to cancel its CHIP purchase", "CHIP 500");
    expect(console.error).toHaveBeenCalledWith("Prize funding f-2: failed to cancel its CHIP purchase", "plain");
  });

  it("returns the database error without touching CHIP", async () => {
    mockRpc.mockResolvedValue({ data: null, error: { code: "P0002", message: "not found" } });
    const out = await syncPrizeFundingRequests("t-1", null);
    expect(out.error).toEqual({ code: "P0002", message: "not found" });
    expect(mockCreatePurchase).not.toHaveBeenCalled();
  });
});

describe("onTournamentListed", () => {
  it("emails the organization's owners and admins after the response", async () => {
    results.push(
      { data: { slug: "merdeka-open" }, error: null },
      {
        data: {
          name: "Merdeka Open",
          slug: "merdeka-open",
          organization_id: "org-1",
          organization: { name: "KL Chess" },
        },
        error: null,
      },
    );
    mockPool.mockResolvedValue({ ok: true, position: { funded_cents: 52000 } });
    mockRecipients.mockResolvedValue(new Map([["o@kl.test", { email: "o@kl.test", name: "Hafiz" }]]));

    await onTournamentListed("t-1");
    expect(mockSendListed).not.toHaveBeenCalled();
    await runAfterCallbacks();

    expect(mockRecipients).toHaveBeenCalledWith(["org-1"]);
    expect(mockSendListed).toHaveBeenCalledWith("o@kl.test", {
      recipientName: "Hafiz",
      orgName: "KL Chess",
      tournamentName: "Merdeka Open",
      tournamentUrl: expect.stringContaining("/tournaments/merdeka-open"),
      fundedCents: 52000,
    });
  });

  it("refreshes only the list when the slug can't be read", async () => {
    results.push({ data: null, error: { message: "timeout" } });
    await onTournamentListed("t-1");
    expect(mockRevalidate).toHaveBeenCalledTimes(1);
    expect(mockRevalidate).toHaveBeenCalledWith("tournaments", expect.anything());

    mockRevalidate.mockClear();
    results.push({ data: { slug: null }, error: null });
    await onTournamentListed("t-1");
    expect(mockRevalidate).toHaveBeenCalledTimes(1);
  });

  it("falls back when the pool, the organization name or the slug is missing", async () => {
    results.push(
      { data: null, error: null },
      { data: { name: "Merdeka Open", slug: null, organization_id: "org-1", organization: null }, error: null },
    );
    mockPool.mockResolvedValue({ ok: false, error: { message: "down" } });
    mockRecipients.mockResolvedValue(new Map([["o@kl.test", { email: "o@kl.test", name: "Hafiz" }]]));

    await onTournamentListed("t-1");
    await runAfterCallbacks();

    expect(mockSendListed).toHaveBeenCalledWith("o@kl.test", expect.objectContaining({
      orgName: "your organization",
      tournamentUrl: null,
      fundedCents: 0,
    }));
  });

  it.each([
    ["the tournament can't be loaded", { data: null, error: { message: "down" } }],
    ["the tournament is gone", { data: null, error: null }],
    ["the tournament has no organization", {
      data: { name: "X", slug: null, organization_id: null, organization: null },
      error: null,
    }],
  ])("sends nothing when %s", async (_label, row) => {
    results.push({ data: null, error: null }, row);
    await onTournamentListed("t-1");
    await runAfterCallbacks();
    expect(mockRecipients).not.toHaveBeenCalled();
    expect(mockSendListed).not.toHaveBeenCalled();
  });

  it("logs a failure to send instead of throwing", async () => {
    results.push(
      { data: null, error: null },
      { data: null, error: null },
      { data: { name: "X", slug: "x", organization_id: "org-1", organization: null }, error: null },
      { data: { name: "X", slug: "x", organization_id: "org-1", organization: null }, error: null },
    );
    mockPool.mockResolvedValue({ ok: true, position: { funded_cents: 1 } });
    mockRecipients.mockRejectedValueOnce(new Error("db down")).mockRejectedValueOnce("plain");

    await onTournamentListed("t-1");
    await onTournamentListed("t-1");
    await runAfterCallbacks();

    expect(console.error).toHaveBeenCalledWith("Tournament t-1: failed to send the listed email", "db down");
    expect(console.error).toHaveBeenCalledWith("Tournament t-1: failed to send the listed email", "plain");
  });
});

describe("sweepPrizeFundingRequests", () => {
  it("reconciles every pending tournament, then links anything left over", async () => {
    mockRpc
      .mockResolvedValueOnce({
        data: { created: [], cancelled: [], missing_contacts: [], released: true },
        error: null,
      })
      .mockResolvedValueOnce({ data: null, error: { message: "locked" } });
    results.push(
      { data: [{ id: "t-1" }, { id: "t-2" }], error: null },
      { data: [], error: null },
      { data: { slug: "t-one" }, error: null },
      { data: [], error: null },
    );

    const stats = await sweepPrizeFundingRequests();

    expect(calls[0]).toMatchObject({ table: "tournaments", filters: { "eq:status": "pending_funding" } });
    expect(mockRpc).toHaveBeenCalledTimes(2);
    expect(stats).toEqual({ tournaments: 1, linked: 0, unlinked: 0, released: 1 });
  });

  it("throws when it can't list its work", async () => {
    results.push({ data: null, error: { message: "down" } });
    await expect(sweepPrizeFundingRequests()).rejects.toThrow(/pending funding/);
  });
});
