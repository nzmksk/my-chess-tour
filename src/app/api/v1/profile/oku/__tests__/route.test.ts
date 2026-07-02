import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const { mockUpsert, mockFrom, mockGetClaims } = vi.hoisted(() => {
  const mockUpsert = vi.fn();
  return {
    mockUpsert,
    mockFrom: vi.fn(() => ({ upsert: mockUpsert })),
    mockGetClaims: vi.fn(),
  };
});

vi.mock("@/services/supabase/admin", () => ({
  supabaseAdmin: { from: mockFrom },
}));
vi.mock("@/services/supabase/server", () => ({
  createClient: vi.fn().mockResolvedValue({
    auth: { getClaims: mockGetClaims },
  }),
}));
vi.mock("next/headers", () => ({
  cookies: vi.fn().mockResolvedValue({ getAll: () => [], set: vi.fn() }),
}));

import { POST } from "../route";

const USER = "bbbbbbbb-0000-0000-0000-000000000001";

function makeReq(body: object) {
  return new NextRequest("http://localhost/api/v1/profile/oku", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

describe("POST /api/v1/profile/oku", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetClaims.mockResolvedValue({
      data: { claims: { sub: USER } },
      error: null,
    });
    mockUpsert.mockResolvedValue({ error: null });
  });
  afterEach(() => vi.restoreAllMocks());

  it("401 when unauthenticated", async () => {
    mockGetClaims.mockResolvedValue({ data: { claims: null }, error: null });
    const res = await POST(
      makeReq({ document_path: `users/${USER}/oku/1.png` }),
    );
    expect(res.status).toBe(401);
  });

  it("400 when document_path is missing", async () => {
    const res = await POST(makeReq({}));
    expect(res.status).toBe(400);
  });

  it("400 when document_path points at another user's folder", async () => {
    const res = await POST(
      makeReq({ document_path: "users/someone-else/oku/1.png" }),
    );
    expect(res.status).toBe(400);
    expect(mockUpsert).not.toHaveBeenCalled();
  });

  it("400 when document_path contains a traversal segment", async () => {
    const res = await POST(
      makeReq({ document_path: `users/${USER}/oku/../../secret.png` }),
    );
    expect(res.status).toBe(400);
  });

  it("200 and sets pending for a valid own-folder path", async () => {
    const res = await POST(
      makeReq({ document_path: `users/${USER}/oku/12345.png` }),
    );
    expect(res.status).toBe(200);
    expect(mockUpsert).toHaveBeenCalledTimes(1);
    const payload = mockUpsert.mock.calls[0][0];
    expect(payload.user_id).toBe(USER);
    expect(payload.oku_status).toBe("pending");
    expect(payload.oku_document_path).toBe(`users/${USER}/oku/12345.png`);
    expect(payload.oku_reviewed_by).toBeNull();
  });

  it("500 when the upsert fails", async () => {
    mockUpsert.mockResolvedValue({ error: { message: "db down" } });
    const res = await POST(
      makeReq({ document_path: `users/${USER}/oku/1.png` }),
    );
    expect(res.status).toBe(500);
  });
});
