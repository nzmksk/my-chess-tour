import { beforeEach, describe, expect, it, vi } from "vitest";

const { mockRedirect, mockNotFound, mockSelfFetch } = vi.hoisted(() => ({
  mockRedirect: vi.fn((url: string) => {
    throw new Error(`NEXT_REDIRECT:${url}`);
  }),
  mockNotFound: vi.fn(() => {
    throw new Error("NEXT_NOT_FOUND");
  }),
  mockSelfFetch: vi.fn(),
}));

vi.mock("next/navigation", () => ({
  redirect: mockRedirect,
  notFound: mockNotFound,
}));
vi.mock("@/components/NavBar", () => ({ default: vi.fn(() => null) }));
vi.mock("@/lib/http/self-fetch", () => ({ selfApiFetch: mockSelfFetch }));
vi.mock("@/services/supabase/permission", () => ({
  getAuthClaims: vi.fn().mockResolvedValue({ id: "user-1" }),
  hasOrgPermission: vi.fn().mockResolvedValue(true),
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

// Far enough ahead that the date stages never decide.
const TOURNAMENT = {
  id: TOUR_ID,
  name: "KL Open",
  description: null,
  status: "published",
  start_date: "2099-12-01",
  end_date: "2099-12-02",
  registration_deadline: "2099-11-30T16:00:00+00:00",
  venue: { name: "Hall", state: "W.P. Kuala Lumpur", address: null, country: "MY" },
  timezone: "Asia/Kuala_Lumpur",
  format: { type: "rapid", system: "swiss", rounds: 7 },
  time_control: null,
  is_fide_rated: false,
  is_mcf_rated: false,
  max_participants: 64,
  entry_fees: null,
  prizes: null,
  restrictions: null,
  beneficiary: null,
};

function manageResponse(extra: Record<string, unknown>) {
  return {
    ok: true,
    json: async () => ({
      data: { tournament: TOURNAMENT, participants: [], ...extra },
    }),
  };
}

async function editStage(): Promise<unknown> {
  const page = await EditTournamentPage({
    params: Promise.resolve({ orgId: ORG_ID, id: TOUR_ID }),
  });
  const provider = (page.props.children as Array<{ props: Record<string, unknown> }>)[1];
  return provider.props.editStage;
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("EditTournamentPage edit stage", () => {
  // The PATCH route and the trigger lock the paid-stage fields on a paid
  // payment, so a forfeited registration with nobody confirmed still locks them.
  it("is paid when a payment settled even though nobody is confirmed", async () => {
    mockSelfFetch.mockResolvedValue(
      manageResponse({
        stats: { total: 0, confirmed: 0, pending: 0 },
        hasPaidRegistration: true,
      }),
    );
    expect(await editStage()).toBe("paid");
  });

  it("is published when nothing has been paid", async () => {
    mockSelfFetch.mockResolvedValue(
      manageResponse({
        stats: { total: 1, confirmed: 0, pending: 1 },
        hasPaidRegistration: false,
      }),
    );
    expect(await editStage()).toBe("published");
  });
});
