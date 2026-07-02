// @vitest-environment jsdom
import React from "react";
import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  act,
} from "@testing-library/react";
import type { TournamentDetail } from "@/app/tournaments/[slug]/types";
import type { PlayerProfile } from "../../types";

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

vi.mock("next/link", () => ({
  default: ({
    children,
    href,
  }: {
    children: React.ReactNode;
    href: string;
  }) => <a href={href}>{children}</a>,
}));

const mockFetch = vi.fn();
vi.stubGlobal("fetch", mockFetch);

// ---------------------------------------------------------------------------
// Fix "now" so age calculations are deterministic (2026-05-12)
// ---------------------------------------------------------------------------

beforeAll(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-05-12T00:00:00.000Z"));
});

afterAll(() => {
  vi.useRealTimers();
});

import RegisterForm from "../RegisterForm";

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const TOURNAMENT_ID = "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee";

function makeTournament(
  additional?: TournamentDetail["entry_fees"]["additional"],
): TournamentDetail {
  return {
    id: TOURNAMENT_ID,
    name: "Test Open 2026",
    venue: { name: "Chess Club", state: "Selangor" },
    start_date: "2026-07-01",
    end_date: "2026-07-02",
    registration_deadline: "2026-06-30",
    format: { type: "swiss", system: "swiss", rounds: 7 },
    is_fide_rated: false,
    is_mcf_rated: false,
    entry_fees: { standard: { amount_cents: 3000 }, additional },
    max_participants: 100,
    current_participants: 0,
    status: "published",
    organization: null,
  };
}

// Profiles — ages computed relative to the frozen date 2026-05-12
const MALE_PROFILE: PlayerProfile = {
  gender: "male",
  oku_status: "none",
  date_of_birth: "1990-01-01", // age 36
  title: null,
  fide_rating: null,
  national_rating: null,
  fide_id: null,
  mcf_id: null,
  nationality: null,
};
const FEMALE_PROFILE: PlayerProfile = {
  gender: "female",
  oku_status: "none",
  date_of_birth: "1990-01-01",
  title: null,
  fide_rating: null,
  national_rating: null,
  fide_id: null,
  mcf_id: null,
  nationality: null,
};
const OKU_PROFILE: PlayerProfile = {
  gender: "male",
  oku_status: "verified",
  date_of_birth: "1990-01-01",
  title: null,
  fide_rating: null,
  national_rating: null,
  fide_id: null,
  mcf_id: null,
  nationality: null,
};
const GM_PROFILE: PlayerProfile = {
  gender: "male",
  oku_status: "none",
  date_of_birth: "1990-01-01",
  title: "GM",
  fide_rating: null,
  national_rating: null,
  fide_id: null,
  mcf_id: null,
  nationality: null,
};
// Age 10 on 2026-05-12 (born 2016-01-01 → 10 years old)
const YOUNG_PROFILE: PlayerProfile = {
  gender: "male",
  oku_status: "none",
  date_of_birth: "2016-01-01",
  title: null,
  fide_rating: null,
  national_rating: null,
  fide_id: null,
  mcf_id: null,
  nationality: null,
};
// Age 36 — reuse MALE_PROFILE
const ADULT_PROFILE = MALE_PROFILE;
// No DOB
const NO_DOB_PROFILE: PlayerProfile = {
  gender: "male",
  oku_status: "none",
  date_of_birth: null,
  title: null,
  fide_rating: null,
  national_rating: null,
  fide_id: null,
  mcf_id: null,
  nationality: null,
};

const FAKE_REGISTRATION = {
  id: "reg-00000001",
  user_id: "user-1",
  tournament_id: TOURNAMENT_ID,
  fee_tier: "standard",
  status: "pending_payment" as const,
  registered_at: "2026-05-12T00:00:00.000Z",
  confirmed_at: null,
  cancelled_at: null,
  cancellation_reason: null,
};

function makeSuccessFetch(feeTier = "standard") {
  return {
    ok: true,
    json: vi.fn().mockResolvedValue({
      data: { ...FAKE_REGISTRATION, fee_tier: feeTier },
    }),
  };
}

function makeErrorFetch(message: string) {
  return {
    ok: false,
    json: vi.fn().mockResolvedValue({ error: { message } }),
  };
}

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function selectEl(container: HTMLElement) {
  return container.querySelector("select") as HTMLSelectElement;
}

function optionValues(container: HTMLElement) {
  return Array.from(selectEl(container).options).map((o) => o.value);
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("RegisterForm", () => {
  // --- Rendering ------------------------------------------------------------

  describe("rendering", () => {
    it("renders a dropdown select element", () => {
      const { container } = render(
        <RegisterForm
          tournament={makeTournament()}
          userId="u1"
          playerProfile={MALE_PROFILE}
        />,
      );
      expect(selectEl(container)).toBeTruthy();
    });

    it("renders the tournament name in the heading", () => {
      render(
        <RegisterForm
          tournament={makeTournament()}
          userId="u1"
          playerProfile={MALE_PROFILE}
        />,
      );
      expect(screen.getByText(/Test Open 2026/)).toBeDefined();
    });

    it("renders the Confirm & Pay submit button", () => {
      render(
        <RegisterForm
          tournament={makeTournament()}
          userId="u1"
          playerProfile={MALE_PROFILE}
        />,
      );
      expect(
        screen.getByRole("button", { name: "Confirm & Pay" }),
      ).toBeDefined();
    });
  });

  // --- Default selection / cheapest eligible --------------------------------

  describe("default selection", () => {
    it("selects standard when there are no additional tiers", () => {
      const { container } = render(
        <RegisterForm
          tournament={makeTournament()}
          userId="u1"
          playerProfile={MALE_PROFILE}
        />,
      );
      expect(selectEl(container).value).toBe("standard");
    });

    it("selects the cheapest eligible tier, not standard, when a cheaper tier exists", () => {
      const { container } = render(
        <RegisterForm
          tournament={makeTournament([
            { type: "early_bird", amount_cents: 2000 },
          ])}
          userId="u1"
          playerProfile={MALE_PROFILE}
        />,
      );
      expect(selectEl(container).value).toBe("early_bird");
    });

    it("skips ineligible tiers when choosing the default", () => {
      // women tier is cheaper but ineligible for male profile; standard wins
      const { container } = render(
        <RegisterForm
          tournament={makeTournament([
            { type: "women", amount_cents: 1500, gender: "female" },
          ])}
          userId="u1"
          playerProfile={MALE_PROFILE}
        />,
      );
      expect(selectEl(container).value).toBe("standard");
    });

    it("selects the cheapest among multiple eligible tiers", () => {
      const { container } = render(
        <RegisterForm
          tournament={makeTournament([
            { type: "early_bird", amount_cents: 2500 },
            { type: "youth", amount_cents: 2000, age_min: 10, age_max: 20 },
          ])}
          userId="u1"
          playerProfile={YOUNG_PROFILE} // age 10 — eligible for youth tier
        />,
      );
      expect(selectEl(container).value).toBe("youth");
    });
  });

  // --- Sort order -----------------------------------------------------------

  describe("sort order", () => {
    it("places eligible tiers before ineligible tiers", () => {
      const { container } = render(
        <RegisterForm
          tournament={makeTournament([
            { type: "women", amount_cents: 1800, gender: "female" },
            { type: "early_bird", amount_cents: 2400 },
          ])}
          userId="u1"
          playerProfile={MALE_PROFILE}
        />,
      );
      const values = optionValues(container);
      const earlyIdx = values.indexOf("early_bird");
      const womenIdx = values.indexOf("women");
      expect(earlyIdx).toBeLessThan(womenIdx);
    });

    it("sorts eligible tiers cheapest to most expensive", () => {
      const { container } = render(
        <RegisterForm
          tournament={makeTournament([
            { type: "early_bird", amount_cents: 2400 },
            { type: "junior", amount_cents: 1500, age_min: 5, age_max: 12 },
          ])}
          userId="u1"
          // adult male — only standard and early_bird are eligible
          playerProfile={ADULT_PROFILE}
        />,
      );
      const values = optionValues(container);
      // eligible: early_bird (2400) < standard (3000); junior is ineligible (age 36 > 12)
      expect(values.indexOf("early_bird")).toBeLessThan(
        values.indexOf("standard"),
      );
      expect(values.indexOf("standard")).toBeLessThan(values.indexOf("junior"));
    });

    it("sorts ineligible tiers cheapest to most expensive within their group", () => {
      const { container } = render(
        <RegisterForm
          tournament={makeTournament([
            { type: "oku", amount_cents: 1000, oku: true },
            { type: "women", amount_cents: 1800, gender: "female" },
          ])}
          userId="u1"
          playerProfile={MALE_PROFILE} // ineligible for both oku and women
        />,
      );
      const values = optionValues(container);
      // both oku (1000) and women (1800) ineligible; oku should come first
      expect(values.indexOf("oku")).toBeLessThan(values.indexOf("women"));
    });

    it("marks eligible options as not disabled", () => {
      const { container } = render(
        <RegisterForm
          tournament={makeTournament()}
          userId="u1"
          playerProfile={MALE_PROFILE}
        />,
      );
      const stdOption = Array.from(selectEl(container).options).find(
        (o) => o.value === "standard",
      );
      expect(stdOption?.disabled).toBe(false);
    });

    it("marks ineligible options as disabled", () => {
      const { container } = render(
        <RegisterForm
          tournament={makeTournament([
            { type: "women", amount_cents: 1800, gender: "female" },
          ])}
          userId="u1"
          playerProfile={MALE_PROFILE}
        />,
      );
      const womenOption = Array.from(selectEl(container).options).find(
        (o) => o.value === "women",
      );
      expect(womenOption?.disabled).toBe(true);
    });

    it("labels ineligible non-expired options with (Ineligible)", () => {
      const { container } = render(
        <RegisterForm
          tournament={makeTournament([
            { type: "women", amount_cents: 1800, gender: "female" },
          ])}
          userId="u1"
          playerProfile={MALE_PROFILE}
        />,
      );
      const womenOption = Array.from(selectEl(container).options).find(
        (o) => o.value === "women",
      );
      expect(womenOption?.text).toContain("(Ineligible)");
    });

    it("labels expired options with (Expired)", () => {
      const { container } = render(
        <RegisterForm
          tournament={makeTournament([
            {
              type: "early_bird",
              amount_cents: 2000,
              valid_until: "2025-01-01",
            },
          ])}
          userId="u1"
          playerProfile={MALE_PROFILE}
        />,
      );
      const option = Array.from(selectEl(container).options).find(
        (o) => o.value === "early_bird",
      );
      expect(option?.text).toContain("(Expired)");
    });
  });

  // --- Eligibility: gender --------------------------------------------------

  describe("eligibility — gender", () => {
    beforeEach(() => {
      mockFetch.mockResolvedValue(makeSuccessFetch());
    });

    it("shows an error when a female-only tier is selected by a non-female player", async () => {
      const { container } = render(
        <RegisterForm
          tournament={makeTournament([
            { type: "women", amount_cents: 1800, gender: "female" },
          ])}
          userId="u1"
          playerProfile={MALE_PROFILE}
        />,
      );
      await act(async () => {
        fireEvent.change(selectEl(container), { target: { value: "women" } });
      });
      expect(
        screen.getByText("This fee is for female players only."),
      ).toBeDefined();
    });

    it("shows no error when a female-only tier is selected by a female player", async () => {
      const { container } = render(
        <RegisterForm
          tournament={makeTournament([
            { type: "women", amount_cents: 1800, gender: "female" },
          ])}
          userId="u1"
          playerProfile={FEMALE_PROFILE}
        />,
      );
      // women tier should be the cheapest eligible → selected by default
      expect(selectEl(container).value).toBe("women");
      expect(
        screen.queryByText("This fee is for female players only."),
      ).toBeNull();
    });

    it("prompts to complete gender when a female-only tier is selected with no gender set", async () => {
      const { container } = render(
        <RegisterForm
          tournament={makeTournament([
            { type: "women", amount_cents: 1800, gender: "female" },
          ])}
          userId="u1"
          playerProfile={null}
        />,
      );
      await act(async () => {
        fireEvent.change(selectEl(container), { target: { value: "women" } });
      });
      expect(
        screen.getByText("A few details are needed for this tournament"),
      ).toBeDefined();
      expect(screen.getByText("Gender")).toBeDefined();
    });
  });

  // --- Eligibility: OKU -----------------------------------------------------

  describe("eligibility — OKU", () => {
    it("shows an error when an OKU tier is selected by a non-OKU player", async () => {
      const { container } = render(
        <RegisterForm
          tournament={makeTournament([
            { type: "oku", amount_cents: 1500, oku: true },
          ])}
          userId="u1"
          playerProfile={MALE_PROFILE}
        />,
      );
      await act(async () => {
        fireEvent.change(selectEl(container), { target: { value: "oku" } });
      });
      expect(
        screen.getByText(
          "This fee is for verified OKU players only — get verified in Settings.",
        ),
      ).toBeDefined();
    });

    it("shows no error when an OKU tier is selected by an OKU player", () => {
      const { container } = render(
        <RegisterForm
          tournament={makeTournament([
            { type: "oku", amount_cents: 1500, oku: true },
          ])}
          userId="u1"
          playerProfile={OKU_PROFILE}
        />,
      );
      // oku tier is cheapest eligible for OKU player
      expect(selectEl(container).value).toBe("oku");
      expect(
        screen.queryByText(
          "This fee is for verified OKU players only — get verified in Settings.",
        ),
      ).toBeNull();
    });

    it("shows the OKU-only error (no prompt) for an OKU tier when profile is null", async () => {
      const { container } = render(
        <RegisterForm
          tournament={makeTournament([
            { type: "oku", amount_cents: 1500, oku: true },
          ])}
          userId="u1"
          playerProfile={null}
        />,
      );
      await act(async () => {
        fireEvent.change(selectEl(container), { target: { value: "oku" } });
      });
      // OKU is not self-serviceable, so it stays a hard block — no prompt.
      expect(
        screen.getByText(
          "This fee is for verified OKU players only — get verified in Settings.",
        ),
      ).toBeDefined();
      expect(
        screen.queryByText("A few details are needed for this tournament"),
      ).toBeNull();
    });
  });

  // --- Eligibility: titles --------------------------------------------------

  describe("eligibility — titled players", () => {
    it("shows an error when a titled tier is selected by an untitled player", async () => {
      const { container } = render(
        <RegisterForm
          tournament={makeTournament([
            { type: "titled", amount_cents: 1000, titles: ["GM", "IM"] },
          ])}
          userId="u1"
          playerProfile={MALE_PROFILE}
        />,
      );
      await act(async () => {
        fireEvent.change(selectEl(container), { target: { value: "titled" } });
      });
      expect(
        screen.getByText("This fee is for titled players only (GM, IM)."),
      ).toBeDefined();
    });

    it("shows no error when a titled tier is selected by a matching titled player", () => {
      const { container } = render(
        <RegisterForm
          tournament={makeTournament([
            { type: "titled", amount_cents: 1000, titles: ["GM", "IM"] },
          ])}
          userId="u1"
          playerProfile={GM_PROFILE}
        />,
      );
      // titled tier is cheapest eligible
      expect(selectEl(container).value).toBe("titled");
      expect(screen.queryByText(/titled players only/)).toBeNull();
    });

    it("shows the titled-only error (no prompt) for a titled tier when profile is null", async () => {
      const { container } = render(
        <RegisterForm
          tournament={makeTournament([
            { type: "titled", amount_cents: 1000, titles: ["GM"] },
          ])}
          userId="u1"
          playerProfile={null}
        />,
      );
      await act(async () => {
        fireEvent.change(selectEl(container), { target: { value: "titled" } });
      });
      // Title is admin-set, not self-serviceable — stays a hard block.
      expect(
        screen.getByText("This fee is for titled players only (GM)."),
      ).toBeDefined();
      expect(
        screen.queryByText("A few details are needed for this tournament"),
      ).toBeNull();
    });
  });

  // --- Eligibility: age -----------------------------------------------------

  describe("eligibility — age", () => {
    it("shows an error when the player is too young for the minimum age", async () => {
      // YOUNG_PROFILE DOB 2016-01-01 → age 10 on 2026-05-12; age_min=18 fails
      const { container } = render(
        <RegisterForm
          tournament={makeTournament([
            { type: "adult", amount_cents: 2000, age_min: 18 },
          ])}
          userId="u1"
          playerProfile={YOUNG_PROFILE}
        />,
      );
      await act(async () => {
        fireEvent.change(selectEl(container), { target: { value: "adult" } });
      });
      expect(
        screen.getByText("You must be at least 18 years old for this tier."),
      ).toBeDefined();
    });

    it("shows an error when the player is too old for the maximum age", async () => {
      // ADULT_PROFILE DOB 1990-01-01 → age 36; age_max=12 fails
      const { container } = render(
        <RegisterForm
          tournament={makeTournament([
            { type: "junior", amount_cents: 2000, age_max: 12 },
          ])}
          userId="u1"
          playerProfile={ADULT_PROFILE}
        />,
      );
      await act(async () => {
        fireEvent.change(selectEl(container), { target: { value: "junior" } });
      });
      expect(
        screen.getByText("You must be 12 years old or younger for this tier."),
      ).toBeDefined();
    });

    it("shows no error when the player age is within the allowed range", () => {
      // YOUNG_PROFILE age 10; age_min=5, age_max=15 → eligible
      const { container } = render(
        <RegisterForm
          tournament={makeTournament([
            { type: "junior", amount_cents: 1500, age_min: 5, age_max: 15 },
          ])}
          userId="u1"
          playerProfile={YOUNG_PROFILE}
        />,
      );
      expect(selectEl(container).value).toBe("junior");
      expect(screen.queryByText(/years old/)).toBeNull();
    });

    it("prompts for date of birth when it is null for an age-restricted tier", async () => {
      const { container } = render(
        <RegisterForm
          tournament={makeTournament([
            { type: "junior", amount_cents: 1500, age_max: 12 },
          ])}
          userId="u1"
          playerProfile={NO_DOB_PROFILE}
        />,
      );
      await act(async () => {
        fireEvent.change(selectEl(container), { target: { value: "junior" } });
      });
      expect(
        screen.getByText("A few details are needed for this tournament"),
      ).toBeDefined();
      expect(screen.getByText("Date of Birth")).toBeDefined();
    });
  });

  // --- Submit behaviour -----------------------------------------------------

  describe("submit behaviour", () => {
    it("disables the submit button when there is an eligibility error", async () => {
      const { container } = render(
        <RegisterForm
          tournament={makeTournament([
            { type: "women", amount_cents: 1800, gender: "female" },
          ])}
          userId="u1"
          playerProfile={MALE_PROFILE}
        />,
      );
      await act(async () => {
        fireEvent.change(selectEl(container), { target: { value: "women" } });
      });
      const btn = screen.getByRole("button", {
        name: "Confirm & Pay",
      }) as HTMLButtonElement;
      expect(btn.disabled).toBe(true);
    });

    it("enables the submit button for an eligible tier", () => {
      render(
        <RegisterForm
          tournament={makeTournament()}
          userId="u1"
          playerProfile={MALE_PROFILE}
        />,
      );
      const btn = screen.getByRole("button", {
        name: "Confirm & Pay",
      }) as HTMLButtonElement;
      expect(btn.disabled).toBe(false);
    });

    it("shows the success state after a successful API response", async () => {
      mockFetch.mockResolvedValueOnce(makeSuccessFetch());
      const { container } = render(
        <RegisterForm
          tournament={makeTournament()}
          userId="u1"
          playerProfile={MALE_PROFILE}
        />,
      );
      await act(async () => {
        fireEvent.submit(container.querySelector("form")!);
      });
      expect(screen.getByText("Registration Submitted")).toBeDefined();
      expect(screen.getAllByText(/pending/i).length).toBeGreaterThan(0);
    });

    it("shows the registration reference ID in the success state", async () => {
      mockFetch.mockResolvedValueOnce(makeSuccessFetch());
      const { container } = render(
        <RegisterForm
          tournament={makeTournament()}
          userId="u1"
          playerProfile={MALE_PROFILE}
        />,
      );
      await act(async () => {
        fireEvent.submit(container.querySelector("form")!);
      });
      expect(screen.getByText(FAKE_REGISTRATION.id)).toBeDefined();
    });

    it("shows the API error message on a failed response", async () => {
      mockFetch.mockResolvedValueOnce(makeErrorFetch("Tournament is full"));
      const { container } = render(
        <RegisterForm
          tournament={makeTournament()}
          userId="u1"
          playerProfile={MALE_PROFILE}
        />,
      );
      await act(async () => {
        fireEvent.submit(container.querySelector("form")!);
      });
      expect(screen.getByText("Tournament is full")).toBeDefined();
    });

    it("shows a generic error on API failure with no message", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        json: vi.fn().mockResolvedValue({}),
      });
      const { container } = render(
        <RegisterForm
          tournament={makeTournament()}
          userId="u1"
          playerProfile={MALE_PROFILE}
        />,
      );
      await act(async () => {
        fireEvent.submit(container.querySelector("form")!);
      });
      expect(
        screen.getByText("Registration failed. Please try again."),
      ).toBeDefined();
    });

    it("shows a network error message when fetch throws", async () => {
      mockFetch.mockRejectedValueOnce(new Error("Network failure"));
      const { container } = render(
        <RegisterForm
          tournament={makeTournament()}
          userId="u1"
          playerProfile={MALE_PROFILE}
        />,
      );
      await act(async () => {
        fireEvent.submit(container.querySelector("form")!);
      });
      expect(
        screen.getByText("A network error occurred. Please try again."),
      ).toBeDefined();
    });

    it("calls fetch with the correct fee_tier in the request body", async () => {
      mockFetch.mockResolvedValueOnce(makeSuccessFetch("early_bird"));
      const { container } = render(
        <RegisterForm
          tournament={makeTournament([
            { type: "early_bird", amount_cents: 2000 },
          ])}
          userId="u1"
          playerProfile={MALE_PROFILE}
        />,
      );
      // early_bird is cheapest eligible → already selected
      await act(async () => {
        fireEvent.submit(container.querySelector("form")!);
      });
      const body = JSON.parse(mockFetch.mock.calls[0][1].body);
      expect(body.fee_tier).toBe("early_bird");
    });
  });

  // --- UI details -----------------------------------------------------------

  describe("UI details", () => {
    it("shows the subtitle for a tier that has restrictions when no eligibility error", () => {
      // Female player selects women tier — eligible, subtitle should show
      render(
        <RegisterForm
          tournament={makeTournament([
            { type: "women", amount_cents: 1800, gender: "female" },
          ])}
          userId="u1"
          playerProfile={FEMALE_PROFILE}
        />,
      );
      expect(screen.getByText(/female only/)).toBeDefined();
    });

    it("hides the subtitle when an eligibility error is displayed", async () => {
      const { container } = render(
        <RegisterForm
          tournament={makeTournament([
            { type: "women", amount_cents: 1800, gender: "female" },
          ])}
          userId="u1"
          playerProfile={MALE_PROFILE}
        />,
      );
      await act(async () => {
        fireEvent.change(selectEl(container), { target: { value: "women" } });
      });
      expect(screen.queryByText(/female only/)).toBeNull();
    });

    it("shows the cost summary section", () => {
      render(
        <RegisterForm
          tournament={makeTournament()}
          userId="u1"
          playerProfile={MALE_PROFILE}
        />,
      );
      expect(screen.getByText("Summary")).toBeDefined();
      expect(screen.getByText("Processing Fee")).toBeDefined();
      expect(screen.getByText("Total")).toBeDefined();
    });

    it("displays the server-computed processing fee and total", () => {
      // RM30 entry, 10% commission, organizer absorbs 0 → fee RM3.00, total RM33.00
      render(
        <RegisterForm
          tournament={makeTournament()}
          userId="u1"
          playerProfile={MALE_PROFILE}
          feeBreakdown={{
            standard: {
              entry_cents: 3000,
              processing_fee_cents: 300,
              gross_cents: 3300,
            },
          }}
        />,
      );
      expect(screen.getByText("RM3.00")).toBeDefined();
      expect(screen.getByText("RM33.00")).toBeDefined();
    });

    it("updates the summary entry fee when the selection changes", async () => {
      const { container } = render(
        <RegisterForm
          tournament={makeTournament([
            { type: "early_bird", amount_cents: 2000 },
          ])}
          userId="u1"
          playerProfile={MALE_PROFILE}
        />,
      );
      // Switch to standard (3000 cents = RM30)
      await act(async () => {
        fireEvent.change(selectEl(container), {
          target: { value: "standard" },
        });
      });
      expect(screen.getAllByText("RM30").length).toBeGreaterThan(0);
    });
  });

  // --- Just-in-time profile completion --------------------------------------

  describe("just-in-time profile completion", () => {
    it("prompts for a FIDE ID on a FIDE-rated tournament when missing", () => {
      render(
        <RegisterForm
          tournament={{ ...makeTournament(), is_fide_rated: true }}
          userId="u1"
          playerProfile={MALE_PROFILE}
        />,
      );
      expect(
        screen.getByText("A few details are needed for this tournament"),
      ).toBeDefined();
      expect(screen.getByText("FIDE ID")).toBeDefined();
      // The submit button is replaced by the prompt until the field is filled.
      expect(
        screen.queryByRole("button", { name: "Confirm & Pay" }),
      ).toBeNull();
    });

    it("prompts for an MCF ID on an MCF-rated tournament when missing", () => {
      render(
        <RegisterForm
          tournament={{ ...makeTournament(), is_mcf_rated: true }}
          userId="u1"
          playerProfile={MALE_PROFILE}
        />,
      );
      expect(screen.getByText("MCF ID")).toBeDefined();
    });

    it("does not prompt when the required FIDE ID is already set", () => {
      render(
        <RegisterForm
          tournament={{ ...makeTournament(), is_fide_rated: true }}
          userId="u1"
          playerProfile={{ ...MALE_PROFILE, fide_id: 5834567 }}
        />,
      );
      expect(
        screen.queryByText("A few details are needed for this tournament"),
      ).toBeNull();
      expect(
        screen.getByRole("button", { name: "Confirm & Pay" }),
      ).toBeDefined();
    });

    it("PATCHes the profile and unblocks Confirm & Pay after inline completion", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: vi.fn().mockResolvedValue({ success: true }),
      });
      render(
        <RegisterForm
          tournament={{ ...makeTournament(), is_fide_rated: true }}
          userId="u1"
          playerProfile={MALE_PROFILE}
        />,
      );

      await act(async () => {
        fireEvent.change(screen.getByPlaceholderText("e.g. 5834567"), {
          target: { value: "5834567" },
        });
      });
      await act(async () => {
        fireEvent.click(
          screen.getByRole("button", { name: "Save & Continue" }),
        );
      });

      expect(mockFetch).toHaveBeenCalledWith(
        "/api/v1/profile",
        expect.objectContaining({ method: "PATCH" }),
      );
      const body = JSON.parse(mockFetch.mock.calls[0][1].body);
      expect(body.fide_id).toBe(5834567);
      expect(
        screen.getByRole("button", { name: "Confirm & Pay" }),
      ).toBeDefined();
    });

    it("prompts for nationality on a nationality-restricted tournament when missing", () => {
      render(
        <RegisterForm
          tournament={makeTournament()}
          userId="u1"
          playerProfile={MALE_PROFILE}
          restrictions={{ nationality: "Malaysia" }}
        />,
      );
      expect(
        screen.getByText("A few details are needed for this tournament"),
      ).toBeDefined();
      expect(screen.getByText("Nationality")).toBeDefined();
    });

    it("hard-blocks when the player's nationality does not match the restriction", () => {
      render(
        <RegisterForm
          tournament={makeTournament()}
          userId="u1"
          playerProfile={{ ...MALE_PROFILE, nationality: "Singapore" }}
          restrictions={{ nationality: "Malaysia" }}
        />,
      );
      expect(
        screen.getByText("This tournament is for Malaysia players only."),
      ).toBeDefined();
      expect(
        screen.queryByText("A few details are needed for this tournament"),
      ).toBeNull();
    });
  });
});
