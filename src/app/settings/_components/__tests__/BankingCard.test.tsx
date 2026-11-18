// @vitest-environment jsdom
import React from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";

const mockFetch = vi.fn();
vi.stubGlobal("fetch", mockFetch);

import BankingCard from "../BankingCard";

function renderWithDetails() {
  render(
    <BankingCard
      bankName="Maybank"
      bankCode="MBBEMYKL"
      accountHolder="Ahmad bin Ali"
      accountNumberLast4="7890"
      status="verified"
      rejectionReason={null}
    />,
  );
}

describe("BankingCard — withdrawing financial data consent (#451)", () => {
  beforeEach(() => {
    mockFetch.mockReset();
  });
  afterEach(cleanup);

  it("removes the details after confirmation, which withdraws consent", async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ data: null }),
    });
    renderWithDetails();

    fireEvent.click(
      screen.getByRole("button", { name: /remove bank details/i }),
    );
    // Nothing is sent until the player confirms.
    expect(mockFetch).not.toHaveBeenCalled();
    fireEvent.click(
      screen.getByRole("button", { name: "Remove and withdraw consent" }),
    );

    await waitFor(() => expect(mockFetch).toHaveBeenCalledTimes(1));
    const [url, init] = mockFetch.mock.calls[0];
    expect(url).toBe("/api/v1/profile/banking");
    expect(init.method).toBe("PATCH");
    expect(JSON.parse(init.body)).toEqual({
      bank_code: null,
      account_holder: null,
      account_number: null,
    });
    expect(
      await screen.findByRole("button", { name: "Add banking details" }),
    ).toBeTruthy();
    expect(screen.queryByText(/7890/)).toBe(null);
  });

  it("keeps the details when the player backs out", () => {
    renderWithDetails();
    fireEvent.click(
      screen.getByRole("button", { name: /remove bank details/i }),
    );
    fireEvent.click(screen.getByRole("button", { name: "Keep my details" }));
    expect(mockFetch).not.toHaveBeenCalled();
    expect(screen.getByText(/7890/)).toBeTruthy();
  });

  it("shows the error and keeps the details when removal fails", async () => {
    mockFetch.mockResolvedValue({
      ok: false,
      status: 500,
      json: async () => ({ error: { message: "Try again later." } }),
    });
    renderWithDetails();
    fireEvent.click(
      screen.getByRole("button", { name: /remove bank details/i }),
    );
    fireEvent.click(
      screen.getByRole("button", { name: "Remove and withdraw consent" }),
    );
    expect(await screen.findByText("Try again later.")).toBeTruthy();
    expect(screen.getByText(/7890/)).toBeTruthy();
  });
});
