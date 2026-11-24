import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import type { DependentView } from "@/services/guardianship/dependents";

const {
  mockRpc,
  mockUpsert,
  mockUpdateEq,
  mockUpdate,
  mockFrom,
  mockGetClaims,
  mockListDependents,
  mockGetDependent,
  mockFetchFidePlayer,
} = vi.hoisted(() => {
  const mockUpsert = vi.fn();
  const mockUpdateEq = vi.fn();
  const mockUpdate = vi.fn(() => ({
    eq: vi.fn(() => ({ eq: mockUpdateEq })),
  }));
  return {
    mockRpc: vi.fn(),
    mockUpsert,
    mockUpdateEq,
    mockUpdate,
    mockFrom: vi.fn(() => ({ upsert: mockUpsert, update: mockUpdate })),
    mockGetClaims: vi.fn(),
    mockListDependents: vi.fn(),
    mockGetDependent: vi.fn(),
    mockFetchFidePlayer: vi.fn(),
  };
});

vi.mock("@/services/supabase/admin", () => ({
  supabaseAdmin: { from: mockFrom, rpc: mockRpc },
}));
vi.mock("@/services/supabase/server", () => ({
  createClient: vi.fn().mockResolvedValue({
    auth: { getClaims: mockGetClaims },
  }),
}));
vi.mock("next/headers", () => ({
  cookies: vi.fn().mockResolvedValue({ getAll: () => [], set: vi.fn() }),
}));
vi.mock("@/services/guardianship/dependents", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("@/services/guardianship/dependents")>();
  return {
    ...actual,
    listDependents: mockListDependents,
    getDependent: mockGetDependent,
  };
});
vi.mock("@/services/fide/fide", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/services/fide/fide")>();
  return { ...actual, fetchFidePlayer: mockFetchFidePlayer };
});
vi.mock("@/lib/tournaments/datetime", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("@/lib/tournaments/datetime")>();
  return { ...actual, getTodayInTimeZone: () => "2026-11-24" };
});

import { GET as listGET, POST } from "../route";
import { DELETE, GET, PATCH } from "../[id]/route";
import { appIdFor } from "@/test/identity";
import { hitWindow } from "@/services/rate-limit/window";
import { TERMS_VERSION } from "@/lib/reference/legal";

const AUTH_SUB = "bbbbbbbb-0000-0000-0000-000000000001";
const GUARDIAN = appIdFor(AUTH_SUB);
const CHILD_ID = "cccccccc-0000-0000-0000-000000000001";
const ADULT_ID = "cccccccc-0000-0000-0000-000000000002";

function view(overrides: Partial<DependentView> = {}): DependentView {
  return {
    id: CHILD_ID,
    guardianship_id: "dddddddd-0000-0000-0000-000000000001",
    first_name: "Kai",
    last_name: "Child",
    account_type: "managed",
    contact_email: null,
    relationship: "parent",
    basis: "minor",
    authorisation_method: null,
    terms_version: TERMS_VERSION,
    terms_accepted_at: "2026-11-24T00:00:00Z",
    added_at: "2026-11-24T00:00:00Z",
    date_of_birth: "2016-05-01",
    gender: null,
    nationality: null,
    fide_id: null,
    mcf_id: null,
    title: null,
    national_rating: null,
    oku_status: "none",
    ...overrides,
  };
}

const ADULT = view({
  id: ADULT_ID,
  first_name: "Ada",
  last_name: "Assisted",
  relationship: "carer",
  basis: "authorised",
  authorisation_method: "guardian_attestation",
  date_of_birth: "1980-01-01",
});

function jsonReq(url: string, method: string, body?: unknown) {
  return new NextRequest(`http://localhost${url}`, {
    method,
    headers: { "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

function ctx(id: string) {
  return { params: Promise.resolve({ id }) };
}

const MINOR_BODY = {
  first_name: " Kai ",
  last_name: "Child",
  date_of_birth: "2016-05-01",
  relationship: "parent",
  basis: "minor",
  accept_terms: true,
};

const ADULT_BODY = {
  first_name: "Ada",
  last_name: "Assisted",
  date_of_birth: "1980-01-01",
  relationship: "carer",
  basis: "authorised",
  accept_terms: true,
  authorised_by_player: true,
  contact_email: " Ada@Example.com ",
};

beforeEach(() => {
  vi.clearAllMocks();
  mockGetClaims.mockResolvedValue({
    data: { claims: { sub: AUTH_SUB } },
    error: null,
  });
  mockGetDependent.mockResolvedValue({ ok: true, data: view() });
  mockListDependents.mockResolvedValue({ ok: true, data: [view(), ADULT] });
  mockUpsert.mockResolvedValue({ error: null });
  mockUpdateEq.mockResolvedValue({ error: null });
});

describe("GET /api/v1/me/dependents", () => {
  it("401s without a session", async () => {
    mockGetClaims.mockResolvedValue({ data: null, error: null });
    const res = await listGET();
    expect(res.status).toBe(401);
    expect(mockListDependents).not.toHaveBeenCalled();
  });

  it("lists the caller's own active dependents", async () => {
    const res = await listGET();
    expect(res.status).toBe(200);
    expect(mockListDependents).toHaveBeenCalledWith(GUARDIAN);
    const body = await res.json();
    expect(body.data.map((d: DependentView) => d.id)).toEqual([
      CHILD_ID,
      ADULT_ID,
    ]);
  });

  it("500s when the list can't be loaded", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    mockListDependents.mockResolvedValue({
      ok: false,
      error: { message: "x" },
    });
    const res = await listGET();
    expect(res.status).toBe(500);
  });
});

describe("POST /api/v1/me/dependents", () => {
  beforeEach(() => {
    mockRpc.mockResolvedValue({
      data: {
        dependent_id: CHILD_ID,
        guardianship_id: "g",
        reactivated: false,
      },
      error: null,
    });
  });

  it("401s without a session", async () => {
    mockGetClaims.mockResolvedValue({ data: null, error: null });
    const res = await POST(
      jsonReq("/api/v1/me/dependents", "POST", MINOR_BODY),
    );
    expect(res.status).toBe(401);
    expect(mockRpc).not.toHaveBeenCalled();
  });

  it("creates a minor dependent with the server's Terms version", async () => {
    const res = await POST(
      jsonReq("/api/v1/me/dependents", "POST", MINOR_BODY),
    );
    expect(res.status).toBe(201);
    expect(mockRpc).toHaveBeenCalledWith("create_dependent", {
      p_guardian_user_id: GUARDIAN,
      p_first_name: "Kai",
      p_last_name: "Child",
      p_date_of_birth: "2016-05-01",
      p_relationship: "parent",
      p_basis: "minor",
      p_terms_version: TERMS_VERSION,
      p_gender: null,
      p_nationality: null,
      p_contact_email: null,
    });
    expect(mockGetDependent).toHaveBeenCalledWith(GUARDIAN, CHILD_ID);
    const body = await res.json();
    expect(body.data).toMatchObject({ id: CHILD_ID, reactivated: false });
  });

  it("creates an authorised adult with a normalised contact email", async () => {
    mockRpc.mockResolvedValue({
      data: {
        dependent_id: ADULT_ID,
        guardianship_id: "g",
        reactivated: false,
      },
      error: null,
    });
    mockGetDependent.mockResolvedValue({ ok: true, data: ADULT });
    const res = await POST(
      jsonReq("/api/v1/me/dependents", "POST", ADULT_BODY),
    );
    expect(res.status).toBe(201);
    expect(mockRpc.mock.calls[0][1]).toMatchObject({
      p_basis: "authorised",
      p_contact_email: "ada@example.com",
    });
  });

  it("answers 200 with reactivated when a revoked dependent is added again", async () => {
    mockRpc.mockResolvedValue({
      data: { dependent_id: CHILD_ID, guardianship_id: "g", reactivated: true },
      error: null,
    });
    const res = await POST(
      jsonReq("/api/v1/me/dependents", "POST", MINOR_BODY),
    );
    expect(res.status).toBe(200);
    expect((await res.json()).data.reactivated).toBe(true);
  });

  it.each([
    ["missing names", { ...MINOR_BODY, first_name: " ", last_name: undefined }],
    ["a long name", { ...MINOR_BODY, first_name: "x".repeat(101) }],
    ["an invalid date", { ...MINOR_BODY, date_of_birth: "2016-02-30" }],
    ["a future date", { ...MINOR_BODY, date_of_birth: "2026-11-25" }],
    ["an unknown relationship", { ...MINOR_BODY, relationship: "aunt" }],
    ["an unknown basis", { ...MINOR_BODY, basis: "friend" }],
    ["an invalid gender", { ...MINOR_BODY, gender: "x" }],
    ["a blank nationality", { ...MINOR_BODY, nationality: " " }],
    ["an invalid contact email", { ...ADULT_BODY, contact_email: "nope" }],
    ["Terms not accepted", { ...MINOR_BODY, accept_terms: false }],
    [
      "a contact email on a minor",
      { ...MINOR_BODY, contact_email: "kid@example.com" },
    ],
    ["no player authorisation", { ...ADULT_BODY, authorised_by_player: false }],
  ])("400s for %s", async (_label, body) => {
    const res = await POST(jsonReq("/api/v1/me/dependents", "POST", body));
    expect(res.status).toBe(400);
    expect((await res.json()).error.code).toBe("VALIDATION_ERROR");
    expect(mockRpc).not.toHaveBeenCalled();
  });

  it("400s for a body that isn't JSON", async () => {
    const req = new NextRequest("http://localhost/api/v1/me/dependents", {
      method: "POST",
      body: "{",
    });
    const res = await POST(req);
    expect(res.status).toBe(400);
  });

  it("422s when the basis doesn't match the age", async () => {
    const adultAsMinor = await POST(
      jsonReq("/api/v1/me/dependents", "POST", {
        ...MINOR_BODY,
        date_of_birth: "2008-11-24",
      }),
    );
    expect(adultAsMinor.status).toBe(422);
    expect((await adultAsMinor.json()).error.code).toBe("BASIS_AGE_MISMATCH");

    const minorAsAdult = await POST(
      jsonReq("/api/v1/me/dependents", "POST", {
        ...ADULT_BODY,
        date_of_birth: "2008-11-25",
      }),
    );
    expect(minorAsAdult.status).toBe(422);
    expect(mockRpc).not.toHaveBeenCalled();
  });

  it("422s for a carer adding a minor", async () => {
    const res = await POST(
      jsonReq("/api/v1/me/dependents", "POST", {
        ...MINOR_BODY,
        relationship: "carer",
      }),
    );
    expect(res.status).toBe(422);
    expect(mockRpc).not.toHaveBeenCalled();
  });

  it("422s for an appointed guardianship", async () => {
    const res = await POST(
      jsonReq("/api/v1/me/dependents", "POST", {
        ...ADULT_BODY,
        relationship: "legal_guardian",
        basis: "appointed",
      }),
    );
    expect(res.status).toBe(422);
    expect((await res.json()).error.code).toBe("BASIS_NOT_SUPPORTED");
    expect(mockRpc).not.toHaveBeenCalled();
  });

  it.each([
    ["DEPENDENT_EXISTS: already", 409, "DEPENDENT_EXISTS"],
    [
      "GUARDIANSHIP_LIMIT_REACHED: a guardian may act for at most 10 players",
      422,
      "DEPENDENT_LIMIT_REACHED",
    ],
    ["GUARDIAN_NOT_ELIGIBLE: only a self-managed account", 403, "FORBIDDEN"],
    ["BASIS_AGE_MISMATCH: basis minor", 422, "BASIS_AGE_MISMATCH"],
    ["INVALID_DEPENDENT: names", 400, "VALIDATION_ERROR"],
  ])("maps %s to %i", async (message, status, code) => {
    mockRpc.mockResolvedValue({
      data: null,
      error: { code: "P0001", message },
    });
    const res = await POST(
      jsonReq("/api/v1/me/dependents", "POST", MINOR_BODY),
    );
    expect(res.status).toBe(status);
    expect((await res.json()).error.code).toBe(code);
  });

  it("500s on an unexpected database error without leaking it", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    mockRpc.mockResolvedValue({
      data: null,
      error: { code: "XX000", message: "secret detail" },
    });
    const res = await POST(
      jsonReq("/api/v1/me/dependents", "POST", MINOR_BODY),
    );
    expect(res.status).toBe(500);
    expect(JSON.stringify(await res.json())).not.toContain("secret detail");
  });

  it("429s when the caller is rate limited", async () => {
    vi.mocked(hitWindow).mockResolvedValueOnce(300);
    const res = await POST(
      jsonReq("/api/v1/me/dependents", "POST", MINOR_BODY),
    );
    expect(res.status).toBe(429);
    expect(hitWindow).toHaveBeenCalledWith(
      `ratelimit:dependentSave:user:${GUARDIAN}`,
      expect.any(Number),
      expect.any(Number),
    );
    expect(mockRpc).not.toHaveBeenCalled();
  });
});

describe("GET /api/v1/me/dependents/[id]", () => {
  it("401s without a session", async () => {
    mockGetClaims.mockResolvedValue({ data: null, error: null });
    const res = await GET(
      jsonReq(`/api/v1/me/dependents/${CHILD_ID}`, "GET"),
      ctx(CHILD_ID),
    );
    expect(res.status).toBe(401);
  });

  it("returns the dependent for their guardian", async () => {
    const res = await GET(
      jsonReq(`/api/v1/me/dependents/${CHILD_ID}`, "GET"),
      ctx(CHILD_ID),
    );
    expect(res.status).toBe(200);
    expect(mockGetDependent).toHaveBeenCalledWith(GUARDIAN, CHILD_ID);
    expect((await res.json()).data.id).toBe(CHILD_ID);
  });

  it("404s for anyone who isn't the active guardian", async () => {
    mockGetDependent.mockResolvedValue({ ok: true, data: null });
    const res = await GET(
      jsonReq(`/api/v1/me/dependents/${CHILD_ID}`, "GET"),
      ctx(CHILD_ID),
    );
    expect(res.status).toBe(404);
  });

  it("404s for an id that isn't a UUID, without a lookup", async () => {
    const res = await GET(
      jsonReq("/api/v1/me/dependents/nope", "GET"),
      ctx("nope"),
    );
    expect(res.status).toBe(404);
    expect(mockGetDependent).not.toHaveBeenCalled();
  });
});

describe("PATCH /api/v1/me/dependents/[id]", () => {
  function patch(body: unknown, id = CHILD_ID) {
    return PATCH(
      jsonReq(`/api/v1/me/dependents/${id}`, "PATCH", body),
      ctx(id),
    );
  }

  it("404s for anyone who isn't the active guardian, writing nothing", async () => {
    mockGetDependent.mockResolvedValue({ ok: true, data: null });
    const res = await patch({ nationality: "Malaysia" });
    expect(res.status).toBe(404);
    expect(mockUpsert).not.toHaveBeenCalled();
  });

  it("refuses changes once a minor has turned 18 (#721)", async () => {
    mockGetDependent.mockResolvedValue({
      ok: true,
      data: view({ date_of_birth: `${new Date().getUTCFullYear() - 19}-01-01` }),
    });
    const res = await patch({ nationality: "Malaysia" });
    expect(res.status).toBe(409);
    expect((await res.json()).error.code).toBe("AGED_OUT");
    expect(mockUpsert).not.toHaveBeenCalled();
  });

  it("updates the dependent's profile, not the guardian's", async () => {
    const res = await patch({ nationality: " Malaysia ", gender: "male" });
    expect(res.status).toBe(200);
    expect(mockFrom).toHaveBeenCalledWith("player_profiles");
    expect(mockUpsert).toHaveBeenCalledWith(
      { user_id: CHILD_ID, nationality: "Malaysia", gender: "male" },
      { onConflict: "user_id" },
    );
  });

  it("applies the set-once rules from the profile route", async () => {
    mockGetDependent.mockResolvedValue({
      ok: true,
      data: view({ gender: "female", nationality: "Malaysia", fide_id: 5 }),
    });
    const res = await patch({
      gender: "male",
      nationality: "Singapore",
      fide_id: 6,
      date_of_birth: "2015-01-01",
      title: "GM",
      national_rating: 2000,
    });
    expect(res.status).toBe(400);
    const { message } = (await res.json()).error;
    for (const field of [
      "gender",
      "nationality",
      "fide_id",
      "date_of_birth",
      "title",
      "national_rating",
    ]) {
      expect(message).toContain(field);
    }
    expect(mockUpsert).not.toHaveBeenCalled();
  });

  it("allows resending an unchanged set-once value", async () => {
    mockGetDependent.mockResolvedValue({
      ok: true,
      data: view({ gender: "female" }),
    });
    const res = await patch({ gender: "female", date_of_birth: "2016-05-01" });
    expect(res.status).toBe(200);
  });

  it("looks up a new FIDE ID against the dependent's name", async () => {
    mockFetchFidePlayer.mockResolvedValue({
      name: "Child, Kai",
      standard: 1500,
      rapid: null,
      blitz: null,
      title: null,
    });
    const res = await patch({ fide_id: 123 });
    expect(res.status).toBe(200);
    expect(mockFetchFidePlayer).toHaveBeenCalledWith(123);
    expect(mockUpsert.mock.calls[0][0]).toMatchObject({
      user_id: CHILD_ID,
      fide_id: 123,
      fide_name_verified: true,
    });
  });

  it("sets and clears an adult dependent's contact email", async () => {
    mockGetDependent.mockResolvedValue({ ok: true, data: ADULT });
    const res = await patch({ contact_email: " New@Example.com " }, ADULT_ID);
    expect(res.status).toBe(200);
    expect(mockUpdate).toHaveBeenCalledWith({
      contact_email: "new@example.com",
    });
    expect(mockUpsert).not.toHaveBeenCalled();

    const cleared = await patch({ contact_email: null }, ADULT_ID);
    expect(cleared.status).toBe(200);
    expect(mockUpdate).toHaveBeenLastCalledWith({ contact_email: null });
  });

  it("refuses a contact email for a minor or a dependent with a login", async () => {
    const minor = await patch({ contact_email: "kid@example.com" });
    expect(minor.status).toBe(400);

    mockGetDependent.mockResolvedValue({
      ok: true,
      data: { ...ADULT, account_type: "self" },
    });
    const selfAccount = await patch(
      { contact_email: "a@example.com" },
      ADULT_ID,
    );
    expect(selfAccount.status).toBe(400);
    expect(mockUpdate).not.toHaveBeenCalled();
  });

  it("refuses an under-18 date of birth on a dependent with their own account", async () => {
    mockGetDependent.mockResolvedValue({
      ok: true,
      data: { ...ADULT, account_type: "self", date_of_birth: null },
    });
    const res = await patch({ date_of_birth: "2010-01-01" }, ADULT_ID);
    expect(res.status).toBe(422);
    expect((await res.json()).error.code).toBe("UNDER_18");
  });

  it("400s when nothing editable is sent", async () => {
    const res = await patch({ first_name: "Other" });
    expect(res.status).toBe(400);
    expect(mockUpsert).not.toHaveBeenCalled();
  });
});

describe("DELETE /api/v1/me/dependents/[id]", () => {
  function del(id = CHILD_ID) {
    return DELETE(jsonReq(`/api/v1/me/dependents/${id}`, "DELETE"), ctx(id));
  }

  it("revokes the guardianship", async () => {
    mockRpc.mockResolvedValue({
      data: { guardianship_id: "g", upcoming_registrations: [] },
      error: null,
    });
    const res = await del();
    expect(res.status).toBe(200);
    expect(mockRpc).toHaveBeenCalledWith("revoke_dependent", {
      p_guardian_user_id: GUARDIAN,
      p_dependent_user_id: CHILD_ID,
    });
    expect((await res.json()).data).toEqual({
      id: CHILD_ID,
      revoked: true,
      upcoming_registrations: [],
      warning: null,
    });
  });

  it("warns about confirmed upcoming registrations without cancelling them", async () => {
    const upcoming = [
      {
        registration_id: "r1",
        tournament_id: "t1",
        tournament_name: "Open",
        start_date: "2026-12-24",
      },
    ];
    mockRpc.mockResolvedValue({
      data: { guardianship_id: "g", upcoming_registrations: upcoming },
      error: null,
    });
    const res = await del();
    expect(res.status).toBe(200);
    const { data } = await res.json();
    expect(data.upcoming_registrations).toEqual(upcoming);
    expect(data.warning).toContain("1 upcoming tournament");
    expect(mockRpc).toHaveBeenCalledTimes(1);
  });

  it("422s while the dependent has a pending payment", async () => {
    mockRpc.mockResolvedValue({
      data: null,
      error: {
        code: "P0001",
        message: "DEPENDENT_HAS_PENDING_PAYMENT: finish",
      },
    });
    const res = await del();
    expect(res.status).toBe(422);
    expect((await res.json()).error.code).toBe("PENDING_PAYMENT");
  });

  it("404s for anyone who isn't the active guardian, without calling the database function", async () => {
    mockGetDependent.mockResolvedValue({ ok: true, data: null });
    const res = await del();
    expect(res.status).toBe(404);
    expect(mockRpc).not.toHaveBeenCalled();
  });

  it("404s when the guardianship was revoked in the meantime", async () => {
    mockRpc.mockResolvedValue({
      data: null,
      error: { code: "P0001", message: "DEPENDENT_NOT_FOUND: none" },
    });
    const res = await del();
    expect(res.status).toBe(404);
  });
});
