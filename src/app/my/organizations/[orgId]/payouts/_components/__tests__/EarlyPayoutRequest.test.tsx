// @vitest-environment jsdom
import React from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import EarlyPayoutRequest from "../EarlyPayoutRequest";

const mockRefresh = vi.fn();
vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: mockRefresh }),
}));

const mockFetch = vi.fn();
vi.stubGlobal("fetch", mockFetch);

const ORG_ID = "bbbbbbbb-0000-4000-8000-000000000001";
const T_ID = "cccccccc-0000-4000-8000-000000000001";

function renderPanel(props: Partial<React.ComponentProps<typeof EarlyPayoutRequest>> = {}) {
  render(
    <EarlyPayoutRequest
      orgId={ORG_ID}
      tournamentId={T_ID}
      capCents={500000}
      requestsUsed={0}
      blocked={null}
      canRequest
      {...props}
    />,
  );
}

function openForm() {
  fireEvent.click(screen.getByRole("button", { name: "Request early payout" }));
  return {
    amount: screen.getByLabelText("Amount (RM)"),
    reason: screen.getByLabelText("What is it for?"),
    send: screen.getByRole("button", { name: "Send request" }) as HTMLButtonElement,
  };
}

beforeEach(() => {
  mockFetch.mockResolvedValue({
    ok: true,
    json: async () => ({ data: { payout_id: "p1" } }),
  });
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("EarlyPayoutRequest", () => {
  it("says how much can be asked for, and how many requests are used", () => {
    renderPanel({ requestsUsed: 1 });
    expect(screen.getByText(/1 of 2 used/)).toBeTruthy();
    expect(screen.getByText("RM 5,000.00")).toBeTruthy();
  });

  it("explains why nothing can be requested, with no button", () => {
    renderPanel({ blocked: "Early payouts open once registration has closed." });
    expect(screen.getByText(/registration has closed/)).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Request early payout" })).toBeNull();
  });

  it("tells a non-owner that an owner can request it", () => {
    renderPanel({ canRequest: false });
    expect(screen.getByText(/An organization owner can request it/)).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Request early payout" })).toBeNull();
  });

  it.each([
    ["5000.01", /more than the RM 5,000\.00/],
    ["9.99", /minimum payout is RM 10\.00/],
    ["0", /Enter an amount/],
  ])("refuses %s on the spot", (value, expected) => {
    renderPanel();
    const { amount, reason, send } = openForm();
    fireEvent.change(reason, { target: { value: "Venue deposit" } });
    fireEvent.change(amount, { target: { value } });
    expect(screen.getByRole("alert").textContent).toMatch(expected);
    expect(send.disabled).toBe(true);
  });

  it("needs a reason", () => {
    renderPanel();
    const { amount, send } = openForm();
    fireEvent.change(amount, { target: { value: "2500" } });
    expect(send.disabled).toBe(true);
  });

  it("sends the request in cents with a trimmed reason", async () => {
    renderPanel();
    const { amount, reason, send } = openForm();
    fireEvent.change(amount, { target: { value: "2500.50" } });
    fireEvent.change(reason, { target: { value: "  Venue deposit  " } });
    fireEvent.click(send);

    await waitFor(() => expect(screen.getByRole("status")).toBeTruthy());
    expect(mockFetch).toHaveBeenCalledWith(`/api/v1/organizations/${ORG_ID}/payouts`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        tournament_id: T_ID,
        amount_cents: 250050,
        reason: "Venue deposit",
      }),
    });
    expect(screen.getByRole("status").textContent).toMatch(/admin will review it/);
    expect(mockRefresh).toHaveBeenCalled();
  });

  it("shows the server's refusal", async () => {
    mockFetch.mockResolvedValue({
      ok: false,
      json: async () => ({
        error: { message: "An early payout for this tournament is already waiting for review or being sent." },
      }),
    });
    renderPanel();
    const { amount, reason, send } = openForm();
    fireEvent.change(amount, { target: { value: "100" } });
    fireEvent.change(reason, { target: { value: "Deposit" } });
    fireEvent.click(send);
    await waitFor(() =>
      expect(screen.getByRole("alert").textContent).toMatch(/already waiting/),
    );
    expect(mockRefresh).not.toHaveBeenCalled();
  });
});
