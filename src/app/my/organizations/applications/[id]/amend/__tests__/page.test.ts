import { beforeEach, describe, expect, it, vi } from "vitest";

// ── Mocks ─────────────────────────────────────────────────────

const mockRedirect = vi.hoisted(() => vi.fn());

vi.mock("next/navigation", () => ({
  redirect: mockRedirect,
}));

vi.mock("@/components/NavBar", () => ({
  default: vi.fn().mockReturnValue(null),
}));

vi.mock("@/app/organizations/apply/_components/ApplyForm", () => ({
  default: vi.fn().mockReturnValue(null),
}));

const mockGetAuthClaims = vi.hoisted(() => vi.fn());

vi.mock("@/services/supabase/permission", () => ({
  getAuthClaims: mockGetAuthClaims,
}));

// One builder per table, each resolving to whatever the test sets.
const { tables, mockFrom } = vi.hoisted(() => {
  const tables: Record<
    string,
    { data: unknown; calls: [string, unknown[]][] }
  > = {};
  const mockFrom = vi.fn((table: string) => {
    const entry = (tables[table] ??= { data: null, calls: [] });
    const builder: Record<string, unknown> = {};
    for (const m of ["select", "eq", "is", "order", "limit", "maybeSingle"]) {
      builder[m] = (...args: unknown[]) => {
        entry.calls.push([m, args]);
        return builder;
      };
    }
    builder.then = (resolve: (v: unknown) => unknown) =>
      Promise.resolve({ data: entry.data, error: null }).then(resolve);
    return builder;
  });
  return { tables, mockFrom };
});

vi.mock("@/services/supabase/admin", () => ({
  supabaseAdmin: { from: mockFrom },
}));

// ── Fixtures ──────────────────────────────────────────────────

const USER_ID = "aaaaaaaa-0000-0000-0000-000000000001";
const APP_ID = "bbbbbbbb-0000-0000-0000-000000000001";

function rejectedOrg(overrides: Record<string, unknown> = {}) {
  return {
    id: APP_ID,
    name: "KL Chess Association",
    description: null,
    links: null,
    email: "chess@klca.com",
    phone: null,
    past_tournament_refs: null,
    entity_type: "company",
    registration_number: "202001234567",
    approval_status: "rejected",
    rejection_reason: "SSM certificate unreadable",
    ...overrides,
  };
}

async function renderPage(id = APP_ID) {
  const { default: AmendApplicationPage } = await import("../page");
  return AmendApplicationPage({ params: Promise.resolve({ id }) });
}

// ── Tests ─────────────────────────────────────────────────────

describe("AmendApplicationPage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    for (const key of Object.keys(tables)) delete tables[key];
    mockGetAuthClaims.mockResolvedValue({ id: USER_ID });
    mockRedirect.mockImplementation((url: string) => {
      throw new Error(`NEXT_REDIRECT:${url}`);
    });
  });

  it("sends a signed-out visitor to login, back to this page afterwards", async () => {
    mockGetAuthClaims.mockResolvedValue(null);
    await expect(renderPage()).rejects.toThrow("NEXT_REDIRECT");
    expect(mockRedirect).toHaveBeenCalledWith(
      `/auth/login?redirectTo=/my/organizations/applications/${APP_ID}/amend&message=login-required`,
    );
  });

  it("only looks up the caller's own application", async () => {
    tables.organizations = { data: rejectedOrg(), calls: [] };
    await renderPage();
    expect(tables.organizations.calls).toContainEqual([
      "eq",
      ["created_by", USER_ID],
    ]);
  });

  it.each([
    ["not found (or someone else's)", null],
    ["pending", rejectedOrg({ approval_status: "pending" })],
    ["approved", rejectedOrg({ approval_status: "approved" })],
  ])(
    "goes back to the applications list when the application is %s",
    async (_label, org) => {
      tables.organizations = { data: org, calls: [] };
      await expect(renderPage()).rejects.toThrow(
        "NEXT_REDIRECT:/my/organizations/applications",
      );
    },
  );

  it("goes back to the applications list for a malformed id", async () => {
    await expect(renderPage("not-a-uuid")).rejects.toThrow(
      "NEXT_REDIRECT:/my/organizations/applications",
    );
    expect(mockFrom).not.toHaveBeenCalled();
  });

  it("hands the form the application with the account masked to its last 4 digits", async () => {
    tables.organizations = { data: rejectedOrg(), calls: [] };
    tables.organization_bank_accounts = {
      data: {
        bank_name: "Maybank",
        bank_code: "MBBEMYKL",
        account_holder: "KL Chess Association",
        account_number: "514012345678",
      },
      calls: [],
    };
    tables.organization_documents = {
      data: [{ id: "d1", doc_type: "ssm", original_filename: "ssm.pdf" }],
      calls: [],
    };
    tables.organization_registered_names = {
      data: { registered_name: "KL Chess Association Sdn Bhd" },
      calls: [],
    };

    const rendered = JSON.stringify(await renderPage());
    expect(rendered).toContain(
      '"registeredName":"KL Chess Association Sdn Bhd"',
    );

    expect(rendered).toContain("SSM certificate unreadable");
    expect(rendered).toContain('"last4":"5678"');
    expect(rendered).not.toContain("514012345678");
    expect(rendered).toContain("ssm.pdf");
    // Rejecting deactivated the account, so the newest row is read, not the active one.
    expect(tables.organization_bank_accounts.calls).toContainEqual([
      "order",
      ["created_at", { ascending: false }],
    ]);
  });
});
