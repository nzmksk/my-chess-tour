import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => {
  const updateResult = { error: null as unknown };
  const updateBuilder: Record<string, unknown> = {};
  for (const m of ["update", "eq"]) {
    updateBuilder[m] = vi.fn(() => updateBuilder);
  }
  updateBuilder.then = (
    onfulfilled: (v: unknown) => unknown,
    onrejected?: (r: unknown) => unknown,
  ) => Promise.resolve(updateResult).then(onfulfilled, onrejected);
  return {
    exchangeCodeForSession: vi.fn(),
    verifyOtp: vi.fn(),
    redirect: vi.fn(),
    from: vi.fn(() => updateBuilder),
    updateBuilder,
    updateResult,
  };
});

vi.mock("@/services/supabase/admin", () => ({
  supabaseAdmin: { from: mocks.from },
}));

vi.mock("@/services/supabase/server", () => ({
  createClient: vi.fn(() =>
    Promise.resolve({
      auth: {
        exchangeCodeForSession: mocks.exchangeCodeForSession,
        verifyOtp: mocks.verifyOtp,
      },
    }),
  ),
}));

vi.mock("next/server", () => ({
  NextResponse: { redirect: mocks.redirect },
}));

import { GET } from "../route";

function makeRequest(path: string): Request {
  return new Request(`https://mychessstour.com${path}`);
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.redirect.mockReturnValue(new Response());
  mocks.exchangeCodeForSession.mockResolvedValue({ error: null });
  mocks.verifyOtp.mockResolvedValue({
    data: { user: { id: "auth-user-1" } },
    error: null,
  });
  mocks.updateResult.error = null;
});

describe("GET /api/v1/auth/callback", () => {
  it("redirects to error page when no code is present", async () => {
    await GET(makeRequest("/api/v1/auth/callback"));

    expect(mocks.redirect).toHaveBeenCalledWith(
      expect.stringContaining("/auth/forgot-password?error=invalid_link"),
    );
  });

  it("calls exchangeCodeForSession with the code", async () => {
    await GET(makeRequest("/api/v1/auth/callback?code=abc123"));

    expect(mocks.exchangeCodeForSession).toHaveBeenCalledWith("abc123");
  });

  it("redirects to next param on successful session exchange", async () => {
    await GET(
      makeRequest(
        "/api/v1/auth/callback?code=abc123&next=/auth/update-password",
      ),
    );

    expect(mocks.redirect).toHaveBeenCalledWith(
      expect.stringContaining("/auth/update-password"),
    );
  });

  it("redirects to / when next param is absent (default)", async () => {
    await GET(makeRequest("/api/v1/auth/callback?code=abc123"));

    expect(mocks.redirect).toHaveBeenCalledWith("https://mychessstour.com/");
  });

  it("redirects to error page when exchange fails", async () => {
    mocks.exchangeCodeForSession.mockResolvedValue({
      error: { message: "Invalid code" },
    });

    await GET(makeRequest("/api/v1/auth/callback?code=badcode"));

    expect(mocks.redirect).toHaveBeenCalledWith(
      expect.stringContaining("/auth/forgot-password?error=invalid_link"),
    );
  });

  it("calls verifyOtp when token_hash and type are present", async () => {
    await GET(
      makeRequest("/api/v1/auth/callback?token_hash=hash123&type=email"),
    );

    expect(mocks.verifyOtp).toHaveBeenCalledWith({
      token_hash: "hash123",
      type: "email",
    });
  });

  it("redirects to next param after successful verifyOtp", async () => {
    await GET(
      makeRequest(
        "/api/v1/auth/callback?token_hash=hash123&type=email&next=/auth/update-password",
      ),
    );

    expect(mocks.redirect).toHaveBeenCalledWith(
      expect.stringContaining("/auth/update-password"),
    );
  });

  it("redirects to error page when verifyOtp fails", async () => {
    mocks.verifyOtp.mockResolvedValue({ error: { message: "Invalid token" } });

    await GET(
      makeRequest("/api/v1/auth/callback?token_hash=badhash&type=email"),
    );

    expect(mocks.redirect).toHaveBeenCalledWith(
      expect.stringContaining("/auth/forgot-password?error=invalid_link"),
    );
  });

  describe("organization invite links", () => {
    it("marks the invited user verified, then redirects on", async () => {
      await GET(
        makeRequest(
          "/api/v1/auth/callback?token_hash=hash123&type=invite&next=/auth/update-password",
        ),
      );

      expect(mocks.from).toHaveBeenCalledWith("users");
      expect(mocks.updateBuilder.update).toHaveBeenCalledWith(
        expect.objectContaining({ is_verified: true }),
      );
      expect(mocks.updateBuilder.eq).toHaveBeenCalledWith(
        "auth_user_id",
        "auth-user-1",
      );
      expect(mocks.redirect).toHaveBeenCalledWith(
        "https://mychessstour.com/auth/update-password",
      );
    });

    it("still redirects on when marking verified fails", async () => {
      mocks.updateResult.error = { message: "db down" };
      const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});

      await GET(
        makeRequest(
          "/api/v1/auth/callback?token_hash=hash123&type=invite&next=/auth/update-password",
        ),
      );

      expect(mocks.redirect).toHaveBeenCalledWith(
        "https://mychessstour.com/auth/update-password",
      );
      expect(errSpy).toHaveBeenCalled();
      errSpy.mockRestore();
    });

    it("does not touch verification for other link types", async () => {
      await GET(
        makeRequest("/api/v1/auth/callback?token_hash=hash123&type=recovery"),
      );

      expect(mocks.from).not.toHaveBeenCalled();
    });

    it("does not mark anyone verified when the invite token is invalid", async () => {
      mocks.verifyOtp.mockResolvedValue({
        data: { user: null },
        error: { message: "Invalid token" },
      });

      await GET(
        makeRequest("/api/v1/auth/callback?token_hash=bad&type=invite"),
      );

      expect(mocks.from).not.toHaveBeenCalled();
      expect(mocks.redirect).toHaveBeenCalledWith(
        expect.stringContaining("/auth/forgot-password?error=invalid_link"),
      );
    });
  });
});
