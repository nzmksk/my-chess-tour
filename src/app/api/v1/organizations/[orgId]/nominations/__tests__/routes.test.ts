import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

// One file for the three nomination routes: they share a gate and an error mapping.

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

const {
  mockFrom,
  mockRpc,
  mockGetClaims,
  mockHasPermission,
  mockNotifyNominated,
  mockNotifyResponded,
  tables,
  eqCalls,
  ilikeCalls,
} = vi.hoisted(() => {
    const tables: Record<string, Array<{ data: unknown; error: unknown }>> = {};
    const eqCalls: Array<[string, unknown]> = [];
    const ilikeCalls: Array<[string, unknown]> = [];

    function makeBuilder(table: string) {
      const b: Record<string, unknown> = {};
      for (const m of ["select", "is", "maybeSingle", "order", "limit"]) {
        b[m] = vi.fn(() => b);
      }
      b.eq = vi.fn((col: string, val: unknown) => {
        eqCalls.push([col, val]);
        return b;
      });
      b.ilike = vi.fn((col: string, val: unknown) => {
        ilikeCalls.push([col, val]);
        return b;
      });
      b.then = (
        onfulfilled: (v: unknown) => unknown,
        onrejected?: (r: unknown) => unknown,
      ) =>
        Promise.resolve(tables[table]?.shift() ?? { data: null, error: null }).then(
          onfulfilled,
          onrejected,
        );
      return b;
    }

    return {
      tables,
      eqCalls,
      ilikeCalls,
      mockFrom: vi.fn((table: string) => makeBuilder(table)),
      mockRpc: vi.fn(),
      mockGetClaims: vi.fn(),
      mockHasPermission: vi.fn(),
      mockNotifyNominated: vi.fn(),
      mockNotifyResponded: vi.fn(),
    };
  });

vi.mock("@/services/supabase/admin", () => ({
  supabaseAdmin: { from: mockFrom, rpc: mockRpc },
}));
vi.mock("@/services/supabase/permission", () => ({
  getAuthClaims: mockGetClaims,
  hasOrgPermission: mockHasPermission,
}));
vi.mock("@/services/payouts/notify", () => ({
  notifyBeneficiaryNominated: mockNotifyNominated,
  notifyNominationResponded: mockNotifyResponded,
}));

import { GET as listNominations } from "../route";
import { DELETE as declineNomination, POST as acceptNomination } from "../[tournamentId]/route";
import { PUT as nominate } from "../../tournaments/[id]/beneficiary/route";
import { GET as searchOrgs } from "../../../search/route";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const USER_ID = "aaaaaaaa-0000-4000-8000-000000000001";
const ORG_ID = "bbbbbbbb-0000-4000-8000-000000000001";
const NOMINEE = "bbbbbbbb-0000-4000-8000-000000000002";
const T_ID = "cccccccc-0000-4000-8000-000000000001";
const URL_BASE = "http://localhost/api/v1/organizations";

const callList = () =>
  listNominations(new NextRequest(`${URL_BASE}/${ORG_ID}/nominations`), {
    params: Promise.resolve({ orgId: ORG_ID }),
  });

const callAccept = (tournamentId = T_ID) =>
  acceptNomination(
    new NextRequest(`${URL_BASE}/${ORG_ID}/nominations/${tournamentId}`, { method: "POST" }),
    { params: Promise.resolve({ orgId: ORG_ID, tournamentId }) },
  );

const callDecline = (tournamentId = T_ID) =>
  declineNomination(
    new NextRequest(`${URL_BASE}/${ORG_ID}/nominations/${tournamentId}`, { method: "DELETE" }),
    { params: Promise.resolve({ orgId: ORG_ID, tournamentId }) },
  );

const callNominate = (body: unknown, id = T_ID) =>
  nominate(
    new NextRequest(`${URL_BASE}/${ORG_ID}/tournaments/${id}/beneficiary`, {
      method: "PUT",
      body: typeof body === "string" ? body : JSON.stringify(body),
    }),
    { params: Promise.resolve({ orgId: ORG_ID, id }) },
  );

const callSearch = (q: string) =>
  searchOrgs(new NextRequest(`${URL_BASE}/search?q=${encodeURIComponent(q)}`));

beforeEach(() => {
  vi.clearAllMocks();
  for (const k of Object.keys(tables)) delete tables[k];
  eqCalls.length = 0;
  ilikeCalls.length = 0;
  mockGetClaims.mockResolvedValue({ id: USER_ID });
  mockHasPermission.mockResolvedValue(true);
  mockRpc.mockResolvedValue({ data: { tournament_id: T_ID }, error: null });
  tables.organizations = [{ data: { id: ORG_ID, approval_status: "approved" }, error: null }];
  tables.tournaments = [{ data: { id: T_ID }, error: null }];
});

// ---------------------------------------------------------------------------
// The shared gate
// ---------------------------------------------------------------------------

describe.each([
  ["list", () => callList()],
  ["accept", () => callAccept()],
  ["decline", () => callDecline()],
  ["nominate", () => callNominate({ beneficiary_organization_id: NOMINEE })],
])("%s gate", (_label, call) => {
  it("401s without a session", async () => {
    mockGetClaims.mockResolvedValue(null);
    expect((await call()).status).toBe(401);
    expect(mockRpc).not.toHaveBeenCalled();
  });

  it("requires payout.request", async () => {
    mockHasPermission.mockResolvedValue(false);
    expect((await call()).status).toBe(403);
    expect(mockHasPermission).toHaveBeenCalledWith(USER_ID, ORG_ID, "payout.request");
    expect(mockRpc).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// PUT beneficiary
// ---------------------------------------------------------------------------

describe("PUT .../beneficiary", () => {
  it("nominates, passing the acting user", async () => {
    const res = await callNominate({ beneficiary_organization_id: NOMINEE });
    expect(res.status).toBe(200);
    expect(mockRpc).toHaveBeenCalledWith("nominate_payout_beneficiary", {
      p_tournament_id: T_ID,
      p_beneficiary_org_id: NOMINEE,
      p_user_id: USER_ID,
    });
  });

  it("emails the nominee", async () => {
    await callNominate({ beneficiary_organization_id: NOMINEE });
    expect(mockNotifyNominated).toHaveBeenCalledWith(T_ID, NOMINEE);
  });

  it("withdraws with null", async () => {
    await callNominate({ beneficiary_organization_id: null });
    expect(mockRpc.mock.calls[0][1].p_beneficiary_org_id).toBeNull();
    expect(mockNotifyNominated).not.toHaveBeenCalled();
  });

  it.each([
    ["invalid JSON", "{nope"],
    ["a missing field", {}],
    ["a malformed id", { beneficiary_organization_id: "nope" }],
  ])("400s on %s", async (_label, body) => {
    expect((await callNominate(body)).status).toBe(400);
    expect(mockRpc).not.toHaveBeenCalled();
  });

  it("400s on a malformed tournament id", async () => {
    const res = await callNominate({ beneficiary_organization_id: NOMINEE }, "nope");
    expect(res.status).toBe(400);
  });

  it("404s on another organization's tournament", async () => {
    tables.tournaments = [{ data: null, error: null }];
    const res = await callNominate({ beneficiary_organization_id: NOMINEE });
    expect(res.status).toBe(404);
    expect(eqCalls).toContainEqual(["organization_id", ORG_ID]);
    expect(mockRpc).not.toHaveBeenCalled();
  });

  it.each([
    ["42501", "NOMINATION_FORBIDDEN: x", 403, /owner/i],
    ["P0001", "NOMINEE_INELIGIBLE: bank_account_not_verified", 409, /verified payout bank/i],
    ["P0001", "NOMINATION_SELF: x", 409, /cannot nominate itself/i],
    ["P0001", "NOMINATION_CLOSED: x", 409, /cancelled/i],
    ["P0001", "tournament x has paid registrations; these fields are locked: beneficiary_organization_id", 409, /locked once a player has paid/i],
    ["P0002", "tournament x not found", 404, /not found/i],
    ["40001", "serialization failure", 500, /serialization/i],
  ])("maps %s %s to %i", async (code, message, status, expected) => {
    mockRpc.mockResolvedValue({ data: null, error: { code, message } });
    const res = await callNominate({ beneficiary_organization_id: NOMINEE });
    expect(res.status).toBe(status);
    expect((await res.json()).error.message).toMatch(expected);
    expect(mockNotifyNominated).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// Nominations
// ---------------------------------------------------------------------------

describe("GET .../nominations", () => {
  it("lists what is waiting on this organization", async () => {
    const rows = [{ tournament_id: T_ID, tournament_name: "KL Open" }];
    mockRpc.mockResolvedValue({ data: rows, error: null });
    const res = await callList();
    expect(res.status).toBe(200);
    expect(mockRpc).toHaveBeenCalledWith("list_pending_payout_nominations", {
      p_org_id: ORG_ID,
    });
    expect((await res.json()).data).toEqual(rows);
  });

  it("500s when the list fails", async () => {
    mockRpc.mockResolvedValue({ data: null, error: { message: "db down" } });
    expect((await callList()).status).toBe(500);
  });
});

describe("POST .../nominations/[tournamentId]", () => {
  it("accepts on behalf of the nominee", async () => {
    const res = await callAccept();
    expect(res.status).toBe(200);
    expect(eqCalls).toContainEqual(["beneficiary_organization_id", ORG_ID]);
    expect(mockRpc).toHaveBeenCalledWith("accept_payout_nomination", {
      p_tournament_id: T_ID,
      p_user_id: USER_ID,
    });
  });

  it("emails the organizer that the nomination was accepted", async () => {
    mockRpc.mockResolvedValue({ data: { already_accepted: false }, error: null });
    await callAccept();
    expect(mockNotifyResponded).toHaveBeenCalledWith(T_ID, ORG_ID, true);
  });

  it("emails no one for a repeated accept", async () => {
    mockRpc.mockResolvedValue({ data: { already_accepted: true }, error: null });
    expect((await callAccept()).status).toBe(200);
    expect(mockNotifyResponded).not.toHaveBeenCalled();
  });

  it("400s on a malformed tournament id", async () => {
    expect((await callAccept("nope")).status).toBe(400);
  });

  it("404s when the tournament doesn't nominate this organization", async () => {
    tables.tournaments = [{ data: null, error: null }];
    expect((await callAccept()).status).toBe(404);
    expect(mockRpc).not.toHaveBeenCalled();
  });

  it("409s once a player has paid", async () => {
    mockRpc.mockResolvedValue({
      data: null,
      error: { code: "P0001", message: "these fields are locked: beneficiary_accepted_at" },
    });
    expect((await callAccept()).status).toBe(409);
    expect(mockNotifyResponded).not.toHaveBeenCalled();
  });
});

describe("DELETE .../nominations/[tournamentId]", () => {
  it("declines on behalf of the nominee", async () => {
    const res = await callDecline();
    expect(res.status).toBe(200);
    expect(eqCalls).toContainEqual(["beneficiary_organization_id", ORG_ID]);
    expect(mockRpc).toHaveBeenCalledWith("decline_payout_nomination", {
      p_tournament_id: T_ID,
      p_user_id: USER_ID,
    });
    expect(mockNotifyResponded).toHaveBeenCalledWith(T_ID, ORG_ID, false);
  });

  it("400s on a malformed tournament id", async () => {
    expect((await callDecline("nope")).status).toBe(400);
    expect(mockRpc).not.toHaveBeenCalled();
  });

  it("404s when the tournament doesn't nominate this organization", async () => {
    tables.tournaments = [{ data: null, error: null }];
    expect((await callDecline()).status).toBe(404);
    expect(mockRpc).not.toHaveBeenCalled();
  });

  it("409s with a pointer to the organizer once the nomination is accepted", async () => {
    mockRpc.mockResolvedValue({
      data: null,
      error: { code: "P0001", message: "NOMINATION_ACCEPTED: an accepted nomination can only be withdrawn by the organizer" },
    });
    const res = await callDecline();
    expect(res.status).toBe(409);
    expect((await res.json()).error.message).toMatch(/ask the organizer/i);
    expect(mockNotifyResponded).not.toHaveBeenCalled();
  });

  it("409s once a player has paid", async () => {
    mockRpc.mockResolvedValue({
      data: null,
      error: { code: "P0001", message: "these fields are locked: beneficiary_organization_id" },
    });
    expect((await callDecline()).status).toBe(409);
  });
});

// ---------------------------------------------------------------------------
// Search
// ---------------------------------------------------------------------------

describe("GET /organizations/search", () => {
  it("401s without a session", async () => {
    mockGetClaims.mockResolvedValue(null);
    expect((await callSearch("chess")).status).toBe(401);
  });

  it("returns nothing for a query too short to mean anything", async () => {
    const res = await callSearch("c");
    expect((await res.json()).data).toEqual([]);
    expect(mockFrom).not.toHaveBeenCalled();
  });

  it("searches approved organizations only", async () => {
    const rows = [{ id: NOMINEE, name: "Penang Chess" }];
    tables.organizations = [{ data: rows, error: null }];
    const res = await callSearch("chess");
    expect((await res.json()).data).toEqual(rows);
    expect(eqCalls).toContainEqual(["approval_status", "approved"]);
    expect(ilikeCalls[0]).toEqual(["name", "%chess%"]);
  });

  it("treats ILIKE wildcards in the query literally", async () => {
    tables.organizations = [{ data: [], error: null }];
    await callSearch("100%_");
    expect(ilikeCalls[0][1]).toBe("%100\\%\\_%");
  });

  it("500s when the search fails", async () => {
    tables.organizations = [{ data: null, error: { message: "db down" } }];
    expect((await callSearch("chess")).status).toBe(500);
  });
});
