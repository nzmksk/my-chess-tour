// @vitest-environment jsdom
import React from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import StuckRefundsClient from "../StuckRefundsClient";
import type { StuckRefund } from "@/services/refunds/stuck";

const mockRefresh = vi.fn();
vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: mockRefresh }),
}));

const mockFetch = vi.fn();
vi.stubGlobal("fetch", mockFetch);

afterEach(() => {
  cleanup();
  vi.resetAllMocks();
});

function refund(overrides: Partial<StuckRefund> = {}): StuckRefund {
  return {
    refund_id: "aaaaaaaa-0000-0000-0000-000000000001",
    registration_id: "reg-1",
    tournament_id: "t-1",
    tournament_name: "KL Open",
    payer_name: "Aina Tan",
    payer_email: "aina@example.com",
    amount_cents: 5500,
    requested_at: "2026-11-01T02:00:00Z",
    last_fired_at: null,
    failed_at: null,
    original_chip_purchase_id: "purchase-1",
    ...overrides,
  };
}

function answer(status: number, body: unknown) {
  mockFetch.mockResolvedValue({ ok: status < 400, status, json: async () => body });
}

describe("StuckRefundsClient", () => {
  it("says so when nothing is stuck", () => {
    render(<StuckRefundsClient refunds={[]} />);
    expect(screen.getByText(/No stuck refunds/)).toBeTruthy();
  });

  it("totals what is owed", () => {
    render(
      <StuckRefundsClient
        refunds={[
          refund(),
          refund({ refund_id: "aaaaaaaa-0000-0000-0000-000000000002", amount_cents: 4500 }),
        ]}
      />,
    );
    expect(screen.getByText(/2 refunds · RM 100\.00 owed/)).toBeTruthy();
  });

  it.each([
    ["Never sent", {}],
    ["No answer", { last_fired_at: "2026-11-01T03:00:00Z" }],
    ["Failed", { last_fired_at: "2026-11-01T03:00:00Z", failed_at: "2026-11-01T03:01:00Z" }],
    ["No CHIP purchase", { original_chip_purchase_id: null }],
  ])("labels a refund %s", (label, overrides) => {
    render(<StuckRefundsClient refunds={[refund(overrides)]} />);
    expect(screen.getByText(label)).toBeTruthy();
  });

  it("offers no retry when there is no CHIP purchase", () => {
    render(<StuckRefundsClient refunds={[refund({ original_chip_purchase_id: null })]} />);
    expect(screen.queryByRole("button", { name: "Retry refund" })).toBeNull();
  });

  it("re-fires the refund and keeps the outcome once the refund leaves the list", async () => {
    answer(200, { data: { outcome: "reconciled" } });
    const { rerender } = render(<StuckRefundsClient refunds={[refund()]} />);

    fireEvent.click(screen.getByRole("button", { name: "Retry refund" }));

    await waitFor(() =>
      expect(mockFetch).toHaveBeenCalledWith(
        "/api/v1/admin/refunds/aaaaaaaa-0000-0000-0000-000000000001/refire",
        { method: "POST" },
      ),
    );
    await waitFor(() => expect(screen.getByText(/CHIP had already refunded/)).toBeTruthy());
    expect(mockRefresh).toHaveBeenCalled();

    // The refresh drops the settled refund from the list; the result stays.
    rerender(<StuckRefundsClient refunds={[]} />);
    expect(screen.getByText("Just retried")).toBeTruthy();
    expect(screen.getByText("Aina Tan · KL Open")).toBeTruthy();
    expect(screen.getByText(/CHIP had already refunded/)).toBeTruthy();
  });

  it("shows why a retry did nothing", async () => {
    answer(200, { data: { outcome: "in_flight" } });
    render(<StuckRefundsClient refunds={[refund()]} />);

    fireEvent.click(screen.getByRole("button", { name: "Retry refund" }));

    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toMatch(/sent to CHIP in the last 15 minutes/);
  });

  it("shows the server's message when the retry is refused", async () => {
    answer(404, { error: { message: "Refund not found" } });
    render(<StuckRefundsClient refunds={[refund()]} />);

    fireEvent.click(screen.getByRole("button", { name: "Retry refund" }));

    expect((await screen.findByRole("alert")).textContent).toBe("Refund not found");
    expect(mockRefresh).not.toHaveBeenCalled();
  });
});
