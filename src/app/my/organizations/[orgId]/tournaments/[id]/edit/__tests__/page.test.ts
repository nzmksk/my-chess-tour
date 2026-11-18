import { beforeEach, describe, expect, it, vi } from "vitest";

const { mockRedirect, mockNotFound, mockSelfFetch, mockGetClaims, mockHasOrgPermission } =
  vi.hoisted(() => ({
    mockRedirect: vi.fn((url: string) => {
      throw new Error(`NEXT_REDIRECT:${url}`);
    }),
    mockNotFound: vi.fn(() => {
      throw new Error("NEXT_NOT_FOUND");
    }),
    mockSelfFetch: vi.fn(),
    mockGetClaims: vi.fn(),
    mockHasOrgPermission: vi.fn(),
  }));

vi.mock("next/navigation", () => ({
  redirect: mockRedirect,
  notFound: mockNotFound,
}));
vi.mock("@/components/NavBar", () => ({ default: vi.fn(() => null) }));
vi.mock("@/lib/http/self-fetch", () => ({ selfApiFetch: mockSelfFetch }));
vi.mock("@/services/supabase/permission", () => ({
  getAuthClaims: mockGetClaims,
  hasOrgPermission: mockHasOrgPermission,
}));
vi.mock(
  "@/app/my/organizations/[orgId]/tournaments/create/_components/TournamentWizardContext",
  () => ({ TournamentWizardProvider: vi.fn(() => null) }),
);
vi.mock(
  "@/app/my/organizations/[orgId]/tournaments/create/_components/WizardShell",
  () => ({ default: vi.fn(() => null) }),
);

import EditTournamentPage from "../page";

const ORG_ID = "bbbbbbbb-0000-4000-8000-000000000001";
const TOUR_ID = "cccccccc-0000-4000-8000-000000000001";
const NOMINEE = "bbbbbbbb-0000-4000-8000-000000000002";

// Far enough ahead that the date stages never decide.
const TOURNAMENT = {
  id: TOUR_ID,
  name: "KL Open",
  description: "Seven rounds",
  status: "published",
  start_date: "2099-12-01",
  end_date: "2099-12-02",
  registration_deadline: "2099-11-30T16:00:00+00:00",
  venue: {
    name: "Hall",
    state: "W.P. Kuala Lumpur",
    address: "Jalan 1",
    country: "MY",
  },
  timezone: "Asia/Kuala_Lumpur",
  format: { type: "rapid", system: "swiss", rounds: 7 },
  time_control: { base_minutes: 15, increment_seconds: 10, delay_seconds: 5 },
  is_fide_rated: true,
  is_mcf_rated: false,
  max_participants: 64,
  entry_fees: null,
  prizes: {
    categories: [
      {
        name: "Open",
        entries: [{ place: "1st", amount_cents: 50000 }, {}],
        funding: { source: "sponsor", funder_name: "Acme" },
      },
      { entries: undefined, funding: { source: "bogus" } },
    ],
    special: [
      { name: "Best junior", amount_cents: 10000, funding: { source: "grant" } },
      {},
    ],
    distribution: "platform",
  },
  restrictions: null,
  beneficiary: { organization_id: NOMINEE, name: "Penang Chess", accepted: true },
};

/** A row with every optional value left out, as an early draft reads back. */
const SPARSE = {
  ...TOURNAMENT,
  description: null,
  venue: { name: "Hall", state: "W.P. Kuala Lumpur" },
  timezone: "Not/AZone",
  format: null,
  time_control: null,
  prizes: null,
  beneficiary: null,
};

type Json = Record<string, unknown>;

function ok(body: Json) {
  return { ok: true, json: async () => body };
}

/** Routes selfApiFetch: the tournament GET, the org dashboard and the funder contacts. */
function serve({
  tournament = TOURNAMENT as Json | undefined,
  extra = { hasPaidRegistration: false } as Json,
  manage,
  dashboard = ok({ data: { organization: { name: "KL Chess Club" } } }),
  contacts = ok({ data: [] }),
}: {
  tournament?: Json;
  extra?: Json;
  manage?: unknown;
  dashboard?: unknown;
  contacts?: unknown;
} = {}) {
  mockSelfFetch.mockImplementation(async (url: string) => {
    if (url.endsWith("/prize-funder-contacts")) return contacts;
    if (url.endsWith("/dashboard")) {
      if (dashboard instanceof Error) throw dashboard;
      return dashboard;
    }
    if (manage instanceof Error) throw manage;
    return (
      manage ??
      ok({
        data: {
          tournament,
          stats: { total: 0, confirmed: 0, pending: 0 },
          participants: [],
          ...extra,
        },
      })
    );
  });
}

type Element = { props: Record<string, unknown> };

async function render() {
  const page = await EditTournamentPage({
    params: Promise.resolve({ orgId: ORG_ID, id: TOUR_ID }),
  });
  const provider = (page.props.children as Element[])[1];
  const shell = provider.props.children as Element;
  return { provider: provider.props, shell: shell.props };
}

beforeEach(() => {
  vi.clearAllMocks();
  mockGetClaims.mockResolvedValue({ id: "user-1" });
  mockHasOrgPermission.mockResolvedValue(true);
  serve();
});

describe("EditTournamentPage access", () => {
  it("sends a signed-out visitor to login", async () => {
    mockGetClaims.mockResolvedValue(null);
    await expect(render()).rejects.toThrow("NEXT_REDIRECT:/auth/login");
  });

  it.each([
    ["the GET fails", { manage: { ok: false } }],
    ["the GET has no tournament", { manage: ok({ data: {} }) }],
    ["the GET throws", { manage: new Error("network") }],
  ])("is not found when %s", async (_label, opts) => {
    serve(opts);
    await expect(render()).rejects.toThrow("NEXT_NOT_FOUND");
  });

  it("sends an ended tournament back to the manage page", async () => {
    serve({
      tournament: { ...TOURNAMENT, start_date: "2020-01-01", end_date: "2020-01-02" },
    });
    await expect(render()).rejects.toThrow(
      `NEXT_REDIRECT:/my/organizations/${ORG_ID}/tournaments/${TOUR_ID}`,
    );
  });

  it("passes whether the user may nominate a beneficiary", async () => {
    mockHasOrgPermission.mockResolvedValue(false);
    const { provider } = await render();
    expect(mockHasOrgPermission).toHaveBeenCalledWith("user-1", ORG_ID, "payout.request");
    expect(provider.canNominate).toBe(false);
  });
});

describe("EditTournamentPage edit stage", () => {
  // The PATCH route and the trigger lock the paid-stage fields on a paid
  // payment, so a forfeited registration with nobody confirmed still locks them.
  it("is paid when a payment settled even though nobody is confirmed", async () => {
    serve({ extra: { hasPaidRegistration: true } });
    expect((await render()).provider.editStage).toBe("paid");
  });

  it("is published when nothing has been paid", async () => {
    serve({ extra: { hasPaidRegistration: false } });
    expect((await render()).provider.editStage).toBe("published");
  });

  it("is published when the flag is missing", async () => {
    serve({ extra: {} });
    expect((await render()).provider.editStage).toBe("published");
  });

  it("passes the saved capacity from the server", async () => {
    expect((await render()).provider.savedCapacity).toBe(64);
  });
});

describe("EditTournamentPage org name", () => {
  it("shows the organization's name", async () => {
    expect((await render()).shell.orgName).toBe("KL Chess Club");
  });

  it.each([
    ["the dashboard fails", { ok: false }],
    ["the dashboard has no name", ok({ data: {} })],
    ["the dashboard throws", new Error("network")],
  ])("falls back when %s", async (_label, dashboard) => {
    serve({ dashboard });
    expect((await render()).shell.orgName).toBe("Organization");
  });
});

describe("EditTournamentPage hydration", () => {
  it("loads the funders' private addresses into the prizes step", async () => {
    serve({
      contacts: ok({ data: [{ funder_name: " Acme ", funder_email: "pay@acme.test" }] }),
    });
    const data = (await render()).provider.initialData as Json;
    expect((data.prizesData as Json).funderEmails).toEqual({ acme: "pay@acme.test" });
  });

  it("starts with no addresses when the contacts can't be loaded", async () => {
    serve({ contacts: { ok: false, json: async () => ({}) } });
    const data = (await render()).provider.initialData as Json;
    expect((data.prizesData as Json).funderEmails).toEqual({});
  });

  it("maps a full tournament into the wizard's state", async () => {
    const data = (await render()).provider.initialData as Json;

    expect(data).toMatchObject({
      tournamentId: TOUR_ID,
      currentStepIndex: 0,
      completedSteps: [],
      basicInfoData: {
        name: "KL Open",
        description: "Seven rounds",
        venueName: "Hall",
        venueState: "W.P. Kuala Lumpur",
        venueAddress: "Jalan 1",
        venueCountry: "MY",
      },
      formatData: {
        formatType: "Rapid",
        system: "Swiss",
        rounds: 7,
        baseTime: 15,
        increment: 10,
        delay: 5,
        startDate: "2099-12-01",
        endDate: "2099-12-02",
        // 16:00Z is midnight at the venue (UTC+8).
        registrationDeadline: "2099-12-01T00:00",
        maxParticipants: 64,
        fideRated: true,
        mcfRated: false,
      },
      prizesData: {
        categories: [
          {
            id: "cat-0",
            name: "Open",
            prizes: [
              { id: "prize-0-0", placement: "1st", amount: 500 },
              { id: "prize-0-1", placement: "", amount: 0 },
            ],
            fundingSource: "sponsor",
            funderName: "Acme",
          },
          { id: "cat-1", name: "", prizes: [], fundingSource: "", funderName: "" },
        ],
        specialPrizes: [
          {
            id: "sp-0",
            name: "Best junior",
            amount: 100,
            fundingSource: "grant",
            funderName: "",
          },
          { id: "sp-1", name: "", amount: 0, fundingSource: "", funderName: "" },
        ],
        distribution: "platform",
      },
      payoutData: {
        beneficiaryOrgId: NOMINEE,
        beneficiaryOrgName: "Penang Chess",
        savedBeneficiaryOrgId: NOMINEE,
        accepted: true,
      },
    });
  });

  it("fills defaults for everything a sparse row leaves out", async () => {
    serve({ tournament: SPARSE });
    const data = (await render()).provider.initialData as Json;

    expect(data).toMatchObject({
      basicInfoData: { description: "", venueAddress: "", venueCountry: "MY" },
      formatData: {
        formatType: "",
        system: "",
        rounds: "",
        baseTime: "",
        increment: 0,
        delay: 0,
      },
      prizesData: { categories: [], specialPrizes: [], distribution: "organizer" },
      payoutData: {
        beneficiaryOrgId: null,
        beneficiaryOrgName: "",
        savedBeneficiaryOrgId: null,
        accepted: false,
      },
    });
  });
});
