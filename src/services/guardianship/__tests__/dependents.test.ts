import { beforeEach, describe, expect, it, vi } from "vitest";

const { mockFrom, chain } = vi.hoisted(() => {
  const chain: Record<string, ReturnType<typeof vi.fn>> = {};
  chain.select = vi.fn(() => chain);
  chain.eq = vi.fn(() => chain);
  chain.order = vi.fn();
  chain.maybeSingle = vi.fn();
  return { mockFrom: vi.fn(() => chain), chain };
});

vi.mock("@/services/supabase/admin", () => ({
  supabaseAdmin: { from: mockFrom },
}));

import {
  dependentErrorResponse,
  getDependent,
  listDependents,
} from "../dependents";

const ROW = {
  id: "g1",
  relationship: "carer",
  basis: "authorised",
  authorisation_method: "guardian_attestation",
  terms_version: "2026-11-24",
  terms_accepted_at: "2026-11-24T01:00:00Z",
  created_at: "2026-11-24T01:00:00Z",
  dependent: {
    id: "u1",
    first_name: "Ada",
    last_name: "Assisted",
    account_type: "managed",
    contact_email: "ada@example.com",
    player_profiles: {
      date_of_birth: "1980-01-01",
      gender: "female",
      nationality: "Malaysia",
      fide_id: null,
      mcf_id: 7,
      title: null,
      national_rating: null,
      oku_status: "verified",
    },
  },
};

beforeEach(() => vi.clearAllMocks());

describe("listDependents", () => {
  it("reads only the guardian's active guardianships and flattens each row", async () => {
    chain.order.mockResolvedValue({
      data: [ROW, { ...ROW, id: "g2", dependent: null }],
      error: null,
    });
    const result = await listDependents("guardian");
    expect(mockFrom).toHaveBeenCalledWith("guardianships");
    expect(chain.eq).toHaveBeenCalledWith("guardian_user_id", "guardian");
    expect(chain.eq).toHaveBeenCalledWith("status", "active");
    expect(result).toEqual({
      ok: true,
      data: [
        {
          id: "u1",
          guardianship_id: "g1",
          first_name: "Ada",
          last_name: "Assisted",
          account_type: "managed",
          contact_email: "ada@example.com",
          relationship: "carer",
          basis: "authorised",
          authorisation_method: "guardian_attestation",
          terms_version: "2026-11-24",
          terms_accepted_at: "2026-11-24T01:00:00Z",
          added_at: "2026-11-24T01:00:00Z",
          date_of_birth: "1980-01-01",
          gender: "female",
          nationality: "Malaysia",
          fide_id: null,
          mcf_id: 7,
          title: null,
          national_rating: null,
          oku_status: "verified",
        },
      ],
    });
  });

  it("passes a database error back", async () => {
    const error = { message: "boom" };
    chain.order.mockResolvedValue({ data: null, error });
    expect(await listDependents("guardian")).toEqual({ ok: false, error });
  });
});

describe("getDependent", () => {
  it("matches guardian, dependent and active status, and tolerates a missing profile", async () => {
    chain.maybeSingle.mockResolvedValue({
      data: { ...ROW, dependent: { ...ROW.dependent, player_profiles: [] } },
      error: null,
    });
    const result = await getDependent("guardian", "u1");
    expect(chain.eq).toHaveBeenCalledWith("guardian_user_id", "guardian");
    expect(chain.eq).toHaveBeenCalledWith("dependent_user_id", "u1");
    expect(chain.eq).toHaveBeenCalledWith("status", "active");
    expect(result.ok && result.data).toMatchObject({
      id: "u1",
      date_of_birth: null,
      oku_status: "none",
    });
  });

  it("returns null when there is no active guardianship", async () => {
    chain.maybeSingle.mockResolvedValue({ data: null, error: null });
    expect(await getDependent("guardian", "u1")).toEqual({
      ok: true,
      data: null,
    });
  });
});

describe("dependentErrorResponse", () => {
  it.each([
    ["DEPENDENT_NOT_FOUND: x", 404],
    ["DEPENDENT_EXISTS: x", 409],
    ["DEPENDENT_HAS_PENDING_PAYMENT: x", 422],
    ["GUARDIANSHIP_LIMIT_REACHED: x", 422],
    ["GUARDIAN_NOT_ELIGIBLE: x", 403],
    ["BASIS_AGE_MISMATCH: x", 422],
    ["BASIS_NOT_SUPPORTED: x", 422],
    ["INVALID_DEPENDENT: x", 400],
  ])("maps %s to %i", (message, status) => {
    expect(dependentErrorResponse({ message }, "testing").status).toBe(status);
  });

  it("hides anything else behind a 500", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const res = dependentErrorResponse({ message: "secret" }, "testing");
    expect(res.status).toBe(500);
    expect(JSON.stringify(await res.json())).not.toContain("secret");
  });
});
