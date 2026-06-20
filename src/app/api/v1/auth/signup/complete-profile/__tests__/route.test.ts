import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

// ---------------------------------------------------------------------------
// Mocks — must be hoisted so vi.mock factories can reference them
// ---------------------------------------------------------------------------

const { mockGetUser, mockUpsert, mockUpdateEq, mockUpdate, mockFrom } =
  vi.hoisted(() => {
    const mockGetUser = vi.fn();
    const mockUpsert = vi.fn();
    const mockUpdateEq = vi.fn();
    const mockUpdate = vi.fn(() => ({ eq: mockUpdateEq }));
    // from() routes to the right builder per table.
    const mockFrom = vi.fn((table: string) => {
      if (table === "player_profiles") return { upsert: mockUpsert };
      return { update: mockUpdate }; // "users"
    });
    return { mockGetUser, mockUpsert, mockUpdateEq, mockUpdate, mockFrom };
  });

vi.mock("@/services/supabase/server", () => ({
  createClient: vi.fn().mockResolvedValue({
    auth: { getUser: mockGetUser },
  }),
}));

vi.mock("@/services/supabase/admin", () => ({
  supabaseAdmin: { from: mockFrom },
}));

import { POST } from "../route";

// ---------------------------------------------------------------------------
// Fixtures & helpers
// ---------------------------------------------------------------------------

const USER_ID = "user-123";

const validBody = {
  gender: "Male",
  nationality: "Malaysian",
  dateOfBirth: "1990-01-01",
  fideId: "12345678",
  mcfId: "7654321",
  isOku: false,
};

function makeRequest(body: unknown): NextRequest {
  return new NextRequest(
    "http://localhost/api/v1/auth/signup/complete-profile",
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    },
  );
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("POST /api/v1/auth/signup/complete-profile", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetUser.mockResolvedValue({ data: { user: { id: USER_ID } } });
    mockUpsert.mockResolvedValue({ error: null });
    mockUpdateEq.mockResolvedValue({ error: null });
    mockUpdate.mockReturnValue({ eq: mockUpdateEq });
    mockFrom.mockImplementation((table: string) => {
      if (table === "player_profiles") return { upsert: mockUpsert };
      return { update: mockUpdate };
    });
  });

  // --- Auth -----------------------------------------------------------------

  it("returns 401 when not authenticated", async () => {
    mockGetUser.mockResolvedValue({ data: { user: null } });

    const res = await POST(makeRequest(validBody));
    const json = await res.json();

    expect(res.status).toBe(401);
    expect(json.error.code).toBe("UNAUTHORIZED");
    expect(mockUpsert).not.toHaveBeenCalled();
  });

  // --- Success / persistence ------------------------------------------------

  it("upserts the profile keyed on user_id (not a plain update)", async () => {
    const res = await POST(makeRequest(validBody));

    expect(res.status).toBe(200);
    expect(mockFrom).toHaveBeenCalledWith("player_profiles");
    expect(mockUpsert).toHaveBeenCalledWith(
      expect.objectContaining({
        user_id: USER_ID,
        gender: "male",
        nationality: "Malaysian",
        date_of_birth: "1990-01-01",
        fide_id: "12345678",
        mcf_id: "7654321",
        is_oku: false,
      }),
      { onConflict: "user_id" },
    );
  });

  it("only touches the avatar when avatarUrl is provided", async () => {
    await POST(makeRequest(validBody));
    expect(mockUpdate).not.toHaveBeenCalled();

    vi.clearAllMocks();
    mockGetUser.mockResolvedValue({ data: { user: { id: USER_ID } } });
    mockUpsert.mockResolvedValue({ error: null });
    mockUpdateEq.mockResolvedValue({ error: null });
    mockUpdate.mockReturnValue({ eq: mockUpdateEq });
    mockFrom.mockImplementation((table: string) => {
      if (table === "player_profiles") return { upsert: mockUpsert };
      return { update: mockUpdate };
    });

    await POST(makeRequest({ ...validBody, avatarUrl: "https://cdn/x.png" }));
    expect(mockFrom).toHaveBeenCalledWith("users");
    expect(mockUpdate).toHaveBeenCalledWith({
      avatar_url: "https://cdn/x.png",
    });
    expect(mockUpdateEq).toHaveBeenCalledWith("id", USER_ID);
  });

  // --- Validation -----------------------------------------------------------

  it("rejects an invalid gender", async () => {
    const res = await POST(makeRequest({ ...validBody, gender: "other" }));
    const json = await res.json();

    expect(res.status).toBe(400);
    expect(json.error.code).toBe("VALIDATION_ERROR");
    expect(mockUpsert).not.toHaveBeenCalled();
  });

  it("rejects a non-numeric FIDE ID", async () => {
    const res = await POST(makeRequest({ ...validBody, fideId: "12ab" }));
    const json = await res.json();

    expect(res.status).toBe(400);
    expect(json.error.code).toBe("VALIDATION_ERROR");
    expect(mockUpsert).not.toHaveBeenCalled();
  });

  it("rejects a non-numeric MCF ID", async () => {
    const res = await POST(makeRequest({ ...validBody, mcfId: "7x" }));
    const json = await res.json();

    expect(res.status).toBe(400);
    expect(json.error.code).toBe("VALIDATION_ERROR");
    expect(mockUpsert).not.toHaveBeenCalled();
  });

  it("rejects a malformed date of birth", async () => {
    const res = await POST(
      makeRequest({ ...validBody, dateOfBirth: "2020-13-40" }),
    );
    const json = await res.json();

    expect(res.status).toBe(400);
    expect(json.error.code).toBe("VALIDATION_ERROR");
    expect(mockUpsert).not.toHaveBeenCalled();
  });

  it("rejects a date of birth in the future", async () => {
    const res = await POST(
      makeRequest({ ...validBody, dateOfBirth: "2999-01-01" }),
    );
    const json = await res.json();

    expect(res.status).toBe(400);
    expect(json.error.message).toMatch(/future/i);
    expect(mockUpsert).not.toHaveBeenCalled();
  });

  it("rejects an implausibly old date of birth", async () => {
    const res = await POST(
      makeRequest({ ...validBody, dateOfBirth: "1800-01-01" }),
    );
    const json = await res.json();

    expect(res.status).toBe(400);
    expect(json.error.code).toBe("VALIDATION_ERROR");
    expect(mockUpsert).not.toHaveBeenCalled();
  });

  it("accepts a profile with no date of birth", async () => {
    const res = await POST(
      makeRequest({
        gender: "Male",
        nationality: "Malaysian",
        fideId: "12345678",
        mcfId: "7654321",
        isOku: false,
      }),
    );

    expect(res.status).toBe(200);
    expect(mockUpsert).toHaveBeenCalled();
  });

  // --- Persistence failure --------------------------------------------------

  it("returns 500 when the profile upsert fails", async () => {
    mockUpsert.mockResolvedValue({ error: { message: "upsert failed" } });

    const res = await POST(makeRequest(validBody));
    const json = await res.json();

    expect(res.status).toBe(500);
    expect(json.error.code).toBe("INTERNAL_ERROR");
  });
});
