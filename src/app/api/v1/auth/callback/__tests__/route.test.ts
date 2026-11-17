import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  exchangeCodeForSession: vi.fn(),
  verifyOtp: vi.fn(),
  redirect: vi.fn(),
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
  mocks.verifyOtp.mockResolvedValue({ error: null });
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
});
