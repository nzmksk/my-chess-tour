// @vitest-environment jsdom
import React from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import PayoutStep from "../steps/PayoutStep";
import { TournamentWizardProvider } from "../TournamentWizardContext";
import type { PayoutData, PersistedState } from "../../types";

const mockFetch = vi.fn();
vi.stubGlobal("fetch", mockFetch);

const ORG_ID = "11111111-1111-4111-8111-111111111111";
const OTHER_ID = "22222222-2222-4222-8222-222222222222";

const NONE: PayoutData = {
  beneficiaryOrgId: null,
  beneficiaryOrgName: "",
  savedBeneficiaryOrgId: null,
  accepted: false,
  locked: false,
};

function renderStep(payoutData: PayoutData, canNominate = true) {
  const initialData = { payoutData } as PersistedState;
  return render(
    <TournamentWizardProvider
      orgId={ORG_ID}
      initialData={initialData}
      canNominate={canNominate}
    >
      <PayoutStep />
    </TournamentWizardProvider>,
  );
}

beforeEach(() => {
  mockFetch.mockReset();
  sessionStorage.clear();
});

afterEach(() => {
  cleanup();
});

describe("PayoutStep", () => {
  it("searches by name, leaves out this organization, and picks a result", async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      json: async () => ({
        data: [
          { id: OTHER_ID, name: "Penang Chess" },
          { id: ORG_ID, name: "Our Own Chess Club" },
        ],
      }),
    });
    renderStep(NONE);

    fireEvent.change(await screen.findByLabelText(/search approved organizations/i), {
      target: { value: "chess" },
    });

    const result = await screen.findByRole("button", { name: "Penang Chess" });
    expect(screen.queryByRole("button", { name: "Our Own Chess Club" })).toBeNull();
    expect(mockFetch.mock.calls[0][0]).toBe("/api/v1/organizations/search?q=chess");

    fireEvent.click(result);
    await waitFor(() =>
      expect(screen.getByText(/will be nominated when you save/i)).toBeTruthy(),
    );
  });

  it("doesn't search on a single character", async () => {
    renderStep(NONE);
    fireEvent.change(await screen.findByLabelText(/search approved organizations/i), {
      target: { value: "c" },
    });
    await new Promise((resolve) => setTimeout(resolve, 300));
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it("says a saved nomination is still waiting for acceptance", async () => {
    renderStep({
      ...NONE,
      beneficiaryOrgId: OTHER_ID,
      beneficiaryOrgName: "Penang Chess",
      savedBeneficiaryOrgId: OTHER_ID,
    });
    expect(await screen.findByText(/waiting for this organization to accept/i)).toBeTruthy();
  });

  it("says when a nomination has been accepted", async () => {
    renderStep({
      ...NONE,
      beneficiaryOrgId: OTHER_ID,
      beneficiaryOrgName: "Penang Chess",
      savedBeneficiaryOrgId: OTHER_ID,
      accepted: true,
    });
    expect(await screen.findByText(/accepted\. the payout goes/i)).toBeTruthy();
  });

  it("removing a choice goes back to the organization itself", async () => {
    renderStep({
      ...NONE,
      beneficiaryOrgId: OTHER_ID,
      beneficiaryOrgName: "Penang Chess",
      savedBeneficiaryOrgId: OTHER_ID,
    });
    fireEvent.click(await screen.findByRole("button", { name: /remove/i }));
    expect(await screen.findByText(/no beneficiary/i)).toBeTruthy();
  });

  it("is read-only without payout.request", async () => {
    renderStep(
      {
        ...NONE,
        beneficiaryOrgId: OTHER_ID,
        beneficiaryOrgName: "Penang Chess",
        savedBeneficiaryOrgId: OTHER_ID,
      },
      false,
    );
    expect(await screen.findByText(/only an organization owner/i)).toBeTruthy();
    expect(screen.queryByRole("button", { name: /remove/i })).toBeNull();
    expect(screen.queryByLabelText(/search approved organizations/i)).toBeNull();
  });

  it("is read-only once a player has paid", async () => {
    renderStep({ ...NONE, locked: true });
    expect(await screen.findByText(/locked because a player has already paid/i)).toBeTruthy();
    expect(screen.queryByLabelText(/search approved organizations/i)).toBeNull();
  });
});
