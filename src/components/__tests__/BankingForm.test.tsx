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
import { currentConsent } from "@/lib/reference/legal";

const mockFetch = vi.fn();
vi.stubGlobal("fetch", mockFetch);

import BankingForm from "../BankingForm";

function ok(body: unknown) {
  return { ok: true, status: 200, json: async () => body };
}

const SAVED = {
  bank_name: "Maybank",
  bank_code: "MBBEMYKL",
  account_holder: "Ahmad bin Ali",
  account_number_last4: "7890",
  status: "pending",
  rejection_reason: null,
};

function fillValidDetails() {
  fireEvent.change(screen.getByLabelText("Bank"), {
    target: { value: "MBBEMYKL" },
  });
  fireEvent.change(screen.getByLabelText("Account Holder Name"), {
    target: { value: "Ahmad bin Ali" },
  });
  fireEvent.change(screen.getByLabelText("Account Number"), {
    target: { value: "1234567890" },
  });
}

const consentBox = () =>
  screen.getByRole("checkbox", {
    name: new RegExp(currentConsent("financial").statement.slice(0, 40)),
  });
const saveButton = () => screen.getByRole("button", { name: "Save" });

describe("BankingForm — financial data consent (#451)", () => {
  beforeEach(() => {
    mockFetch.mockReset();
  });
  afterEach(cleanup);

  it("shows the current consent statement, unticked", () => {
    render(<BankingForm onSaved={vi.fn()} />);
    expect((consentBox() as HTMLInputElement).checked).toBe(false);
  });

  it("can't save until consent is ticked", () => {
    render(<BankingForm onSaved={vi.fn()} />);
    fillValidDetails();
    expect((saveButton() as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(consentBox());
    expect((saveButton() as HTMLButtonElement).disabled).toBe(false);
  });

  it("records consent before sending the details", async () => {
    mockFetch
      .mockResolvedValueOnce(ok({ data: { changed: true } }))
      .mockResolvedValueOnce(ok({ data: SAVED }));
    const onSaved = vi.fn();
    render(<BankingForm onSaved={onSaved} />);
    fillValidDetails();
    fireEvent.click(consentBox());
    fireEvent.click(saveButton());

    await waitFor(() => expect(onSaved).toHaveBeenCalled());
    expect(mockFetch).toHaveBeenCalledTimes(2);
    expect(mockFetch.mock.calls[0][0]).toBe("/api/v1/profile/consents");
    expect(JSON.parse(mockFetch.mock.calls[0][1].body)).toEqual({
      category: "financial",
    });
    expect(mockFetch.mock.calls[1][0]).toBe("/api/v1/profile/banking");
  });

  it("does not send the details when consent can't be recorded", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: false,
      status: 500,
      json: async () => ({ error: { message: "Try again later." } }),
    });
    const onSaved = vi.fn();
    render(<BankingForm onSaved={onSaved} />);
    fillValidDetails();
    fireEvent.click(consentBox());
    fireEvent.click(saveButton());

    expect(await screen.findByText("Try again later.")).toBeTruthy();
    expect(mockFetch).toHaveBeenCalledTimes(1);
    expect(onSaved).not.toHaveBeenCalled();
  });
});
