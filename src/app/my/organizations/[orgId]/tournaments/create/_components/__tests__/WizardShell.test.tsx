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
import WizardShell from "../WizardShell";
import { TournamentWizardProvider } from "../TournamentWizardContext";
import type { PersistedState } from "../../types";
import type { EditStage } from "@/lib/tournaments/edit-policy";

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

const mockPush = vi.fn();
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: mockPush }),
}));

// The steps are not under test here — WizardShell's own save/publish handling
// is. Stubbing them keeps this from depending on five forms' validation.
vi.mock("../steps/BasicInfoStep", () => ({ default: () => <div /> }));
vi.mock("../steps/FormatStep", () => ({ default: () => <div /> }));
vi.mock("../steps/FeesStep", () => ({ default: () => <div /> }));
vi.mock("../steps/PrizesStep", () => ({ default: () => <div /> }));
vi.mock("../steps/PayoutStep", () => ({ default: () => <div /> }));
vi.mock("../steps/ReviewStep", () => ({ default: () => <div /> }));

const mockFetch = vi.fn();
vi.stubGlobal("fetch", mockFetch);

const ORG_ID = "11111111-1111-4111-8111-111111111111";
const TOUR_ID = "22222222-2222-4222-8222-222222222222";

const INITIAL: PersistedState = {
  basicInfoData: {
    name: "Singapore Blitz Chess Open",
    description: "",
    venueName: "Singapore Chess Centre",
    venueCountry: "MY",
    venueState: "Selangor",
    venueAddress: "1 Marina Boulevard",
  },
  formatData: {
    formatType: "Blitz",
    system: "Swiss",
    rounds: 9,
    baseTime: 5,
    increment: 3,
    delay: 0,
    startDate: "2099-09-01",
    endDate: "2099-09-02",
    registrationDeadline: "2099-08-25T23:59",
    maxParticipants: 150,
    fideRated: false,
    mcfRated: true,
    restrictions: [],
  },
  feesData: { standardFee: 50, tiers: [], preservedTiers: [] },
  prizesData: { categories: [], specialPrizes: [], distribution: "organizer" },
  tournamentId: TOUR_ID,
  // The Review step is the only one that shows "Save Changes".
  currentStepIndex: 5,
  completedSteps: [0, 1, 2, 3, 4],
};

function renderEditWizard({
  status = "published",
  initialData = INITIAL,
  currentStepIndex = initialData.currentStepIndex,
  canNominate = false,
  editStage,
}: {
  status?: "draft" | "published";
  initialData?: PersistedState;
  currentStepIndex?: number;
  canNominate?: boolean;
  editStage?: EditStage;
} = {}) {
  return render(
    <TournamentWizardProvider
      orgId={ORG_ID}
      initialData={{ ...initialData, currentStepIndex }}
      storageKeySuffix={`edit-${TOUR_ID}`}
      excludeId={TOUR_ID}
      canNominate={canNominate}
      editStage={editStage ?? (status === "draft" ? "draft" : "published")}
    >
      <WizardShell
        orgId={ORG_ID}
        orgName="Penang Chess Association"
        title="Edit Tournament"
        redirectPath={`/my/organizations/${ORG_ID}/tournaments/${TOUR_ID}`}
        mode="edit"
        status={status}
      />
    </TournamentWizardProvider>,
  );
}

function jsonResponse(status: number, body: unknown): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  } as Response;
}

beforeEach(() => {
  mockPush.mockReset();
  mockFetch.mockReset();
  sessionStorage.clear();
});

afterEach(() => {
  cleanup();
});

describe("WizardShell — Save Changes", () => {
  async function clickSaveChanges() {
    renderEditWizard();
    const button = await screen.findByRole("button", { name: /save changes/i });
    fireEvent.click(button);
    return button;
  }

  // The bug this covers: a rejected PATCH was collapsed to null, sessionStorage
  // was cleared and the router pushed anyway, so the organizer landed back on
  // the tournament page with their edits gone and nothing said. The freeze's
  // readable 409 existed and was thrown away.
  it("shows the API's message and stays put when the save is refused", async () => {
    mockFetch.mockResolvedValueOnce(
      jsonResponse(409, {
        error: {
          code: "CONFLICT",
          message:
            "Entry fees, prizes and capacity are locked once a player has paid",
          details: ["entry_fees"],
        },
      }),
    );

    await clickSaveChanges();

    expect((await screen.findByRole("alert")).textContent).toBe(
      "Entry fees, prizes and capacity are locked once a player has paid",
    );
    expect(mockPush).not.toHaveBeenCalled();
    // The organizer's edits must survive so they can correct and retry.
    expect(
      sessionStorage.getItem(`tournament-wizard-${ORG_ID}-edit-${TOUR_ID}`),
    ).not.toBeNull();
  });

  it("joins a multi-item details list rather than showing only the summary", async () => {
    mockFetch.mockResolvedValueOnce(
      jsonResponse(400, {
        error: {
          code: "VALIDATION_ERROR",
          message: "Tournament is not ready",
          details: ["Prize category Open: name the sponsor", "Venue required"],
        },
      }),
    );

    await clickSaveChanges();

    expect((await screen.findByRole("alert")).textContent).toBe(
      "Prize category Open: name the sponsor · Venue required",
    );
  });

  it("falls back to a readable message when the body is not JSON", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: false,
      status: 500,
      json: async () => {
        throw new Error("not json");
      },
    } as unknown as Response);

    await clickSaveChanges();

    expect((await screen.findByRole("alert")).textContent).toBe(
      "Failed to save your changes. Please try again.",
    );
  });

  it("redirects and clears the draft once the save succeeds", async () => {
    mockFetch.mockResolvedValueOnce(
      jsonResponse(200, { data: { id: TOUR_ID } }),
    );

    await clickSaveChanges();

    await waitFor(() =>
      expect(mockPush).toHaveBeenCalledWith(
        `/my/organizations/${ORG_ID}/tournaments/${TOUR_ID}`,
      ),
    );
    expect(screen.queryByRole("alert")).toBeNull();

    const [url, init] = mockFetch.mock.calls[0];
    expect(url).toBe(`/api/v1/organizations/${ORG_ID}/tournaments/${TOUR_ID}`);
    expect(init.method).toBe("PATCH");
    // The venue names the zone; the client does not send one.
    expect(JSON.parse(init.body)).not.toHaveProperty("timezone");
  });
});

describe("WizardShell — editing a draft", () => {
  // The bug this covers (#479): the edit wizard always ended in Save Changes,
  // and the dashboard sends drafts straight to it, so a draft saved earlier had
  // no way to be published.
  it("ends in Publish rather than Save Changes", async () => {
    renderEditWizard({ status: "draft" });

    expect(
      await screen.findByRole("button", { name: /^publish$/i }),
    ).toBeTruthy();
    expect(screen.queryByRole("button", { name: /save changes/i })).toBeNull();
    // The draft can still be saved without publishing.
    expect(screen.getByRole("button", { name: /save draft/i })).toBeTruthy();
  });

  it("saves the edits, then publishes, then returns to the tournament", async () => {
    mockFetch
      .mockResolvedValueOnce(jsonResponse(200, { data: { id: TOUR_ID } }))
      .mockResolvedValueOnce(
        jsonResponse(200, { data: { id: TOUR_ID, status: "published" } }),
      );

    renderEditWizard({ status: "draft" });
    fireEvent.click(await screen.findByRole("button", { name: /^publish$/i }));

    await waitFor(() =>
      expect(mockPush).toHaveBeenCalledWith(
        `/my/organizations/${ORG_ID}/tournaments/${TOUR_ID}`,
      ),
    );

    const base = `/api/v1/organizations/${ORG_ID}/tournaments/${TOUR_ID}`;
    expect(mockFetch.mock.calls[0][0]).toBe(base);
    expect(mockFetch.mock.calls[0][1].method).toBe("PATCH");
    expect(mockFetch.mock.calls[1][0]).toBe(`${base}/publish`);
    expect(mockFetch.mock.calls[1][1].method).toBe("POST");
  });

  it("shows the publish validator's reasons and stays put when refused", async () => {
    mockFetch
      .mockResolvedValueOnce(jsonResponse(200, { data: { id: TOUR_ID } }))
      .mockResolvedValueOnce(
        jsonResponse(422, {
          error: {
            code: "VALIDATION_ERROR",
            message: "Start date must be a future date",
            details: [
              "Start date must be a future date",
              "Registration deadline must be a future date",
            ],
          },
        }),
      );

    renderEditWizard({ status: "draft" });
    fireEvent.click(await screen.findByRole("button", { name: /^publish$/i }));

    expect((await screen.findByRole("alert")).textContent).toBe(
      "Start date must be a future date · Registration deadline must be a future date",
    );
    expect(mockPush).not.toHaveBeenCalled();
  });
});

describe("WizardShell — editing a published tournament", () => {
  // A published tournament has no draft: the secondary button saves straight
  // to the live tournament, so "Save Draft" misdescribed what it did.
  it("labels the save button Save Changes on earlier steps", async () => {
    renderEditWizard({ currentStepIndex: 0 });

    expect(
      await screen.findByRole("button", { name: /save changes/i }),
    ).toBeTruthy();
    expect(screen.queryByRole("button", { name: /save draft/i })).toBeNull();
  });

  it("shows a single Save Changes button on the last step", async () => {
    renderEditWizard();

    await screen.findByRole("button", { name: /save changes/i });
    expect(
      screen.getAllByRole("button", { name: /save changes/i }),
    ).toHaveLength(1);
    expect(screen.queryByRole("button", { name: /save draft/i })).toBeNull();
    expect(screen.queryByRole("button", { name: /^publish$/i })).toBeNull();
  });
});

describe("WizardShell — payout nomination", () => {
  const NOMINEE = "33333333-3333-4333-8333-333333333333";

  const withPayout = (
    beneficiaryOrgId: string | null,
    savedBeneficiaryOrgId: string | null,
  ): PersistedState => ({
    ...INITIAL,
    payoutData: {
      beneficiaryOrgId,
      beneficiaryOrgName: beneficiaryOrgId ? "Penang Chess" : "",
      savedBeneficiaryOrgId,
      accepted: false,
      locked: false,
    },
  });

  const beneficiaryCalls = () =>
    mockFetch.mock.calls.filter(([url]) =>
      String(url).endsWith("/beneficiary"),
    );

  async function save(initial: PersistedState, canNominate = true) {
    renderEditWizard({ initialData: initial, canNominate });
    fireEvent.click(
      await screen.findByRole("button", { name: /save changes/i }),
    );
  }

  it("nominates after saving the tournament, when the choice changed", async () => {
    mockFetch.mockResolvedValue(jsonResponse(200, { data: {} }));
    await save(withPayout(NOMINEE, null));

    await waitFor(() => expect(mockPush).toHaveBeenCalled());
    const [url, init] = beneficiaryCalls()[0];
    expect(url).toBe(
      `/api/v1/organizations/${ORG_ID}/tournaments/${TOUR_ID}/beneficiary`,
    );
    expect(init.method).toBe("PUT");
    expect(JSON.parse(init.body)).toEqual({
      beneficiary_organization_id: NOMINEE,
    });
    // The tournament first: a new one has no id to nominate on until it is saved.
    expect(String(mockFetch.mock.calls[0][0])).not.toContain("/beneficiary");
  });

  it("withdraws with null when the choice was removed", async () => {
    mockFetch.mockResolvedValue(jsonResponse(200, { data: {} }));
    await save(withPayout(null, NOMINEE));

    await waitFor(() => expect(mockPush).toHaveBeenCalled());
    expect(JSON.parse(beneficiaryCalls()[0][1].body)).toEqual({
      beneficiary_organization_id: null,
    });
  });

  it("sends nothing when the choice is unchanged", async () => {
    mockFetch.mockResolvedValue(jsonResponse(200, { data: {} }));
    await save(withPayout(NOMINEE, NOMINEE));

    await waitFor(() => expect(mockPush).toHaveBeenCalled());
    expect(beneficiaryCalls()).toHaveLength(0);
  });

  it("sends nothing for someone without payout.request", async () => {
    mockFetch.mockResolvedValue(jsonResponse(200, { data: {} }));
    await save(withPayout(NOMINEE, null), false);

    await waitFor(() => expect(mockPush).toHaveBeenCalled());
    expect(beneficiaryCalls()).toHaveLength(0);
  });

  it("keeps the organizer on the wizard when the nomination is refused", async () => {
    mockFetch.mockImplementation(async (url: string) =>
      url.endsWith("/beneficiary")
        ? jsonResponse(409, {
            error: {
              message: "The payout recipient is locked once a player has paid",
            },
          })
        : jsonResponse(200, { data: {} }),
    );
    await save(withPayout(NOMINEE, null));

    expect((await screen.findByRole("alert")).textContent).toMatch(
      /locked once a player has paid/i,
    );
    expect(mockPush).not.toHaveBeenCalled();
  });
});

describe("WizardShell — edit policy", () => {
  function patchBody(): Record<string, unknown> {
    const [, init] = mockFetch.mock.calls[0] as [string, RequestInit];
    return JSON.parse(init.body as string);
  }

  async function saveAt(editStage: EditStage, initialData = INITIAL) {
    mockFetch.mockResolvedValue(jsonResponse(200, { data: { id: TOUR_ID } }));
    renderEditWizard({ editStage, initialData });
    fireEvent.click(
      await screen.findByRole("button", { name: /save changes/i }),
    );
  }

  it("sends every field while nothing is locked", async () => {
    await saveAt("published");
    await waitFor(() => expect(mockPush).toHaveBeenCalled());
    expect(Object.keys(patchBody())).toEqual(
      expect.arrayContaining(["entry_fees", "start_date", "max_participants"]),
    );
  });

  // Not resent at their current value: leaving them out can't trip the freeze.
  it("leaves out what a payment locked", async () => {
    await saveAt("paid", {
      ...INITIAL,
      formatData: {
        ...INITIAL.formatData,
        restrictions: [{ id: "r1", kind: "max_rating", value: "1600" }],
      },
    });
    await waitFor(() => expect(mockPush).toHaveBeenCalled());
    const body = patchBody();
    for (const locked of [
      "entry_fees",
      "start_date",
      "end_date",
      "venue_country",
      "venue_state",
      "format",
      "time_control",
      "is_fide_rated",
      "is_mcf_rated",
      "restrictions",
    ]) {
      expect(body).not.toHaveProperty(locked);
    }
    expect(body).toMatchObject({
      name: INITIAL.basicInfoData.name,
      venue_name: INITIAL.basicInfoData.venueName,
      venue_address: INITIAL.basicInfoData.venueAddress,
    });
    expect(body).toHaveProperty("registration_deadline");
    // Increase-only, not locked: the API refuses a decrease.
    expect(body).toHaveProperty("max_participants");
  });

  it("sends only the description once the tournament has started", async () => {
    await saveAt("ongoing", {
      ...INITIAL,
      basicInfoData: {
        ...INITIAL.basicInfoData,
        description: "Round 3 pairings are up.",
      },
    });
    await waitFor(() => expect(mockPush).toHaveBeenCalled());
    expect(patchBody()).toEqual({ description: "Round 3 pairings are up." });
  });

  // An empty patch is a 400 from the route; there's simply nothing to save.
  it("skips the request when nothing editable is left to send", async () => {
    await saveAt("ongoing");
    await waitFor(() => expect(mockPush).toHaveBeenCalled());
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it("says why fields are locked", async () => {
    renderEditWizard({ editStage: "paid" });
    expect(await screen.findByText(/a player has already paid/i)).toBeTruthy();
  });

  it("shows no lock notice while everything is editable", async () => {
    renderEditWizard({ editStage: "published" });
    await screen.findByRole("button", { name: /save changes/i });
    expect(screen.queryByText(/locked|can no longer/i)).toBeNull();
  });

  // A 409's details are column names; its message is the readable part.
  it("shows the freeze's message rather than the locked column names", async () => {
    mockFetch.mockResolvedValueOnce(
      jsonResponse(409, {
        error: {
          code: "CONFLICT",
          message: "A player has already paid, so the dates are locked.",
          details: ["start_date", "end_date"],
        },
      }),
    );
    renderEditWizard();
    fireEvent.click(
      await screen.findByRole("button", { name: /save changes/i }),
    );
    expect((await screen.findByRole("alert")).textContent).toBe(
      "A player has already paid, so the dates are locked.",
    );
  });
});
