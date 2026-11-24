import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const { mockRpc, mockGetClaims } = vi.hoisted(() => ({
  mockRpc: vi.fn(),
  mockGetClaims: vi.fn(),
}));

vi.mock("@/services/supabase/admin", () => ({
  supabaseAdmin: { rpc: mockRpc },
}));
vi.mock("@/services/supabase/permission", () => ({
  getAuthClaims: mockGetClaims,
}));

import { GET } from "../route";

const USER_ID = "aaaaaaaa-0000-4000-8000-000000000001";

const call = (name?: string) =>
  GET(
    new NextRequest(
      name === undefined
        ? "http://localhost/api/v1/organizations/name-availability"
        : `http://localhost/api/v1/organizations/name-availability?name=${encodeURIComponent(name)}`,
    ),
  );

beforeEach(() => {
  vi.clearAllMocks();
  mockGetClaims.mockResolvedValue({ id: USER_ID });
  mockRpc.mockResolvedValue({ data: null, error: null });
});

describe("GET /api/v1/organizations/name-availability", () => {
  it("401s without a session", async () => {
    mockGetClaims.mockResolvedValue(null);
    expect((await call("KL Chess")).status).toBe(401);
    expect(mockRpc).not.toHaveBeenCalled();
  });

  it.each([
    ["missing", undefined],
    ["blank", "   "],
    ["too long", "a".repeat(256)],
  ])("400s when the name is %s", async (_label, name) => {
    const res = await call(name);
    expect(res.status).toBe(400);
    expect((await res.json()).error.code).toBe("VALIDATION_ERROR");
    expect(mockRpc).not.toHaveBeenCalled();
  });

  it("checks the trimmed name with the rule submission uses", async () => {
    const res = await call("  KL Chess Association  ");
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      data: { name: "KL Chess Association", available: true },
    });
    expect(mockRpc).toHaveBeenCalledWith("assert_org_name_available", {
      p_name: "KL Chess Association",
    });
  });

  it("reports a name an approved organization uses as unavailable", async () => {
    mockRpc.mockResolvedValue({
      data: null,
      error: {
        message: "NAME_TAKEN: an approved organization already uses this name",
      },
    });
    const res = await call("KL Chess Association");
    expect(res.status).toBe(200);
    expect((await res.json()).data.available).toBe(false);
  });

  it("500s on any other database error without leaking it", async () => {
    mockRpc.mockResolvedValue({
      data: null,
      error: { message: "connection refused" },
    });
    const res = await call("KL Chess Association");
    expect(res.status).toBe(500);
    expect(JSON.stringify(await res.json())).not.toContain(
      "connection refused",
    );
  });
});
