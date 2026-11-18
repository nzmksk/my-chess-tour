// @vitest-environment jsdom
import React from "react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import PrizesStep, { formFunders } from "../steps/PrizesStep";
import { TournamentWizardProvider, useTournamentWizard } from "../TournamentWizardContext";
import type { PersistedState, PrizesData } from "../../types";

const ORG_ID = "11111111-1111-4111-8111-111111111111";

const PRIZES: PrizesData = {
  categories: [
    {
      id: "c1",
      name: "Open",
      prizes: [{ id: "p1", placement: "1st", amount: 300 }],
      fundingSource: "sponsor",
      funderName: "Acme",
    },
    {
      id: "c2",
      name: "Veterans",
      prizes: [{ id: "p2", placement: "1st", amount: 0 }],
      fundingSource: "sponsor",
      funderName: "Placeholder Co",
    },
  ],
  specialPrizes: [
    { id: "s1", name: "Best Junior", amount: 50, fundingSource: "sponsor", funderName: " ACME " },
    { id: "s2", name: "Best Female", amount: 20, fundingSource: "grant", funderName: "Ministry" },
  ],
  distribution: "platform",
  funderEmails: { acme: "pay@acme.test" },
};

// WizardShell mounts a step only once the context has hydrated, and the step
// takes its form from the context then; mirror that.
function Hydrated() {
  const { isHydrated } = useTournamentWizard();
  return isHydrated ? <PrizesStep /> : null;
}

function renderStep(prizesData: PrizesData) {
  return render(
    <TournamentWizardProvider
      orgId={ORG_ID}
      initialData={{ prizesData } as PersistedState}
      editStage="draft"
    >
      <Hydrated />
    </TournamentWizardProvider>,
  );
}

beforeEach(() => sessionStorage.clear());
afterEach(() => cleanup());

describe("formFunders", () => {
  it("names each funder of a prize with money once, in order", () => {
    expect(formFunders(PRIZES)).toEqual([
      { key: "acme", name: "Acme" },
      { key: "ministry", name: "Ministry" },
    ]);
  });
});

describe("PrizesStep sponsor contacts", () => {
  it("asks for each funder's address when the platform distributes the prizes", async () => {
    renderStep(PRIZES);
    const acme = (await screen.findByLabelText("Acme email")) as HTMLInputElement;
    expect(acme.value).toBe("pay@acme.test");
    expect(screen.getByLabelText("Ministry email")).toBeTruthy();
    expect(screen.queryByLabelText("Placeholder Co email")).toBeNull();
  });

  it("asks for none when the organizer pays the winners", async () => {
    renderStep({ ...PRIZES, distribution: "organizer" });
    await screen.findByText("Prize Distribution");
    expect(screen.queryByText("Sponsor Payment Links")).toBeNull();
  });

  it("appears once the organizer hands distribution to the platform", async () => {
    renderStep({ ...PRIZES, distribution: "organizer" });
    fireEvent.click(await screen.findByLabelText(/MY Chess Tour distributes the prizes/));
    expect(screen.getByText("Sponsor Payment Links")).toBeTruthy();
    expect(screen.getByLabelText("Acme email")).toBeTruthy();
  });
});
