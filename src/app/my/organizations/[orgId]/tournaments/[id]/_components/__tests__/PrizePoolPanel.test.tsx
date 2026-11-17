// @vitest-environment jsdom
import React from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import PrizePoolPanel, { declaredPrizes } from "../PrizePoolPanel";
import type { PrizesJson } from "@/lib/tournaments/prize-funding";

const mockFetch = vi.fn();
vi.stubGlobal("fetch", mockFetch);

afterEach(() => {
  cleanup();
  vi.resetAllMocks();
});

const PRIZES: PrizesJson = {
  categories: [
    {
      name: "Open",
      entries: [
        { place: "1st", amount_cents: 30000 },
        { place: "2nd", amount_cents: 15000 },
        { place: "3rd", amount_cents: 0 },
      ],
    },
  ],
  special: [{ name: "Best Junior", amount_cents: 5000 }, { name: "Placeholder" }],
  distribution: "platform",
};

const pool = (funded: number) => ({
  distribution: "platform",
  declared_cents: 50000,
  funded_cents: funded,
  paid_out_cents: 0,
  balance_cents: funded,
  reserved_cents: 0,
  pending_review_cents: 0,
  available_cents: funded,
  fully_funded: funded >= 50000,
});

function respond(funded: number, fundings: unknown[] = [], awards: unknown[] = []) {
  mockFetch.mockImplementation(async (url: string, init?: RequestInit) => {
    if (init?.method === "POST") {
      return {
        ok: true,
        json: async () => ({ data: { id: "f-1", checkout_url: "https://gate.chip-in.asia/p/1" } }),
      };
    }
    if (url.endsWith("/prize-funding")) {
      return { ok: true, json: async () => ({ data: { pool: pool(funded), fundings } }) };
    }
    return { ok: true, json: async () => ({ data: { pool: pool(funded), awards } }) };
  });
}

const PARTICIPANTS = [
  { user_id: "u1", name: "Aisyah Rahman", status: "confirmed" },
  { user_id: "u2", name: "Pending Player", status: "pending_payment" },
];

function renderPanel() {
  render(
    <PrizePoolPanel orgId="org-1" tournamentId="t-1" prizes={PRIZES} participants={PARTICIPANTS} />,
  );
}

describe("declaredPrizes", () => {
  it("lists every prize with money on it, as enter_prize_award identifies them", () => {
    expect(declaredPrizes(PRIZES)).toEqual([
      { key: "Open|1st", category: "Open", place: "1st", amount_cents: 30000 },
      { key: "Open|2nd", category: "Open", place: "2nd", amount_cents: 15000 },
      { key: "Best Junior|", category: "Best Junior", place: null, amount_cents: 5000 },
    ]);
  });
});

describe("PrizePoolPanel", () => {
  it("says registration waits for the rest of the pool", async () => {
    respond(20000);
    renderPanel();
    await waitFor(() => expect(screen.getByText(/RM 300.00 still to come/)).toBeTruthy());
    expect(screen.getByRole("button", { name: "Create payment link" })).toBeTruthy();
  });

  it("hides the funding form once the pool is funded", async () => {
    respond(50000);
    renderPanel();
    await waitFor(() => expect(screen.getByText(/fully funded, so registration is open/)).toBeTruthy());
    expect(screen.queryByRole("button", { name: "Create payment link" })).toBeNull();
  });

  it("creates a payment link for a sponsor and shows it", async () => {
    respond(20000);
    renderPanel();
    await screen.findByRole("button", { name: "Create payment link" });

    fireEvent.change(screen.getByLabelText("Sponsor name"), { target: { value: "Acme" } });
    fireEvent.change(screen.getByLabelText("Sponsor email"), { target: { value: "a@acme.test" } });
    fireEvent.click(screen.getByRole("button", { name: "Create payment link" }));

    await waitFor(() => expect(screen.getByText("https://gate.chip-in.asia/p/1")).toBeTruthy());
    const post = mockFetch.mock.calls.find(([, init]) => init?.method === "POST")!;
    expect(post[0]).toBe("/api/v1/organizations/org-1/tournaments/t-1/prize-funding");
    expect(JSON.parse(post[1].body)).toEqual({ funder_name: "Acme", funder_email: "a@acme.test" });
  });

  it("offers only confirmed players as winners, and fills the prize's amount", async () => {
    respond(50000);
    renderPanel();
    const winner = (await screen.findByLabelText("Winner")) as HTMLSelectElement;
    expect([...winner.options].map((o) => o.text)).toEqual(["Winner…", "Aisyah Rahman"]);

    fireEvent.change(screen.getByLabelText("Prize"), { target: { value: "Open|2nd" } });
    expect((screen.getByLabelText("Award amount in ringgit") as HTMLInputElement).value).toBe("150.00");
  });

  it("enters a winner", async () => {
    respond(50000);
    renderPanel();
    await screen.findByLabelText("Winner");
    fireEvent.change(screen.getByLabelText("Winner"), { target: { value: "u1" } });
    fireEvent.change(screen.getByLabelText("Prize"), { target: { value: "Best Junior|" } });
    fireEvent.click(screen.getByRole("button", { name: "Enter winner" }));

    await waitFor(() => expect(screen.getByText(/MY Chess Tour will check it/)).toBeTruthy());
    const post = mockFetch.mock.calls.find(
      ([url, init]) => init?.method === "POST" && String(url).endsWith("/prize-awards"),
    )!;
    expect(JSON.parse(post[1].body)).toEqual({
      user_id: "u1",
      category: "Best Junior",
      place: null,
      amount_cents: 5000,
    });
  });

  it("shows why the pool couldn't be loaded", async () => {
    mockFetch.mockResolvedValue({ ok: false, json: async () => ({ error: { message: "Access denied" } }) });
    renderPanel();
    await waitFor(() => expect(screen.getByText("Access denied")).toBeTruthy());
  });
});
