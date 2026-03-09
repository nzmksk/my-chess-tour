import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  exchangeCodeForSession: vi.fn(),
  redirect: vi.fn(),
}));

vi.mock("@/lib/supabase/server", () => ({
  createClient: vi.fn(() =>
    Promise.resolve({ auth: { exchangeCodeForSession: mocks.exchangeCodeForSession } })
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
});

describe("GET /auth/callback", () => {
  it("redirects to error page when no code is present", async () => {
    await GET(makeRequest("/auth/callback"));

    expect(mocks.redirect).toHaveBeenCalledWith(
      expect.stringContaining("/forgot-password?error=invalid_link"),
    );
  });

  it("calls exchangeCodeForSession with the code", async () => {
    await GET(makeRequest("/auth/callback?code=abc123"));

    expect(mocks.exchangeCodeForSession).toHaveBeenCalledWith("abc123");
  });

  it("redirects to next param on successful session exchange", async () => {
    await GET(makeRequest("/auth/callback?code=abc123&next=/update-password"));

    expect(mocks.redirect).toHaveBeenCalledWith(
      expect.stringContaining("/update-password"),
    );
  });

  it("redirects to / when next param is absent (default)", async () => {
    await GET(makeRequest("/auth/callback?code=abc123"));

    expect(mocks.redirect).toHaveBeenCalledWith(
      "https://mychessstour.com/",
    );
  });

  it("redirects to error page when exchange fails", async () => {
    mocks.exchangeCodeForSession.mockResolvedValue({ error: { message: "Invalid code" } });

    await GET(makeRequest("/auth/callback?code=badcode"));

    expect(mocks.redirect).toHaveBeenCalledWith(
      expect.stringContaining("/forgot-password?error=invalid_link"),
    );
  });
});
