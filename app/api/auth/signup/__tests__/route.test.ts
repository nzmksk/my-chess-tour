import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { POST } from "../route";

// Mock next/headers (imported transitively by lib/supabase/server)
vi.mock("next/headers", () => ({
  cookies: vi.fn(() => ({ getAll: vi.fn(() => []), set: vi.fn() })),
}));

const mockSignUp = vi.fn();

vi.mock("@/lib/supabase/server", () => ({
  createClient: vi.fn(() =>
    Promise.resolve({ auth: { signUp: mockSignUp } })
  ),
}));

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeRequest(body: unknown): NextRequest {
  return new NextRequest("http://localhost/api/auth/signup", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

function makeInvalidJsonRequest(): NextRequest {
  return new NextRequest("http://localhost/api/auth/signup", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: "{ not valid json",
  });
}

const validBody = {
  email: "player@example.com",
  password: "securepass",
  first_name: "Alice",
  last_name: "Wong",
};

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("POST /api/auth/signup", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  // --- Success cases --------------------------------------------------------

  it("returns 201 with message and user_id on valid signup", async () => {
    mockSignUp.mockResolvedValue({
      data: { user: { id: "abc-123" } },
      error: null,
    });

    const res = await POST(makeRequest(validBody));
    const json = await res.json();

    expect(res.status).toBe(201);
    expect(json.user_id).toBe("abc-123");
    expect(json.message).toMatch(/check your email/i);
  });

  it("passes first_name, last_name, and phone to signUp metadata", async () => {
    mockSignUp.mockResolvedValue({
      data: { user: { id: "abc-123" } },
      error: null,
    });

    await POST(makeRequest({ ...validBody, phone: "+60123456789" }));

    expect(mockSignUp).toHaveBeenCalledWith(
      expect.objectContaining({
        email: validBody.email,
        password: validBody.password,
        options: {
          data: {
            first_name: validBody.first_name,
            last_name: validBody.last_name,
            phone: "+60123456789",
          },
        },
      })
    );
  });

  it("omits phone from metadata when not provided", async () => {
    mockSignUp.mockResolvedValue({
      data: { user: { id: "abc-123" } },
      error: null,
    });

    await POST(makeRequest(validBody));

    expect(mockSignUp).toHaveBeenCalledWith(
      expect.objectContaining({
        options: {
          data: { first_name: validBody.first_name, last_name: validBody.last_name },
        },
      })
    );
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
    expect(json.error).toMatch(/first_name/);
    expect(json.error).toMatch(/last_name/);
  });

  it("returns 400 listing only the missing fields", async () => {
    const res = await POST(
      makeRequest({ email: "x@x.com", password: "12345678", first_name: "A" })
    );
    const json = await res.json();

    expect(res.status).toBe(400);
    expect(json.error).toMatch(/last_name/);
    expect(json.error).not.toMatch(/email/);
    expect(json.error).not.toMatch(/password/);
    expect(json.error).not.toMatch(/first_name/);
  });

  it("returns 400 for an invalid email format", async () => {
    const res = await POST(
      makeRequest({ ...validBody, email: "not-an-email" })
    );
    const json = await res.json();

    expect(res.status).toBe(400);
    expect(json.error).toMatch(/invalid email/i);
  });

  it("returns 400 when password is shorter than 8 characters", async () => {
    const res = await POST(makeRequest({ ...validBody, password: "short" }));
    const json = await res.json();

    expect(res.status).toBe(400);
    expect(json.error).toMatch(/8 characters/i);
  });

  // --- Supabase error handling ----------------------------------------------

  it("returns 409 when Supabase reports user_already_exists code", async () => {
    mockSignUp.mockResolvedValue({
      data: { user: null },
      error: { code: "user_already_exists", message: "User already registered" },
    });

    const res = await POST(makeRequest(validBody));
    const json = await res.json();

    expect(res.status).toBe(409);
    expect(json.error).toMatch(/already exists/i);
  });

  it("returns 409 when Supabase error message contains 'already registered'", async () => {
    mockSignUp.mockResolvedValue({
      data: { user: null },
      error: { code: "unexpected_code", message: "User already registered" },
    });

    const res = await POST(makeRequest(validBody));
    const json = await res.json();

    expect(res.status).toBe(409);
    expect(json.error).toMatch(/already exists/i);
  });

  it("returns 400 for other Supabase errors", async () => {
    mockSignUp.mockResolvedValue({
      data: { user: null },
      error: { code: "unexpected_error", message: "Something went wrong" },
    });

    const res = await POST(makeRequest(validBody));
    const json = await res.json();

    expect(res.status).toBe(400);
    expect(json.error).toBe("Something went wrong");
  });
});
