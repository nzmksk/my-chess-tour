import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const { mockBuilder, mockFrom, mockGetClaims, mockRpc } = vi.hoisted(() => {
  function makeBuilder(finalResult: { data?: unknown; error?: unknown }) {
    const b: Record<string, unknown> = {};
    for (const m of ["select", "eq", "update", "maybeSingle"]) {
      b[m] = vi.fn(() => b);
    }
    b.then = (
      onfulfilled: (v: unknown) => unknown,
      onrejected?: (r: unknown) => unknown,
    ) => Promise.resolve(finalResult).then(onfulfilled, onrejected);
    return b;
  }
  const mockBuilder = makeBuilder({ data: null, error: null });
  return {
    mockBuilder,
    mockFrom: vi.fn(() => mockBuilder),
    mockGetClaims: vi.fn(),
    mockRpc: vi.fn(),
  };
});

vi.mock("@/services/supabase/admin", () => ({
  supabaseAdmin: { from: mockFrom },
}));
vi.mock("@/services/supabase/server", () => ({
  createClient: vi.fn().mockResolvedValue({
    auth: { getClaims: mockGetClaims },
    rpc: mockRpc,
  }),
}));
vi.mock("next/headers", () => ({
  cookies: vi.fn().mockResolvedValue({ getAll: () => [], set: vi.fn() }),
}));

import { PATCH } from "../route";

const ADMIN = "aaaaaaaa-0000-0000-0000-000000000001";
const USER = "bbbbbbbb-0000-0000-0000-000000000001";

function makeReq(userId = USER, body: object = { action: "approve" }) {
  return new NextRequest(`http://localhost/api/v1/admin/oku/${userId}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}
function setBuilder(result: { data?: unknown; error?: unknown }) {
  mockBuilder.then = (
    onfulfilled: (v: unknown) => unknown,
    onrejected?: (r: unknown) => unknown,
  ) => Promise.resolve(result).then(onfulfilled, onrejected);
}

describe("PATCH /api/v1/admin/oku/:userId", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetClaims.mockResolvedValue({
      data: { claims: { sub: ADMIN } },
      error: null,
    });
    mockRpc.mockResolvedValue({ data: true, error: null });
    setBuilder({
      data: { user_id: USER, oku_status: "verified" },
      error: null,
    });
    mockFrom.mockReturnValue(mockBuilder);
  });
  afterEach(() => vi.restoreAllMocks());

  it("400 for non-UUID user id", async () => {
    const res = await PATCH(makeReq("nope"), {
      params: Promise.resolve({ userId: "nope" }),
    });
    expect(res.status).toBe(400);
  });

  it("401 when unauthenticated", async () => {
    mockGetClaims.mockResolvedValue({ data: { claims: null }, error: null });
    const res = await PATCH(makeReq(), {
      params: Promise.resolve({ userId: USER }),
    });
    expect(res.status).toBe(401);
  });

  it("403 when not admin", async () => {
    mockRpc.mockResolvedValue({ data: false, error: null });
    const res = await PATCH(makeReq(), {
      params: Promise.resolve({ userId: USER }),
    });
    expect(res.status).toBe(403);
  });

  it("400 for invalid action", async () => {
    const res = await PATCH(makeReq(USER, { action: "delete" }), {
      params: Promise.resolve({ userId: USER }),
    });
    expect(res.status).toBe(400);
  });

  it("400 when rejecting without a reason", async () => {
    const res = await PATCH(makeReq(USER, { action: "reject" }), {
      params: Promise.resolve({ userId: USER }),
    });
    expect(res.status).toBe(400);
  });

  it("200 on approve", async () => {
    const res = await PATCH(makeReq(USER, { action: "approve" }), {
      params: Promise.resolve({ userId: USER }),
    });
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.data.oku_status).toBe("verified");
  });

  it("200 on reject with a reason", async () => {
    setBuilder({
      data: { user_id: USER, oku_status: "rejected" },
      error: null,
    });
    const res = await PATCH(
      makeReq(USER, { action: "reject", rejection_reason: "Blurry scan" }),
      { params: Promise.resolve({ userId: USER }) },
    );
    expect(res.status).toBe(200);
  });

  it("404 when there is no pending submission to review", async () => {
    setBuilder({ data: null, error: null });
    const res = await PATCH(makeReq(), {
      params: Promise.resolve({ userId: USER }),
    });
    expect(res.status).toBe(404);
  });
});
