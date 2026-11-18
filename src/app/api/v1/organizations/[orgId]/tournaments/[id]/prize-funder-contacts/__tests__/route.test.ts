import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const { mockFrom, mockRpc, mockGetClaims, mockHasPermission, mockSync, tables } = vi.hoisted(() => {
  const tables: Record<string, Array<{ data: unknown; error: unknown }>> = {};
  function makeBuilder(table: string) {
    const b: Record<string, unknown> = {};
    for (const m of ["select", "eq", "is", "order", "maybeSingle"]) b[m] = vi.fn(() => b);
    b.then = (onfulfilled: (v: unknown) => unknown, onrejected?: (r: unknown) => unknown) =>
      Promise.resolve(tables[table]?.shift() ?? { data: null, error: null }).then(
        onfulfilled,
        onrejected,
      );
    return b;
  }
  return {
    tables,
    mockFrom: vi.fn((table: string) => makeBuilder(table)),
    mockRpc: vi.fn(),
    mockGetClaims: vi.fn(),
    mockHasPermission: vi.fn(),
    mockSync: vi.fn(),
  };
});

vi.mock("@/services/supabase/admin", () => ({ supabaseAdmin: { from: mockFrom, rpc: mockRpc } }));
vi.mock("@/services/supabase/permission", () => ({
  getAuthClaims: mockGetClaims,
  hasOrgPermission: mockHasPermission,
}));
vi.mock("@/services/prizes/funding-requests", () => ({ syncPrizeFundingRequests: mockSync }));

import { GET, PUT } from "../route";

const USER_ID = "aaaaaaaa-0000-4000-8000-000000000001";
const ORG_ID = "bbbbbbbb-0000-4000-8000-000000000001";
const T_ID = "cccccccc-0000-4000-8000-000000000001";
const params = { params: Promise.resolve({ orgId: ORG_ID, id: T_ID }) };
const URL = `http://localhost/api/v1/organizations/${ORG_ID}/tournaments/${T_ID}/prize-funder-contacts`;

const put = (body: unknown) =>
  PUT(
    new NextRequest(URL, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    }),
    params,
  );

beforeEach(() => {
  vi.clearAllMocks();
  for (const k of Object.keys(tables)) delete tables[k];
  mockGetClaims.mockResolvedValue({ id: USER_ID });
  mockHasPermission.mockResolvedValue(true);
  tables.organizations = [{ data: { id: ORG_ID, approval_status: "approved" }, error: null }];
  tables.tournaments = [{ data: { status: "draft" }, error: null }];
  mockRpc.mockResolvedValue({ data: 1, error: null });
  mockSync.mockResolvedValue({ error: null, released: false, linked: 1, unlinked: 0, missingContacts: [] });
  vi.spyOn(console, "error").mockImplementation(() => {});
});

describe("PUT prize-funder-contacts", () => {
  it("needs tournament.edit", async () => {
    mockHasPermission.mockResolvedValue(false);
    const res = await put({ contacts: [] });
    expect(res.status).toBe(403);
    expect(mockHasPermission).toHaveBeenCalledWith(USER_ID, ORG_ID, "tournament.edit");
  });

  it("stores trimmed, lower-cased addresses", async () => {
    const res = await put({
      contacts: [{ funder_name: " Acme ", funder_email: " Pay@Acme.TEST " }],
    });
    expect(res.status).toBe(200);
    expect(mockRpc).toHaveBeenCalledWith("set_prize_funder_contacts", {
      p_tournament_id: T_ID,
      p_contacts: [{ funder_name: "Acme", funder_email: "pay@acme.test" }],
    });
    // A draft isn't asking anyone for money yet.
    expect(mockSync).not.toHaveBeenCalled();
  });

  it("sends the links when the tournament is waiting for its pool", async () => {
    tables.tournaments = [{ data: { status: "pending_funding" }, error: null }];
    const res = await put({ contacts: [{ funder_name: "Acme", funder_email: "pay@acme.test" }] });
    expect(res.status).toBe(200);
    expect(mockSync).toHaveBeenCalledWith(T_ID, USER_ID);
  });

  it.each([
    [{ contacts: "nope" }, "contacts must be a list"],
    [{ contacts: [{ funder_name: "", funder_email: "a@b.test" }] }, "Every funder needs a name"],
    [{ contacts: [{ funder_name: "Acme", funder_email: "acme" }] }, "Acme: enter a valid email address"],
    [
      {
        contacts: [
          { funder_name: "Acme", funder_email: "a@b.test" },
          { funder_name: "ACME ", funder_email: "c@d.test" },
        ],
      },
      "ACME is listed twice",
    ],
  ])("400s %j", async (body, message) => {
    const res = await put(body);
    expect(res.status).toBe(400);
    expect((await res.json()).error.message).toBe(message);
    expect(mockRpc).not.toHaveBeenCalled();
  });

  it("refuses a cancelled tournament", async () => {
    tables.tournaments = [{ data: { status: "cancelled" }, error: null }];
    const res = await put({ contacts: [] });
    expect(res.status).toBe(409);
    expect(mockRpc).not.toHaveBeenCalled();
  });

  it("404s a tournament of another organization", async () => {
    tables.tournaments = [{ data: null, error: null }];
    const res = await put({ contacts: [] });
    expect(res.status).toBe(404);
  });

  it("still answers 200 when the contacts saved but the reconcile failed", async () => {
    tables.tournaments = [{ data: { status: "pending_funding" }, error: null }];
    mockSync.mockResolvedValue({
      error: { message: "db down" },
      released: false,
      linked: 0,
      unlinked: 0,
      missingContacts: [],
    });
    const res = await put({ contacts: [{ funder_name: "Acme", funder_email: "pay@acme.test" }] });
    expect(res.status).toBe(200);
  });
});

describe("GET prize-funder-contacts", () => {
  it("lists the contacts to anyone who can view the tournament", async () => {
    const contacts = [{ funder_name: "Acme", funder_email: "pay@acme.test" }];
    tables.prize_funder_contacts = [{ data: contacts, error: null }];
    const res = await GET(new NextRequest(URL), params);
    expect(res.status).toBe(200);
    expect(mockHasPermission).toHaveBeenCalledWith(USER_ID, ORG_ID, "tournament.view");
    expect((await res.json()).data).toEqual(contacts);
  });
});
