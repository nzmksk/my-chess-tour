// @vitest-environment jsdom
import React from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import AdminPayoutsClient from "../AdminPayoutsClient";
import type { AdminPayoutCandidate } from "@/services/payouts/admin-queue";

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
