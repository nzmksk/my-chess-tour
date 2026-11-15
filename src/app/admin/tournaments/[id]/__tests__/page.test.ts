import { beforeEach, describe, expect, it, vi } from "vitest";

const mockRedirect = vi.hoisted(() =>
  vi.fn((url: string) => {
    throw new Error(`NEXT_REDIRECT:${url}`);
  }),
);
const mockNotFound = vi.hoisted(() =>
  vi.fn(() => {
    throw new Error("NEXT_NOT_FOUND");
  }),
);

vi.mock("next/navigation", () => ({
  redirect: mockRedirect,
  notFound: mockNotFound,
}));

vi.mock("@/components/NavBar", () => ({
  default: vi.fn().mockReturnValue(null),
}));

vi.mock(
  "@/app/my/organizations/[orgId]/tournaments/[id]/_components/TournamentManageClient",
  () => ({ default: vi.fn().mockReturnValue(null) }),
);

const mockGetData = vi.hoisted(() => vi.fn());

vi.mock(
  "@/app/my/organizations/[orgId]/tournaments/[id]/_data/getTournamentManageData",
  () => ({ getAdminTournamentManageData: mockGetData }),
);

import AdminTournamentPage from "../page";

const TOUR_ID = "cccccccc-0000-0000-0000-000000000001";
const ORG_ID = "bbbbbbbb-0000-0000-0000-000000000001";

function renderPage() {
  return AdminTournamentPage({ params: Promise.resolve({ id: TOUR_ID }) });
}

function fail(status: number) {
  return { ok: false, status, code: "X", message: "x" };
}

describe("AdminTournamentPage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("redirects an unauthenticated visitor to login", async () => {
    mockGetData.mockResolvedValue(fail(401));
    await expect(renderPage()).rejects.toThrow("NEXT_REDIRECT:/auth/login");
  });

  it("redirects a non-admin home", async () => {
    mockGetData.mockResolvedValue(fail(403));
    await expect(renderPage()).rejects.toThrow("NEXT_REDIRECT:/");
  });

  it.each([400, 404, 500])("renders not-found on a %i", async (status) => {
    mockGetData.mockResolvedValue(fail(status));
    await expect(renderPage()).rejects.toThrow("NEXT_NOT_FOUND");
  });

  it("renders the manage view in admin mode for the tournament's org", async () => {
    mockGetData.mockResolvedValue({
      ok: true,
      data: {
        tournament: {
          id: TOUR_ID,
          name: "Draft Open",
          organization: { id: ORG_ID, name: "KL Chess Club" },
        },
        stats: { total: 0, confirmed: 0, pending: 0 },
        participants: [],
        cancellationPending: false,
      },
    });

    const page = await renderPage();
    expect(mockGetData).toHaveBeenCalledWith(TOUR_ID);

    const client = (
      page.props.children as Array<{
        props: Record<string, unknown>;
      }>
    )[1];
    expect(client.props).toMatchObject({
      orgId: ORG_ID,
      viewer: "admin",
      tournament: { id: TOUR_ID },
    });
  });
});
