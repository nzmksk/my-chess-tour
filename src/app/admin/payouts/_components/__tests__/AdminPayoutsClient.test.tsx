// @vitest-environment jsdom
import React from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import AdminPayoutsClient from "../AdminPayoutsClient";
import type { AdminPayout, AdminPayoutCandidate } from "@/services/payouts/admin-queue";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: vi.fn() }),
}));

const mockFetch = vi.fn();
vi.stubGlobal("fetch", mockFetch);

afterEach(() => {
  cleanup();
  vi.resetAllMocks();
});

const CANDIDATE: AdminPayoutCandidate = {
  tournament_id: "aaaaaaaa-0000-0000-0000-000000000001",
  tournament_name: "Selangor Open",
  end_date: "2026-11-01",
  organizer: "Org",
  recipient: "Org",
  is_beneficiary: false,
  available_cents: 6400,
  blocked: null,
};

function renderClient() {
  render(
    <AdminPayoutsClient data={{ candidates: [CANDIDATE], payouts: [] }} />,
  );
  return {
    input: screen.getByLabelText("Amount (RM)"),
    payOut: screen.getByRole("button", { name: "Pay Out" }),
  };
}

describe("AdminPayoutsClient amount", () => {
  it.each([
    ["100", /more than the RM 64\.00 available/],
    ["9.99", /minimum payout is RM 10\.00/],
    ["0", /Enter an amount/],
    ["-5", /Enter an amount/],
  ])(
    "refuses %s on the spot, without calling the server",
    (value, expected) => {
      const { input, payOut } = renderClient();
      fireEvent.change(input, { target: { value } });

      expect(screen.getByRole("alert").textContent).toMatch(expected);
      expect(input.getAttribute("aria-invalid")).toBe("true");
      expect((payOut as HTMLButtonElement).disabled).toBe(true);
      fireEvent.click(payOut);
      expect(screen.queryByText("Confirm Payout")).toBeNull();
      expect(mockFetch).not.toHaveBeenCalled();
    },
  );

  it.each(["64", "10", "32.50"])(
    "lets %s through to the confirmation",
    (value) => {
      const { input, payOut } = renderClient();
      fireEvent.change(input, { target: { value } });

      expect(screen.queryByRole("alert")).toBeNull();
      expect((payOut as HTMLButtonElement).disabled).toBe(false);
      fireEvent.click(payOut);
      expect(screen.queryByText("Confirm Payout")).not.toBeNull();
    },
  );

  it("pays the full amount when left blank", () => {
    const { payOut } = renderClient();

    expect((payOut as HTMLButtonElement).disabled).toBe(false);
    fireEvent.click(payOut);
    expect(screen.getByText(/moves real money/).textContent).toMatch(
      /^Send RM 64\.00 to Org\?/,
    );
  });
});

describe("AdminPayoutsClient early payouts", () => {
  const EARLY: AdminPayout = {
    id: "bbbbbbbb-0000-0000-0000-000000000001",
    kind: "early",
    status: "pending",
    approval: "pending",
    amount_cents: 250000,
    failure_reason: null,
    receipt_url: null,
    awaiting_budget: false,
    can_resend: false,
    requested_at: "2026-11-01T00:00:00Z",
    processed_at: null,
    tournament: { id: "t1", name: "Selangor Open" },
    organizer: { id: "o1", name: "Org" },
    recipient: { id: "o1", name: "Org" },
    is_beneficiary: false,
    bank: null,
  };

  it("labels a request waiting for review and links to it", () => {
    render(<AdminPayoutsClient data={{ candidates: [], payouts: [EARLY] }} />);
    expect(screen.getByText("Awaiting review")).toBeTruthy();
    expect(
      screen.getByRole("link", { name: "Review request →" }).getAttribute("href"),
    ).toBe(`/admin/payouts/${EARLY.id}`);
  });

  it("labels a rejected request as rejected, not pending", () => {
    render(
      <AdminPayoutsClient
        data={{ candidates: [], payouts: [{ ...EARLY, approval: "rejected" }] }}
      />,
    );
    expect(screen.getByText("Rejected")).toBeTruthy();
    expect(screen.getByRole("link", { name: "View request" })).toBeTruthy();
  });

  it("offers a retry on a payout that can be re-sent, and says what happened", async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      json: async () => ({ data: { outcome: "awaiting_budget" } }),
    });
    render(
      <AdminPayoutsClient
        data={{
          candidates: [],
          payouts: [
            { ...EARLY, kind: "automatic", approval: "approved", can_resend: true },
            { ...EARLY, id: "other", approval: "approved" },
          ],
        }}
      />,
    );
    const buttons = screen.getAllByRole("button", { name: "Retry send" });
    expect(buttons).toHaveLength(1);
    fireEvent.click(buttons[0]);
    await waitFor(() => expect(screen.getByRole("status")).toBeTruthy());
    expect(mockFetch).toHaveBeenCalledWith(`/api/v1/admin/payouts/${EARLY.id}/send`, {
      method: "POST",
    });
    expect(screen.getByRole("status").textContent).toMatch(/Still waiting on CHIP Send budget/);
  });

  it("gives automatic payouts no review link", () => {
    render(
      <AdminPayoutsClient
        data={{
          candidates: [],
          payouts: [{ ...EARLY, kind: "automatic", approval: "approved" }],
        }}
      />,
    );
    expect(screen.queryByRole("link", { name: /request/ })).toBeNull();
  });
});
