import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import type { DependentView } from "@/services/guardianship/dependents";

const {
  mockRpc,
  mockUpsert,
  mockUpdate,
  mockUpdateEq,
  mockFrom,
  mockGetClaims,
  mockGetDependent,
  mockAssertUploaded,
  mockRemoveAllUnder,
} = vi.hoisted(() => {
  const mockUpsert = vi.fn();
  const mockUpdateEq = vi.fn();
  const mockUpdate = vi.fn(() => ({ eq: mockUpdateEq }));
  return {
    mockRpc: vi.fn(),
    mockUpsert,
    mockUpdate,
    mockUpdateEq,
    mockFrom: vi.fn(() => ({ upsert: mockUpsert, update: mockUpdate })),
    mockGetClaims: vi.fn(),
    mockGetDependent: vi.fn(),
    mockAssertUploaded: vi.fn(),
    mockRemoveAllUnder: vi.fn(),
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
vi.mock("@/services/guardianship/dependents", async (importOriginal) => ({
  ...(await importOriginal<
    typeof import("@/services/guardianship/dependents")
  >()),
  getDependent: mockGetDependent,
}));
vi.mock("@/services/supabase/storage", () => ({
  assertUploadedObject: mockAssertUploaded,
  removeAllUnder: mockRemoveAllUnder,
}));

import { POST as grantConsent } from "../[id]/consents/route";
import { DELETE as removeOku, POST as submitOku } from "../[id]/oku/route";
import { appIdFor } from "@/test/identity";
import { onBehalfConsent } from "@/lib/reference/legal";

const AUTH_SUB = "bbbbbbbb-0000-0000-0000-000000000001";
const GUARDIAN = appIdFor(AUTH_SUB);
const CHILD_ID = "cccccccc-0000-0000-0000-000000000001";
const BASE = "http://localhost/api/v1/me/dependents";

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
    terms_version: "2026-11-24",
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

const params = (id = CHILD_ID) => ({ params: Promise.resolve({ id }) });

function post(path: string, body: unknown) {
  return new NextRequest(`${BASE}/${CHILD_ID}/${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  mockGetClaims.mockResolvedValue({
    data: { claims: { sub: AUTH_SUB, email: "g@example.com" } },
    error: null,
  });
  mockGetDependent.mockResolvedValue({ ok: true, data: view() });
  mockRpc.mockResolvedValue({ data: true, error: null });
  mockUpsert.mockResolvedValue({ error: null });
  mockUpdateEq.mockResolvedValue({ error: null });
  mockAssertUploaded.mockResolvedValue({ ok: true });
  mockRemoveAllUnder.mockResolvedValue(null);
  vi.spyOn(console, "error").mockImplementation(() => {});
});

describe("POST /api/v1/me/dependents/[id]/consents", () => {
  it("records the guardian's consent on a minor's behalf", async () => {
    const res = await grantConsent(
      post("consents", { category: "health" }),
      params(),
    );

    expect(res.status).toBe(200);
    expect(mockGetDependent).toHaveBeenCalledWith(GUARDIAN, CHILD_ID);
    expect(mockRpc).toHaveBeenCalledWith("record_sensitive_data_consent", {
      p_user_id: CHILD_ID,
      p_category: "health",
      p_granted: true,
      p_version: onBehalfConsent("health", "minor").version,
      p_recorded_by: GUARDIAN,
    });
    expect((await res.json()).data).toEqual({
      category: "health",
      basis: "minor",
      version: onBehalfConsent("health", "minor").version,
      statement: onBehalfConsent("health", "minor").statement,
      changed: true,
    });
  });

  it("uses the helper's wording for an adult who authorised them", async () => {
    mockGetDependent.mockResolvedValue({
      ok: true,
      data: view({ basis: "authorised", relationship: "carer" }),
    });
    const res = await grantConsent(
      post("consents", { category: "financial" }),
      params(),
    );

    expect((await res.json()).data.statement).toBe(
      onBehalfConsent("financial", "authorised").statement,
    );
  });

  it("404s for anyone who isn't the active guardian, recording nothing", async () => {
    mockGetDependent.mockResolvedValue({ ok: true, data: null });
    const res = await grantConsent(
      post("consents", { category: "health" }),
      params(),
    );

    expect(res.status).toBe(404);
    expect(mockRpc).not.toHaveBeenCalled();
  });

  it("401s without a session", async () => {
    mockGetClaims.mockResolvedValue({ data: null, error: null });
    const res = await grantConsent(
      post("consents", { category: "health" }),
      params(),
    );
    expect(res.status).toBe(401);
  });

  it("refuses an unknown category", async () => {
    const res = await grantConsent(
      post("consents", { category: "genetic" }),
      params(),
    );
    expect(res.status).toBe(400);
    expect(mockRpc).not.toHaveBeenCalled();
  });

  it("404s when the guardianship ends before the consent is written", async () => {
    mockRpc.mockResolvedValue({
      data: null,
      error: {
        message: "NOT_GUARDIAN: only the player or someone acting for them",
      },
    });
    const res = await grantConsent(
      post("consents", { category: "health" }),
      params(),
    );
    expect(res.status).toBe(404);
  });

  it("500s on any other database error without leaking it", async () => {
    mockRpc.mockResolvedValue({ data: null, error: { message: "db down" } });
    const res = await grantConsent(
      post("consents", { category: "health" }),
      params(),
    );
    expect(res.status).toBe(500);
    expect(JSON.stringify(await res.json())).not.toContain("db down");
  });
});

describe("POST /api/v1/me/dependents/[id]/oku", () => {
  const PATH = `users/${CHILD_ID}/oku/1700000000000.png`;

  it("registers a card uploaded into the dependent's folder", async () => {
    const res = await submitOku(post("oku", { document_path: PATH }), params());

    expect(res.status).toBe(200);
    expect(mockRpc).toHaveBeenCalledWith("has_sensitive_data_consent", {
      p_user_id: CHILD_ID,
      p_category: "health",
    });
    expect(mockAssertUploaded).toHaveBeenCalledWith(
      "oku-documents",
      PATH,
      expect.anything(),
    );
    expect(mockUpsert).toHaveBeenCalledWith(
      expect.objectContaining({
        user_id: CHILD_ID,
        oku_status: "pending",
        oku_document_path: PATH,
      }),
      { onConflict: "user_id" },
    );
  });

  it("refuses a path outside the dependent's folder, such as the guardian's own", async () => {
    const res = await submitOku(
      post("oku", { document_path: `users/${GUARDIAN}/oku/1.png` }),
      params(),
    );

    expect(res.status).toBe(400);
    expect((await res.json()).error.message).toMatch(
      /uploaded for this player/,
    );
    expect(mockUpsert).not.toHaveBeenCalled();
  });

  it("needs the dependent's consent, not the guardian's", async () => {
    mockRpc.mockResolvedValue({ data: false, error: null });
    const res = await submitOku(post("oku", { document_path: PATH }), params());

    expect(res.status).toBe(409);
    expect((await res.json()).error.code).toBe("CONSENT_REQUIRED");
    expect(mockRpc).toHaveBeenCalledWith(
      "has_sensitive_data_consent",
      expect.objectContaining({ p_user_id: CHILD_ID }),
    );
    expect(mockUpsert).not.toHaveBeenCalled();
  });

  it("404s for anyone who isn't the active guardian, touching nothing", async () => {
    mockGetDependent.mockResolvedValue({ ok: true, data: null });
    const res = await submitOku(post("oku", { document_path: PATH }), params());

    expect(res.status).toBe(404);
    expect(mockRpc).not.toHaveBeenCalled();
    expect(mockAssertUploaded).not.toHaveBeenCalled();
    expect(mockUpsert).not.toHaveBeenCalled();
  });
});

describe("DELETE /api/v1/me/dependents/[id]/oku", () => {
  const del = () =>
    removeOku(
      new NextRequest(`${BASE}/${CHILD_ID}/oku`, { method: "DELETE" }),
      params(),
    );

  it("deletes the dependent's cards, resets their status and records who withdrew", async () => {
    const res = await del();

    expect(res.status).toBe(200);
    expect(mockRemoveAllUnder).toHaveBeenCalledWith(
      "oku-documents",
      `users/${CHILD_ID}`,
    );
    expect(mockUpdate).toHaveBeenCalledWith(
      expect.objectContaining({ oku_status: "none" }),
    );
    expect(mockUpdateEq).toHaveBeenCalledWith("user_id", CHILD_ID);
    expect(mockRpc).toHaveBeenCalledWith("record_sensitive_data_consent", {
      p_user_id: CHILD_ID,
      p_category: "health",
      p_granted: false,
      p_recorded_by: GUARDIAN,
    });
  });

  it("records nothing when the files can't be removed", async () => {
    mockRemoveAllUnder.mockResolvedValue({ message: "storage down" });
    const res = await del();

    expect(res.status).toBe(500);
    expect(mockUpdate).not.toHaveBeenCalled();
    expect(mockRpc).not.toHaveBeenCalled();
  });

  it("404s for anyone who isn't the active guardian, deleting nothing", async () => {
    mockGetDependent.mockResolvedValue({ ok: true, data: null });
    const res = await del();

    expect(res.status).toBe(404);
    expect(mockRemoveAllUnder).not.toHaveBeenCalled();
  });
});
