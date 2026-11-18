import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { appIdFor } from "@/test/identity";
import { NextRequest } from "next/server";

const {
  mockUpsert,
  mockUpdate,
  mockUpdateEq,
  mockFrom,
  mockGetClaims,
  mockInfo,
  mockList,
  mockRemove,
  mockRpc,
} = vi.hoisted(() => {
  const mockUpsert = vi.fn();
  const mockUpdateEq = vi.fn();
  const mockUpdate = vi.fn(() => ({ eq: mockUpdateEq }));
  const mockInfo = vi.fn();
  return {
    mockUpsert,
    mockUpdate,
    mockUpdateEq,
    mockInfo,
    mockList: vi.fn(),
    mockRemove: vi.fn(),
    mockRpc: vi.fn(),
    mockFrom: vi.fn(() => ({ upsert: mockUpsert, update: mockUpdate })),
    mockGetClaims: vi.fn(),
  };
});

vi.mock("@/services/supabase/admin", () => ({
  supabaseAdmin: {
    from: mockFrom,
    rpc: mockRpc,
    storage: {
      from: vi.fn(() => ({
        info: mockInfo,
        list: mockList,
        remove: mockRemove,
      })),
    },
  },
}));
vi.mock("@/services/supabase/server", () => ({
  createClient: vi.fn().mockResolvedValue({
    auth: { getClaims: mockGetClaims },
  }),
}));
vi.mock("next/headers", () => ({
  cookies: vi.fn().mockResolvedValue({ getAll: () => [], set: vi.fn() }),
}));

import { DELETE, POST } from "../route";
import { hitWindow } from "@/services/rate-limit/window";

const USER = "bbbbbbbb-0000-0000-0000-000000000001";
// The JWT sub is the AUTH id; the OKU folder and the profile row are keyed by
// the resolved users.id, which is what the storage policy checks via app_user_id().
const APP_USER = appIdFor(USER);

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
    mockInfo.mockResolvedValue({
      data: { size: 1024, contentType: "image/png" },
      error: null,
    });
    // has_sensitive_data_consent: the player has consented.
    mockRpc.mockResolvedValue({ data: true, error: null });
  });
  afterEach(() => vi.restoreAllMocks());

  it("401 when unauthenticated", async () => {
    mockGetClaims.mockResolvedValue({ data: { claims: null }, error: null });
    const res = await POST(
      makeReq({ document_path: `users/${APP_USER}/oku/1.png` }),
    );
    expect(res.status).toBe(401);
  });

  it("429 once the user is over the submission limit, recording nothing", async () => {
    vi.mocked(hitWindow).mockResolvedValueOnce(7200);
    const res = await POST(
      makeReq({ document_path: `users/${APP_USER}/oku/1.png` }),
    );

    expect(hitWindow).toHaveBeenCalledWith(
      `ratelimit:okuDocument:user:${APP_USER}`,
      5,
      86400,
    );
    expect(res.status).toBe(429);
    expect(res.headers.get("Retry-After")).toBe("7200");
    expect(mockUpsert).not.toHaveBeenCalled();
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
      makeReq({ document_path: `users/${APP_USER}/oku/../../secret.png` }),
    );
    expect(res.status).toBe(400);
  });

  it("200 and sets pending for a valid own-folder path", async () => {
    const res = await POST(
      makeReq({ document_path: `users/${APP_USER}/oku/12345.png` }),
    );
    expect(res.status).toBe(200);
    expect(mockUpsert).toHaveBeenCalledTimes(1);
    const payload = mockUpsert.mock.calls[0][0];
    expect(payload.user_id).toBe(APP_USER);
    expect(payload.oku_status).toBe("pending");
    expect(payload.oku_document_path).toBe(`users/${APP_USER}/oku/12345.png`);
    expect(payload.oku_reviewed_by).toBeNull();
  });

  // MAX_BYTES in the uploader is a UX affordance; the file never passes through
  // this route, so these three are the only enforcement that exists.
  it("400 when no object exists at the claimed path", async () => {
    mockInfo.mockResolvedValue({ data: null, error: { message: "not found" } });
    const res = await POST(
      makeReq({ document_path: `users/${APP_USER}/oku/ghost.png` }),
    );
    expect(res.status).toBe(400);
    expect(mockUpsert).not.toHaveBeenCalled();
  });

  it("400 when the uploaded object exceeds 5MB", async () => {
    mockInfo.mockResolvedValue({
      data: { size: 6 * 1024 * 1024, contentType: "image/png" },
      error: null,
    });
    const res = await POST(
      makeReq({ document_path: `users/${APP_USER}/oku/big.png` }),
    );
    expect(res.status).toBe(400);
    expect(mockUpsert).not.toHaveBeenCalled();
  });

  it("400 when the uploaded object is a disallowed type", async () => {
    mockInfo.mockResolvedValue({
      data: { size: 1024, contentType: "application/zip" },
      error: null,
    });
    const res = await POST(
      makeReq({ document_path: `users/${APP_USER}/oku/payload.zip` }),
    );
    expect(res.status).toBe(400);
    expect(mockUpsert).not.toHaveBeenCalled();
  });

  // The card is health data (#451). The storage policy refused the upload
  // without consent; this is the second check, before a reviewer sees it.
  it("409 CONSENT_REQUIRED without health consent, recording nothing", async () => {
    mockRpc.mockResolvedValue({ data: false, error: null });
    const res = await POST(
      makeReq({ document_path: `users/${APP_USER}/oku/1.png` }),
    );
    expect(mockRpc).toHaveBeenCalledWith("has_sensitive_data_consent", {
      p_user_id: APP_USER,
      p_category: "health",
    });
    expect(res.status).toBe(409);
    expect((await res.json()).error.code).toBe("CONSENT_REQUIRED");
    expect(mockUpsert).not.toHaveBeenCalled();
  });

  it("500 when the consent check fails, recording nothing", async () => {
    mockRpc.mockResolvedValue({ data: null, error: { message: "db down" } });
    const res = await POST(
      makeReq({ document_path: `users/${APP_USER}/oku/1.png` }),
    );
    expect(res.status).toBe(500);
    expect(mockUpsert).not.toHaveBeenCalled();
  });

  it("500 when the upsert fails", async () => {
    mockUpsert.mockResolvedValue({ error: { message: "db down" } });
    const res = await POST(
      makeReq({ document_path: `users/${APP_USER}/oku/1.png` }),
    );
    expect(res.status).toBe(500);
  });
});

describe("DELETE /api/v1/profile/oku", () => {
  const FOLDER = `users/${APP_USER}/oku`;

  beforeEach(() => {
    vi.clearAllMocks();
    mockGetClaims.mockResolvedValue({
      data: { claims: { sub: USER } },
      error: null,
    });
    // A rejected card and its resubmission: both must go.
    mockList.mockResolvedValue({
      data: [{ name: "1.png" }, { name: "2.pdf" }],
      error: null,
    });
    mockRemove.mockResolvedValue({ data: [], error: null });
    mockUpdateEq.mockResolvedValue({ error: null });
    // record_sensitive_data_consent: a withdrawal was written.
    mockRpc.mockResolvedValue({ data: true, error: null });
  });
  afterEach(() => vi.restoreAllMocks());

  it("401 when unauthenticated, touching nothing", async () => {
    mockGetClaims.mockResolvedValue({ data: { claims: null }, error: null });
    const res = await DELETE();
    expect(res.status).toBe(401);
    expect(mockList).not.toHaveBeenCalled();
    expect(mockRpc).not.toHaveBeenCalled();
  });

  it("deletes every card, resets OKU status, then records the withdrawal", async () => {
    const res = await DELETE();
    expect(res.status).toBe(200);

    expect(mockList).toHaveBeenCalledWith(FOLDER, { limit: 1000 });
    expect(mockRemove).toHaveBeenCalledWith([
      `${FOLDER}/1.png`,
      `${FOLDER}/2.pdf`,
    ]);
    expect(mockUpdate).toHaveBeenCalledWith({
      oku_status: "none",
      oku_document_path: null,
      oku_reviewed_by: null,
      oku_reviewed_at: null,
      oku_rejection_reason: null,
    });
    expect(mockUpdateEq).toHaveBeenCalledWith("user_id", APP_USER);
    expect(mockRpc).toHaveBeenCalledWith("record_sensitive_data_consent", {
      p_user_id: APP_USER,
      p_category: "health",
      p_granted: false,
    });

    // The withdrawal is recorded only after the data is gone.
    const removedAt = mockRemove.mock.invocationCallOrder[0];
    const resetAt = mockUpdate.mock.invocationCallOrder[0];
    const withdrawnAt = mockRpc.mock.invocationCallOrder[0];
    expect(removedAt).toBeLessThan(resetAt);
    expect(resetAt).toBeLessThan(withdrawnAt);
  });

  it("skips the storage removal when there are no files", async () => {
    mockList.mockResolvedValue({ data: [], error: null });
    const res = await DELETE();
    expect(res.status).toBe(200);
    expect(mockRemove).not.toHaveBeenCalled();
    expect(mockRpc).toHaveBeenCalledTimes(1);
  });

  it("500 and no withdrawal recorded when the files can't be removed", async () => {
    mockRemove.mockResolvedValue({ data: null, error: { message: "boom" } });
    const res = await DELETE();
    expect(res.status).toBe(500);
    expect(mockUpdate).not.toHaveBeenCalled();
    expect(mockRpc).not.toHaveBeenCalled();
  });

  it("500 and no withdrawal recorded when the files can't be listed", async () => {
    mockList.mockResolvedValue({ data: null, error: { message: "boom" } });
    const res = await DELETE();
    expect(res.status).toBe(500);
    expect(mockRemove).not.toHaveBeenCalled();
    expect(mockRpc).not.toHaveBeenCalled();
  });

  it("500 and no withdrawal recorded when the profile can't be reset", async () => {
    mockUpdateEq.mockResolvedValue({ error: { message: "boom" } });
    const res = await DELETE();
    expect(res.status).toBe(500);
    expect(mockRpc).not.toHaveBeenCalled();
  });

  it("500 when the withdrawal can't be recorded", async () => {
    mockRpc.mockResolvedValue({ data: null, error: { message: "boom" } });
    const res = await DELETE();
    expect(res.status).toBe(500);
  });
});
