// @vitest-environment jsdom
import React from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import AdminPrizesClient from "../AdminPrizesClient";
import type { PrizeAwardView } from "@/services/prizes/awards";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: vi.fn() }),
}));

const mockFetch = vi.fn();
vi.stubGlobal("fetch", mockFetch);

afterEach(() => {
  cleanup();
  vi.resetAllMocks();
});

function award(overrides: Partial<PrizeAwardView> = {}): PrizeAwardView {
  return {
    id: "award-1",
    tournament_id: "t-1",
    tournament_name: "Merdeka Open",
    organization_name: "KL Chess",
    user_id: "user-1",
    winner_name: "Aisyah Rahman",
    category: "Open",
    place: "1st",
    amount_cents: 30000,
    settled_amount_cents: null,
    approval: "pending",
    status: "pending",
    rejection_reason: null,
    failure_reason: null,
    chip_receipt_url: null,
    entered_at: "2026-11-15T10:00:00Z",
    reviewed_at: null,
    processed_at: null,
    winner_bank_status: null,
    ...overrides,
  };
}

describe("AdminPrizesClient", () => {
  it("lists an award to review with the winner, prize and bank state", () => {
    render(<AdminPrizesClient awards={[award()]} />);
    expect(screen.getByText("To Review (1)")).toBeTruthy();
    expect(screen.getByText("Aisyah Rahman")).toBeTruthy();
    expect(screen.getByText(/Open — 1st · RM 300.00/)).toBeTruthy();
    expect(screen.getByText(/No bank account/)).toBeTruthy();
  });

  it("shows the bank's holder name for the winner's account, and links a mismatch to review", () => {
    render(
      <AdminPrizesClient
        awards={[
          award({
            winner_bank_status: "name_mismatch",
            winner_bank_holder_name: "SOMEONE ELSE",
            winner_bank_name_check: "mismatch",
          }),
        ]}
      />,
    );
    expect(screen.getByText(/waiting for review/)).toBeTruthy();
    expect(screen.getByText(/SOMEONE ELSE/)).toBeTruthy();
    expect(screen.getByText("(doesn't match)")).toBeTruthy();
    expect(screen.getByRole("link", { name: "Review →" }).getAttribute("href")).toBe("/admin/bank-accounts");
  });

  it("approves and reports what the send came to", async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      json: async () => ({ data: { outcome: "blocked" } }),
    });
    render(<AdminPrizesClient awards={[award()]} />);

    fireEvent.click(screen.getByRole("button", { name: "Approve and send" }));

    await waitFor(() =>
      expect(screen.getByText(/goes out once the winner has a verified bank account/)).toBeTruthy(),
    );
    expect(mockFetch).toHaveBeenCalledWith(
      "/api/v1/admin/prize-awards/award-1",
      expect.objectContaining({ method: "PATCH", body: JSON.stringify({ action: "approve" }) }),
    );
  });

  it("needs a reason to reject", async () => {
    mockFetch.mockResolvedValue({ ok: true, json: async () => ({ data: {} }) });
    render(<AdminPrizesClient awards={[award()]} />);

    fireEvent.click(screen.getByRole("button", { name: "Reject" }));
    const confirm = screen.getByRole("button", { name: "Confirm rejection" }) as HTMLButtonElement;
    expect(confirm.disabled).toBe(true);

    fireEvent.change(screen.getByLabelText(/Reason/), { target: { value: "Wrong player" } });
    fireEvent.click(confirm);

    await waitFor(() => expect(mockFetch).toHaveBeenCalled());
    expect(JSON.parse(mockFetch.mock.calls[0][1].body)).toEqual({
      action: "reject",
      rejection_reason: "Wrong player",
    });
  });

  it("shows the server's refusal", async () => {
    mockFetch.mockResolvedValue({
      ok: false,
      json: async () => ({ error: { message: "The prize pool isn't fully funded yet." } }),
    });
    render(<AdminPrizesClient awards={[award()]} />);
    fireEvent.click(screen.getByRole("button", { name: "Approve and send" }));
    await waitFor(() => expect(screen.getByText("The prize pool isn't fully funded yet.")).toBeTruthy());
  });

  it("offers a retry for an approved award that hasn't gone out", () => {
    render(
      <AdminPrizesClient
        awards={[award({ approval: "approved", reviewed_at: "2026-11-16T00:00:00Z", winner_bank_status: "pending" })]}
      />,
    );
    expect(screen.getByText("Approved, Not Yet Paid (1)")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Retry send" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Approve and send" })).toBeNull();
  });

  it("files paid and rejected awards as settled", () => {
    render(
      <AdminPrizesClient
        awards={[
          award({ id: "a1", approval: "approved", status: "paid", processed_at: "2026-11-17T00:00:00Z" }),
          award({ id: "a2", approval: "rejected", rejection_reason: "Wrong player" }),
        ]}
      />,
    );
    expect(screen.getByText("To Review (0)")).toBeTruthy();
    expect(screen.getByText("Paid")).toBeTruthy();
    expect(screen.getByText("Rejected: Wrong player")).toBeTruthy();
  });
});
