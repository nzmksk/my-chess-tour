// @vitest-environment jsdom
import React from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import PayoutReviewClient from "../PayoutReviewClient";
import type { PayoutReview } from "@/services/payouts/review";

const mockRefresh = vi.fn();
vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: mockRefresh }),
}));

const mockFetch = vi.fn();
vi.stubGlobal("fetch", mockFetch);

const ID = "bbbbbbbb-0000-0000-0000-000000000001";

function makeReview(overrides: Partial<PayoutReview> = {}): PayoutReview {
  return {
    id: ID,
    kind: "early",
    approval: "pending",
    status: "pending",
    amount_cents: 400000,
    settled_amount_cents: null,
    request_seq: 1,
    reason: "Venue deposit",
    rejection_reason: null,
    failure_reason: null,
    requested_at: "2026-11-01T02:00:00Z",
    reviewed_at: null,
    requested_by: { name: "Olivia Tan", email: "olivia@club.test" },
    reviewed_by: null,
    tournament: {
      id: "t1",
      name: "Selangor Open",
      status: "published",
      start_date: "2026-12-01",
      end_date: "2026-12-02",
      registration_closed_at: "2026-11-01T00:00:00Z",
    },
    organization: {
      id: "o1",
      name: "Selangor Chess",
      approval_status: "approved",
      entity_type: "society",
      registration_number: "PPM-001",
      agreement_version: "2026-08-02",
      agreement_accepted_at: "2026-08-03T00:00:00Z",
      agreement_current: true,
    },
    bank_account: {
      bank_name: "Maybank",
      account_holder: "Selangor Chess",
      account_number_last4: "1234",
      status: "verified",
      is_active: true,
    },
    documents: [
      { id: "d1", doc_type: "ros", original_filename: "ros.pdf", url: "https://signed.test/ros" },
    ],
    cap: {
      net_revenue_cents: 1000000,
      paid_payouts_cents: 100000,
      live_refund_cents: 0,
      max_pct: 50,
      ceiling_cents: 500000,
      early_committed_cents: 100000,
      available_cents: 900000,
      cap_cents: 400000,
    },
    approval_blocked: null,
    ...overrides,
  };
}

beforeEach(() => {
  mockFetch.mockResolvedValue({
    ok: true,
    json: async () => ({ data: { approval: "approved", outcome: "sent" } }),
  });
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("PayoutReviewClient", () => {
  it("spells out the cap arithmetic", () => {
    render(<PayoutReviewClient review={makeReview()} />);
    expect(screen.getByText("50% early payout ceiling")).toBeTruthy();
    expect(screen.getByText("RM 5,000.00")).toBeTruthy();
    expect(screen.getByText("Left within the ceiling")).toBeTruthy();
    expect(screen.getByText(/the lesser of the two/)).toBeTruthy();
    expect(screen.getByText(/within the cap/)).toBeTruthy();
  });

  it("shows the request count, recipient, last 4 digits and documents", () => {
    render(<PayoutReviewClient review={makeReview()} />);
    expect(screen.getByText("1 of 2")).toBeTruthy();
    expect(screen.getByText("•••• 1234")).toBeTruthy();
    expect(screen.getByText("Verified")).toBeTruthy();
    expect(screen.getByRole("link", { name: "ros.pdf" }).getAttribute("href")).toBe(
      "https://signed.test/ros",
    );
  });

  it("flags a stale agreement and an unverified account", () => {
    render(
      <PayoutReviewClient
        review={makeReview({
          organization: { ...makeReview().organization, agreement_current: false },
          bank_account: { ...makeReview().bank_account!, status: "pending" },
        })}
      />,
    );
    expect(screen.getByText(/not the current version/)).toBeTruthy();
    expect(screen.getByText("Awaiting verification")).toBeTruthy();
  });

  it("approves and reports what the send did", async () => {
    render(<PayoutReviewClient review={makeReview()} />);
    fireEvent.click(screen.getByRole("button", { name: /Approve and pay/ }));

    await waitFor(() => expect(screen.getByRole("status")).toBeTruthy());
    expect(mockFetch).toHaveBeenCalledWith(`/api/v1/admin/payouts/${ID}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "approve" }),
    });
    expect(screen.getByRole("status").textContent).toMatch(/sent to CHIP/);
    expect(mockRefresh).toHaveBeenCalled();
  });

  it("says when an approved payout is parked on budget", async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      json: async () => ({ data: { outcome: "awaiting_budget" } }),
    });
    render(<PayoutReviewClient review={makeReview()} />);
    fireEvent.click(screen.getByRole("button", { name: /Approve and pay/ }));
    await waitFor(() =>
      expect(screen.getByRole("status").textContent).toMatch(/balance is too low/),
    );
  });

  it("disables approval, and says why, when the request can't be approved now", () => {
    render(
      <PayoutReviewClient
        review={makeReview({ approval_blocked: "A cancellation request is under review." })}
      />,
    );
    const approve = screen.getByRole("button", { name: /Approve and pay/ }) as HTMLButtonElement;
    expect(approve.disabled).toBe(true);
    expect(screen.getByRole("alert").textContent).toMatch(/cancellation request/);
  });

  it("requires a reason to reject, then sends it trimmed", async () => {
    mockFetch.mockResolvedValue({ ok: true, json: async () => ({ data: {} }) });
    render(<PayoutReviewClient review={makeReview()} />);
    fireEvent.click(screen.getByRole("button", { name: "Reject" }));
    fireEvent.click(screen.getByRole("button", { name: "Confirm Rejection" }));
    expect(screen.getByText("Please provide a rejection reason.")).toBeTruthy();
    expect(mockFetch).not.toHaveBeenCalled();

    fireEvent.change(screen.getByLabelText("Rejection Reason"), {
      target: { value: "  Send the invoice  " },
    });
    fireEvent.click(screen.getByRole("button", { name: "Confirm Rejection" }));
    await waitFor(() => expect(mockFetch).toHaveBeenCalled());
    expect(JSON.parse(mockFetch.mock.calls[0][1].body)).toEqual({
      action: "reject",
      rejection_reason: "Send the invoice",
    });
  });

  it("shows the server's refusal", async () => {
    mockFetch.mockResolvedValue({
      ok: false,
      json: async () => ({ error: { message: "This payout request has already been reviewed" } }),
    });
    render(<PayoutReviewClient review={makeReview()} />);
    fireEvent.click(screen.getByRole("button", { name: /Approve and pay/ }));
    await waitFor(() =>
      expect(screen.getByRole("alert").textContent).toMatch(/already been reviewed/),
    );
  });

  it("shows a reviewed request without the review actions", () => {
    render(
      <PayoutReviewClient
        review={makeReview({
          approval: "rejected",
          rejection_reason: "Send the invoice",
          reviewed_at: "2026-11-02T00:00:00Z",
          reviewed_by: { name: "Hafiz" },
        })}
      />,
    );
    expect(screen.queryByRole("button", { name: /Approve/ })).toBeNull();
    expect(screen.getByText("Send the invoice")).toBeTruthy();
  });
});
