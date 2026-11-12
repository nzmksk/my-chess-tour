// @vitest-environment jsdom
import React from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import PayoutsClient, {
  type PayoutHistoryItem,
  type PayoutTournament,
  type PayoutsData,
} from "../PayoutsClient";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: vi.fn() }),
}));

afterEach(cleanup);

const ORG_ID = "bbbbbbbb-0000-4000-8000-000000000001";

const TOURNAMENT: PayoutTournament = {
  tournament_id: "t1",
  name: "KL Open",
  status: "published",
  organizer: "KL Chess",
  recipient: { organization_id: ORG_ID, name: "KL Chess", problem: null },
  is_beneficiary: false,
  net_revenue_cents: 1000000,
  paid_payouts_cents: 0,
  available_cents: 1000000,
  early_requests_used: 0,
  early_payout: { cap_cents: 500000, blocked: null },
};

const EARLY: PayoutHistoryItem = {
  id: "p1",
  tournament_id: "t1",
  tournament_name: "KL Open",
  kind: "early",
  amount_cents: 250000,
  status: "pending",
  approval: "pending",
  reason: "Venue deposit",
  rejection_reason: null,
  failure_reason: null,
  receipt_url: null,
  requested_at: "2026-11-01T00:00:00Z",
  processed_at: null,
  is_beneficiary: false,
};

function renderClient(data: Partial<PayoutsData> = {}) {
  render(
    <PayoutsClient
      orgId={ORG_ID}
      data={{
        tournaments: [TOURNAMENT],
        payouts: [],
        can_request_early_payout: true,
        ...data,
      }}
    />,
  );
}

describe("PayoutsClient early payouts", () => {
  it("offers an owner an early payout on a tournament they organized", () => {
    renderClient();
    expect(screen.getByRole("button", { name: "Request early payout" })).toBeTruthy();
  });

  it("offers nothing on a tournament received as beneficiary", () => {
    renderClient({
      tournaments: [{ ...TOURNAMENT, is_beneficiary: true, early_payout: null }],
    });
    expect(screen.queryByText(/Early payout ·/)).toBeNull();
  });

  it("labels a request waiting for review, with its reason", () => {
    renderClient({ payouts: [EARLY] });
    expect(screen.getByText("Awaiting review")).toBeTruthy();
    expect(screen.getByText("For: Venue deposit")).toBeTruthy();
  });

  it("labels a declined request and says why", () => {
    renderClient({
      payouts: [{ ...EARLY, approval: "rejected", rejection_reason: "Send the invoice" }],
    });
    expect(screen.getByText("Declined")).toBeTruthy();
    expect(screen.getByText("Declined: Send the invoice")).toBeTruthy();
  });
});
