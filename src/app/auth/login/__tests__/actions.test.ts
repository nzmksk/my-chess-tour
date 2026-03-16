import { beforeEach, describe, expect, it, vi } from "vitest";

// ---------------------------------------------------------------------------
// Mocks — use vi.hoisted so variables are available when factories run
// ---------------------------------------------------------------------------

const mocks = vi.hoisted(() => ({
  exists: vi.fn(),
  ttl: vi.fn(),
  incr: vi.fn(),
  expire: vi.fn(),
  set: vi.fn(),
  del: vi.fn(),
  signInWithPassword: vi.fn(),
  redirect: vi.fn(),
}));

vi.mock("@/lib/redis", () => ({
  redis: {
    exists: mocks.exists,
    ttl: mocks.ttl,
    incr: mocks.incr,
    expire: mocks.expire,
    set: mocks.set,
    del: mocks.del,
  },
}));

vi.mock("@/lib/supabase/server", () => ({
  createClient: vi.fn(() =>
    Promise.resolve({ auth: { signInWithPassword: mocks.signInWithPassword } }),
  ),
}));

vi.mock("next/navigation", () => ({
  redirect: mocks.redirect,
}));

import { login } from "../_actions/login";
import { INITIAL_LOGIN_STATE } from "../types";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeFormData(data: Record<string, string>): FormData {
  const fd = new FormData();
  for (const [k, v] of Object.entries(data)) fd.append(k, v);
  return fd;
}

const VALID = {
  email: "user@example.com",
  password: "anypassword",
  keepSignedIn: "on",
};

beforeEach(() => {
  vi.clearAllMocks();
  // Default: account not locked
  mocks.exists.mockResolvedValue(0);
});

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("login action", () => {
  // --- INITIAL_LOGIN_STATE export -------------------------------------------

  it("exports INITIAL_LOGIN_STATE with correct shape", () => {
    expect(INITIAL_LOGIN_STATE).toEqual({
      error: null,
      attemptsRemaining: null,
      locked: false,
      lockedSeconds: null,
    });
  });

  // --- Validation errors (no Redis / Supabase calls) -----------------------

  it("returns error when email is empty", async () => {
    const fd = makeFormData({ email: "", password: "pw", keepSignedIn: "on" });
    const result = await login(INITIAL_LOGIN_STATE, fd);
    expect(result.error).toMatch(/email/i);
    expect(mocks.exists).not.toHaveBeenCalled();
  });

  it("returns error when password is empty", async () => {
    const fd = makeFormData({ email: "user@example.com", password: "" });
    const result = await login(INITIAL_LOGIN_STATE, fd);
    expect(result.error).toMatch(/password/i);
    expect(mocks.exists).not.toHaveBeenCalled();
  });

  it("returns error when email is invalid", async () => {
    const fd = makeFormData({ email: "not-an-email", password: "pw" });
    const result = await login(INITIAL_LOGIN_STATE, fd);
    expect(result.error).toBeDefined();
    expect(result.locked).toBe(false);
  });

  // --- Account already locked -----------------------------------------------

  it("returns locked state when account is already locked", async () => {
    mocks.exists.mockResolvedValue(1);
    mocks.ttl.mockResolvedValue(840);

    const fd = makeFormData(VALID);
    const result = await login(INITIAL_LOGIN_STATE, fd);

    expect(result.locked).toBe(true);
    expect(result.lockedSeconds).toBe(840);
    expect(result.attemptsRemaining).toBe(0);
    expect(mocks.signInWithPassword).not.toHaveBeenCalled();
  });

  // --- Auth failures (rate limiting) ----------------------------------------

  it("returns remaining attempts after first failed attempt", async () => {
    mocks.signInWithPassword.mockResolvedValue({
      data: { user: null, session: null },
      error: { message: "Invalid login credentials" },
    });
    mocks.incr.mockResolvedValue(1);

    const fd = makeFormData(VALID);
    const result = await login(INITIAL_LOGIN_STATE, fd);

    expect(result.error).toMatch(/incorrect email or password/i);
    expect(result.attemptsRemaining).toBe(4);
    expect(result.locked).toBe(false);
  });

  it("returns correct remaining attempts after multiple failures", async () => {
    mocks.signInWithPassword.mockResolvedValue({
      data: { user: null, session: null },
      error: { message: "Invalid login credentials" },
    });
    mocks.incr.mockResolvedValue(3);

    const fd = makeFormData(VALID);
    const result = await login(INITIAL_LOGIN_STATE, fd);

    expect(result.attemptsRemaining).toBe(2);
    expect(result.locked).toBe(false);
  });

  it("locks account after max attempts (5th failure)", async () => {
    mocks.signInWithPassword.mockResolvedValue({
      data: { user: null, session: null },
      error: { message: "Invalid login credentials" },
    });
    mocks.incr.mockResolvedValue(5);

    const fd = makeFormData(VALID);
    const result = await login(INITIAL_LOGIN_STATE, fd);

    expect(result.locked).toBe(true);
    expect(result.lockedSeconds).toBe(900);
    expect(result.attemptsRemaining).toBe(0);
    expect(mocks.set).toHaveBeenCalled();
    expect(mocks.del).toHaveBeenCalled();
  });

  it("sets expire on attempts key after a failed attempt", async () => {
    mocks.signInWithPassword.mockResolvedValue({
      data: { user: null, session: null },
      error: { message: "Invalid login credentials" },
    });
    mocks.incr.mockResolvedValue(1);

    const fd = makeFormData(VALID);
    await login(INITIAL_LOGIN_STATE, fd);

    expect(mocks.expire).toHaveBeenCalled();
  });

  // --- Successful login ------------------------------------------------------

  it("clears attempt keys and redirects on successful login", async () => {
    mocks.signInWithPassword.mockResolvedValue({
      data: { user: { id: "abc-123" }, session: {} },
      error: null,
    });

    const fd = makeFormData(VALID);
    await login(INITIAL_LOGIN_STATE, fd);

    expect(mocks.del).toHaveBeenCalledTimes(2);
    expect(mocks.redirect).toHaveBeenCalledWith("/tournaments");
  });

  it("calls supabase signInWithPassword with correct credentials", async () => {
    mocks.signInWithPassword.mockResolvedValue({
      data: { user: { id: "abc-123" }, session: {} },
      error: null,
    });

    const fd = makeFormData(VALID);
    await login(INITIAL_LOGIN_STATE, fd);

    expect(mocks.signInWithPassword).toHaveBeenCalledWith({
      email: VALID.email,
      password: VALID.password,
    });
  });

  it("trims whitespace from email before using it", async () => {
    mocks.signInWithPassword.mockResolvedValue({
      data: { user: { id: "abc-123" }, session: {} },
      error: null,
    });

    const fd = makeFormData({ email: "  user@example.com  ", password: "anypassword" });
    await login(INITIAL_LOGIN_STATE, fd);

    expect(mocks.signInWithPassword).toHaveBeenCalledWith(
      expect.objectContaining({ email: "user@example.com" }),
    );
  });
});
