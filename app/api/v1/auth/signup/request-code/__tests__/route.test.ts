import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

// ---------------------------------------------------------------------------
// Mocks — must be hoisted so vi.mock factories can reference them
// ---------------------------------------------------------------------------

const { mockMaybeSingle, mockEq, mockSelect, mockFrom, mockStoreVerificationCode, mockSendVerificationEmail } =
  vi.hoisted(() => {
    const mockMaybeSingle = vi.fn();
    const mockEq = vi.fn(() => ({ maybeSingle: mockMaybeSingle }));
    const mockSelect = vi.fn(() => ({ eq: mockEq }));
    const mockFrom = vi.fn(() => ({ select: mockSelect }));
    const mockStoreVerificationCode = vi.fn();
    const mockSendVerificationEmail = vi.fn();
    return { mockMaybeSingle, mockEq, mockSelect, mockFrom, mockStoreVerificationCode, mockSendVerificationEmail };
  });

vi.mock("@/lib/supabase/admin", () => ({
  supabaseAdmin: { from: mockFrom },
}));

vi.mock("@/lib/redis", () => ({
  storeVerificationCode: mockStoreVerificationCode,
}));

vi.mock("@/lib/email", () => ({
  sendVerificationEmail: mockSendVerificationEmail,
}));

import { POST } from "../route";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeRequest(body: unknown): NextRequest {
  return new NextRequest("http://localhost/api/v1/auth/signup/request-code", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

function makeInvalidJsonRequest(): NextRequest {
  return new NextRequest("http://localhost/api/v1/auth/signup/request-code", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: "{ not valid json",
  });
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("POST /api/v1/auth/signup/request-code", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockMaybeSingle.mockResolvedValue({ data: null, error: null });
    mockEq.mockReturnValue({ maybeSingle: mockMaybeSingle });
    mockSelect.mockReturnValue({ eq: mockEq });
    mockFrom.mockReturnValue({ select: mockSelect });
    mockStoreVerificationCode.mockResolvedValue(undefined);
    mockSendVerificationEmail.mockResolvedValue(undefined);
  });

  // --- Success --------------------------------------------------------------

  it("returns 200 when email is new", async () => {
    const res = await POST(makeRequest({ email: "player@example.com" }));
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json.message).toMatch(/verification code sent/i);
  });

  it("stores and emails a 6-char alphanumeric code", async () => {
    await POST(makeRequest({ email: "player@example.com" }));

    expect(mockStoreVerificationCode).toHaveBeenCalledOnce();
    expect(mockSendVerificationEmail).toHaveBeenCalledOnce();

    const [emailArg, codeArg] = mockSendVerificationEmail.mock.calls[0];
    expect(emailArg).toBe("player@example.com");
    expect(typeof codeArg).toBe("string");
    expect(codeArg).toHaveLength(6);
    expect(/^[A-Z0-9]{6}$/.test(codeArg)).toBe(true);
  });

  it("passes the same code to both store and send", async () => {
    await POST(makeRequest({ email: "player@example.com" }));

    const storedCode = mockStoreVerificationCode.mock.calls[0][1];
    const emailedCode = mockSendVerificationEmail.mock.calls[0][1];
    expect(storedCode).toBe(emailedCode);
  });

  // --- Validation errors ----------------------------------------------------

  it("returns 400 for malformed JSON", async () => {
    const res = await POST(makeInvalidJsonRequest());
    const json = await res.json();

    expect(res.status).toBe(400);
    expect(json.error).toMatch(/invalid json/i);
  });

  it("returns 400 when email is missing", async () => {
    const res = await POST(makeRequest({}));
    const json = await res.json();

    expect(res.status).toBe(400);
    expect(json.error).toMatch(/email is required/i);
  });

  it("returns 400 when email is not a string", async () => {
    const res = await POST(makeRequest({ email: 42 }));
    const json = await res.json();

    expect(res.status).toBe(400);
    expect(json.error).toMatch(/email is required/i);
  });

  // --- Email-exists check ---------------------------------------------------

  it("returns 409 EMAIL_EXISTS when email is already taken", async () => {
    mockMaybeSingle.mockResolvedValue({ data: { id: "existing-user" }, error: null });

    const res = await POST(makeRequest({ email: "existing@example.com" }));
    const json = await res.json();

    expect(res.status).toBe(409);
    expect(json.code).toBe("EMAIL_EXISTS");
    expect(json.error).toMatch(/already exists/i);
  });

  it("does not store or send code when email already exists", async () => {
    mockMaybeSingle.mockResolvedValue({ data: { id: "existing-user" }, error: null });

    await POST(makeRequest({ email: "existing@example.com" }));

    expect(mockStoreVerificationCode).not.toHaveBeenCalled();
    expect(mockSendVerificationEmail).not.toHaveBeenCalled();
  });

  it("queries users table with lowercased trimmed email", async () => {
    await POST(makeRequest({ email: "  Player@Example.COM  " }));

    expect(mockEq).toHaveBeenCalledWith("email", "player@example.com");
  });

  // --- External service errors ----------------------------------------------

  it("returns 500 when Supabase db check fails", async () => {
    mockMaybeSingle.mockResolvedValue({ data: null, error: { message: "DB error" } });

    const res = await POST(makeRequest({ email: "player@example.com" }));
    const json = await res.json();

    expect(res.status).toBe(500);
    expect(json.error).toMatch(/failed to validate email/i);
  });

  it("returns 500 when Redis store fails", async () => {
    mockStoreVerificationCode.mockRejectedValue(new Error("Redis down"));

    const res = await POST(makeRequest({ email: "player@example.com" }));
    const json = await res.json();

    expect(res.status).toBe(500);
    expect(json.error).toMatch(/failed to store verification code/i);
  });

  it("returns 500 when sending email fails", async () => {
    mockSendVerificationEmail.mockRejectedValue(new Error("SMTP error"));

    const res = await POST(makeRequest({ email: "player@example.com" }));
    const json = await res.json();

    expect(res.status).toBe(500);
    expect(json.error).toMatch(/failed to send verification email/i);
  });

  it("does not send email when Redis store fails", async () => {
    mockStoreVerificationCode.mockRejectedValue(new Error("Redis down"));

    await POST(makeRequest({ email: "player@example.com" }));

    expect(mockSendVerificationEmail).not.toHaveBeenCalled();
  });
});
