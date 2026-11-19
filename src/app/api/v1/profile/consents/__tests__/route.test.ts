import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { appIdFor } from "@/test/identity";
import { NextRequest } from "next/server";
import { currentConsent } from "@/lib/reference/legal";

const { mockRpc, mockGetClaims } = vi.hoisted(() => ({
  mockRpc: vi.fn(),
  mockGetClaims: vi.fn(),
}));

vi.mock("@/services/supabase/admin", () => ({
  supabaseAdmin: { rpc: mockRpc },
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
const APP_USER = appIdFor(USER);

function makeReq(body: unknown) {
  return new NextRequest("http://localhost/api/v1/profile/consents", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: typeof body === "string" ? body : JSON.stringify(body),
  });
}

describe("POST /api/v1/profile/consents", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetClaims.mockResolvedValue({
      data: { claims: { sub: USER } },
      error: null,
    });
    mockRpc.mockResolvedValue({ data: true, error: null });
  });
  afterEach(() => vi.restoreAllMocks());

  it("401 when unauthenticated", async () => {
    mockGetClaims.mockResolvedValue({ data: { claims: null }, error: null });
    const res = await POST(makeReq({ category: "health" }));
    expect(res.status).toBe(401);
    expect(mockRpc).not.toHaveBeenCalled();
  });

  it("400 on invalid JSON", async () => {
    const res = await POST(makeReq("{not json"));
    expect(res.status).toBe(400);
  });

  it("400 on an unknown category", async () => {
    const res = await POST(makeReq({ category: "terms" }));
    expect(res.status).toBe(400);
    expect(mockRpc).not.toHaveBeenCalled();
  });

  it.each(["health", "financial"] as const)(
    "records a %s grant at the server's current version",
    async (category) => {
      const res = await POST(makeReq({ category }));
      expect(res.status).toBe(200);
      expect(mockRpc).toHaveBeenCalledWith("record_sensitive_data_consent", {
        p_user_id: APP_USER,
        p_category: category,
        p_granted: true,
        p_version: currentConsent(category).version,
      });
      const json = await res.json();
      expect(json.data).toEqual({
        category,
        version: currentConsent(category).version,
        changed: true,
      });
    },
  );

  it("ignores a version supplied in the body", async () => {
    // A client-chosen version is not evidence of which statement was shown.
    await POST(makeReq({ category: "health", version: "1999-01-01" }));
    expect(mockRpc.mock.calls[0][1].p_version).toBe(
      currentConsent("health").version,
    );
  });

  it("reports changed: false when the same version was already granted", async () => {
    mockRpc.mockResolvedValue({ data: false, error: null });
    const res = await POST(makeReq({ category: "financial" }));
    expect(res.status).toBe(200);
    expect((await res.json()).data.changed).toBe(false);
  });

  it("500 without leaking the database error", async () => {
    mockRpc.mockResolvedValue({
      data: null,
      error: { message: 'relation "sensitive_data_consents" does not exist' },
    });
    const res = await POST(makeReq({ category: "health" }));
    expect(res.status).toBe(500);
    expect(JSON.stringify(await res.json())).not.toContain("sensitive_data");
  });
});
