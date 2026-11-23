// @vitest-environment jsdom
import React from "react";
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import BankAccountNotice from "../BankAccountNotice";
import type { BankAccountStatus } from "@/services/payouts/bank-account";

afterEach(cleanup);

const ORG_ID = "bbbbbbbb-0000-0000-0000-000000000001";
const SETTINGS = `/my/organizations/${ORG_ID}/settings`;

function renderNotice(
  bankAccount: {
    status: BankAccountStatus;
    rejection_reason: string | null;
  } | null,
) {
  return render(
    <BankAccountNotice organizationId={ORG_ID} bankAccount={bankAccount} />,
  );
}

describe("BankAccountNotice", () => {
  it("asks for an account when the organization has none", () => {
    renderNotice(null);
    expect(
      screen.getByRole("heading", { name: "No payout bank account" }),
    ).toBeTruthy();
    expect(
      screen
        .getByRole("link", { name: "Add bank account" })
        .getAttribute("href"),
    ).toBe(SETTINGS);
  });

  it("renders nothing for a verified account", () => {
    const { container } = renderNotice({
      status: "verified",
      rejection_reason: null,
    });
    expect(container.innerHTML).toBe("");
  });

  it("tells the organizer nothing is needed while an account is pending", () => {
    renderNotice({ status: "pending", rejection_reason: null });
    expect(screen.getByText(/awaiting verification/)).toBeTruthy();
    expect(
      screen
        .getByRole("link", { name: "Review the details" })
        .getAttribute("href"),
    ).toBe(SETTINGS);
  });

  it("shows the reason for a rejected account", () => {
    renderNotice({ status: "rejected", rejection_reason: "Account closed" });
    expect(
      screen.getByRole("heading", { name: "Payout bank account rejected" }),
    ).toBeTruthy();
    expect(screen.getByText("Account closed")).toBeTruthy();
  });

  it("falls back to a generic message for a rejection without a reason", () => {
    renderNotice({ status: "rejected", rejection_reason: null });
    expect(screen.getByText(/could not be verified/)).toBeTruthy();
  });

  describe("name_mismatch", () => {
    it("warns that payouts are held for review instead of saying nothing is needed", () => {
      renderNotice({ status: "name_mismatch", rejection_reason: null });

      expect(
        screen.getByRole("heading", {
          name: "Payout bank account under review",
        }),
      ).toBeTruthy();
      expect(
        screen.getByText(
          /different name from your organization's registered name/,
        ),
      ).toBeTruthy();
      expect(screen.getByText(/payouts wait until then/)).toBeTruthy();
      expect(screen.queryByText(/awaiting verification/)).toBeNull();
      expect(screen.queryByText(/Nothing is needed/)).toBeNull();
    });

    it("links to settings to review the account", () => {
      renderNotice({ status: "name_mismatch", rejection_reason: null });
      expect(
        screen
          .getByRole("link", { name: "Review bank account" })
          .getAttribute("href"),
      ).toBe(SETTINGS);
    });
  });
});
