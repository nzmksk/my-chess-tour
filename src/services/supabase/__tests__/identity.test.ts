import { beforeEach, describe, expect, it, vi } from "vitest";

// src/test/setup.ts installs a global stub for this module so route tests don't
// have to model the identity lookup. This file is the one place that exercises
// the REAL implementation, so the stub has to be lifted here.
vi.unmock("@/services/supabase/identity");

const { mockMaybeSingle, mockEq, mockFrom } = vi.hoisted(() => {
  const mockMaybeSingle = vi.fn();
  const mockEq = vi.fn(() => ({ maybeSingle: mockMaybeSingle }));
  const mockSelect = vi.fn(() => ({ eq: mockEq }));
  const mockFrom = vi.fn(() => ({ select: mockSelect }));
  return { mockMaybeSingle, mockEq, mockFrom };
});

vi.mock("@/services/supabase/admin", () => ({
  supabaseAdmin: { from: mockFrom },
}));

import { lookupAppUserId } from "../identity";

const AUTH_ID = "aaaaaaaa-0000-0000-0000-000000000001";
const APP_ID = "bbbbbbbb-0000-0000-0000-000000000002";

describe("lookupAppUserId", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(console, "error").mockImplementation(() => {});
  });

  it("resolves the auth id to the linked public.users.id", async () => {
    mockMaybeSingle.mockResolvedValue({ data: { id: APP_ID }, error: null });

    await expect(lookupAppUserId(AUTH_ID)).resolves.toBe(APP_ID);
  });

  it("matches on auth_user_id, never on the primary key", async () => {
    mockMaybeSingle.mockResolvedValue({ data: { id: APP_ID }, error: null });

    await lookupAppUserId(AUTH_ID);

    expect(mockFrom).toHaveBeenCalledWith("users");
    // The whole point of the indirection: filtering on `id` would silently work
    // today (self-signup writes id = auth_user_id) and break the moment a record
    // is created without a login, or claimed by a new one.
    expect(mockEq).toHaveBeenCalledWith("auth_user_id", AUTH_ID);
  });

  it("returns null when no record is linked to the auth id", async () => {
    mockMaybeSingle.mockResolvedValue({ data: null, error: null });

    await expect(lookupAppUserId(AUTH_ID)).resolves.toBeNull();
  });

  it("returns null and logs when the lookup errors", async () => {
    mockMaybeSingle.mockResolvedValue({
      data: null,
      error: { message: "connection reset" },
    });

    await expect(lookupAppUserId(AUTH_ID)).resolves.toBeNull();
    expect(console.error).toHaveBeenCalled();
  });
});
