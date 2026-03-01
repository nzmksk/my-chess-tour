import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { POST } from "../route";

// Mock next/headers (imported transitively by lib/supabase/server)
vi.mock("next/headers", () => ({
  cookies: vi.fn(() => ({ getAll: vi.fn(() => []), set: vi.fn() })),
}));

const mockSignInWithPassword = vi.fn();

vi.mock("@/lib/supabase/server", () => ({
  createClient: vi.fn(() =>
    Promise.resolve({ auth: { signInWithPassword: mockSignInWithPassword } })
  ),
}));

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeRequest(body: unknown): NextRequest {
  return new NextRequest("http://localhost/api/auth/login", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

function makeInvalidJsonRequest(): NextRequest {
  return new NextRequest("http://localhost/api/auth/login", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: "{ not valid json",
  });
}

const validBody = {
  email: "player@example.com",
  password: "securepass",
};

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("POST /api/auth/login", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  // --- Success cases --------------------------------------------------------

  it("returns 200 with message and user_id on valid login", async () => {
    mockSignInWithPassword.mockResolvedValue({
      data: { user: { id: "abc-123" }, session: {} },
      error: null,
    });

    const res = await POST(makeRequest(validBody));
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json.user_id).toBe("abc-123");
    expect(json.message).toMatch(/login successful/i);
  });

  it("calls signInWithPassword with correct credentials", async () => {
    mockSignInWithPassword.mockResolvedValue({
      data: { user: { id: "abc-123" }, session: {} },
      error: null,
    });

    await POST(makeRequest(validBody));

    expect(mockSignInWithPassword).toHaveBeenCalledWith({
      email: validBody.email,
      password: validBody.password,
    });
  });

  // --- Validation errors ----------------------------------------------------

  it("returns 400 for malformed JSON body", async () => {
    const res = await POST(makeInvalidJsonRequest());
    const json = await res.json();

    expect(res.status).toBe(400);
    expect(json.error).toMatch(/invalid json/i);
  });

  it("returns 400 listing all missing required fields", async () => {
    const res = await POST(makeRequest({}));
    const json = await res.json();

    expect(res.status).toBe(400);
    expect(json.error).toMatch(/email/);
    expect(json.error).toMatch(/password/);
  });

  it("returns 400 listing only the missing fields", async () => {
    const res = await POST(makeRequest({ email: "x@x.com" }));
    const json = await res.json();

    expect(res.status).toBe(400);
    expect(json.error).toMatch(/password/);
    expect(json.error).not.toMatch(/email/);
  });

  it("returns 400 for an invalid email format", async () => {
    const res = await POST(makeRequest({ ...validBody, email: "not-an-email" }));
    const json = await res.json();

    expect(res.status).toBe(400);
    expect(json.error).toMatch(/invalid email/i);
  });

  // --- Supabase error handling ----------------------------------------------

  it("returns 401 for invalid credentials", async () => {
    mockSignInWithPassword.mockResolvedValue({
      data: { user: null, session: null },
      error: { message: "Invalid login credentials" },
    });

    const res = await POST(makeRequest(validBody));
    const json = await res.json();

    expect(res.status).toBe(401);
    expect(json.error).toMatch(/invalid email or password/i);
  });

  it("returns 403 when email is not confirmed", async () => {
    mockSignInWithPassword.mockResolvedValue({
      data: { user: null, session: null },
      error: { message: "Email not confirmed" },
    });

    const res = await POST(makeRequest(validBody));
    const json = await res.json();

    expect(res.status).toBe(403);
    expect(json.error).toMatch(/email not confirmed/i);
  });

  it("returns 400 for other Supabase errors", async () => {
    mockSignInWithPassword.mockResolvedValue({
      data: { user: null, session: null },
      error: { message: "Something went wrong" },
    });

    const res = await POST(makeRequest(validBody));
    const json = await res.json();

    expect(res.status).toBe(400);
    expect(json.error).toBe("Something went wrong");
  });
});
