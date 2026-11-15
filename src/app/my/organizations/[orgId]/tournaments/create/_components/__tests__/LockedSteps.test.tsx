// @vitest-environment jsdom
import React from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import BasicInfoStep from "../steps/BasicInfoStep";
import FormatStep from "../steps/FormatStep";
import FeesStep from "../steps/FeesStep";
import { TournamentWizardProvider } from "../TournamentWizardContext";
import type { PersistedState } from "../../types";
import type { EditStage } from "@/lib/tournaments/edit-policy";

vi.stubGlobal("fetch", vi.fn());

const ORG_ID = "11111111-1111-4111-8111-111111111111";

const INITIAL = {
  basicInfoData: {
    name: "KL Open",
    description: "",
    venueName: "Dewan",
    venueCountry: "MY",
    venueState: "Selangor",
    venueAddress: "1 Jalan",
  },
  formatData: {
    formatType: "Rapid",
    system: "Swiss",
    rounds: 7,
    baseTime: 15,
    increment: 0,
    delay: 0,
    startDate: "2099-09-01",
    endDate: "2099-09-02",
    registrationDeadline: "2099-08-25T23:59",
    maxParticipants: 64,
    fideRated: false,
    mcfRated: true,
    restrictions: [],
  },
  feesData: { standardFee: 50, tiers: [], preservedTiers: [] },
  prizesData: { categories: [], specialPrizes: [], distribution: "organizer" },
  tournamentId: "t1",
  currentStepIndex: 0,
  completedSteps: [],
} satisfies PersistedState;

function renderStep(step: React.ReactNode, editStage: EditStage) {
  return render(
    <TournamentWizardProvider
      orgId={ORG_ID}
      initialData={INITIAL}
      editStage={editStage}
    >
      {step}
    </TournamentWizardProvider>,
  );
}

// `:disabled`, not the `.disabled` property: a control inside a disabled
// fieldset is disabled without carrying the attribute itself.
function isDisabled(el: Element) {
  return el.matches(":disabled");
}

function field(label: RegExp) {
  return { disabled: isDisabled(screen.getByLabelText(label)) };
}

beforeEach(() => sessionStorage.clear());
afterEach(cleanup);

describe("wizard steps under the edit policy", () => {
  it("leaves every field editable on an unpaid listing", async () => {
    renderStep(<FormatStep />, "published");
    await screen.findByText(/format & schedule/i);
    expect(field(/start date/i).disabled).toBe(false);
    expect(field(/number of rounds/i).disabled).toBe(false);
    expect(
      isDisabled(screen.getByRole("button", { name: /add restriction/i })),
    ).toBe(false);
  });

  it("disables what a payment locked, and only that", async () => {
    renderStep(<FormatStep />, "paid");
    await screen.findByText(/format & schedule/i);
    expect(field(/start date/i).disabled).toBe(true);
    expect(field(/end date/i).disabled).toBe(true);
    expect(field(/max participants/i).disabled).toBe(true);
    expect(field(/number of rounds/i).disabled).toBe(true);
    expect(field(/base time/i).disabled).toBe(true);
    expect(field(/fide rated/i).disabled).toBe(true);
    expect(
      isDisabled(screen.getByRole("button", { name: /add restriction/i })),
    ).toBe(true);
    // Still the organizer's to move.
    expect(field(/registration deadline/i).disabled).toBe(false);
  });

  it("locks the whole fees step after a payment", async () => {
    renderStep(<FeesStep />, "paid");
    await screen.findByText(/entry fees/i);
    const amounts = screen.getAllByRole("spinbutton");
    expect(amounts.length).toBeGreaterThan(0);
    for (const input of amounts) {
      expect(isDisabled(input)).toBe(true);
    }
  });

  it("keeps cosmetic venue details editable after a payment", async () => {
    renderStep(<BasicInfoStep />, "paid");
    await screen.findByText(/basic information/i);
    expect(field(/tournament name/i).disabled).toBe(false);
    expect(field(/venue name/i).disabled).toBe(false);
    expect(field(/venue address/i).disabled).toBe(false);
    expect(field(/^country/i).disabled).toBe(true);
    expect(field(/^state/i).disabled).toBe(true);
  });

  it("leaves only the description once the tournament has started", async () => {
    renderStep(<BasicInfoStep />, "ongoing");
    await screen.findByText(/basic information/i);
    expect(field(/description/i).disabled).toBe(false);
    expect(field(/tournament name/i).disabled).toBe(true);
    expect(field(/venue name/i).disabled).toBe(true);
    expect(field(/venue address/i).disabled).toBe(true);
  });
});
