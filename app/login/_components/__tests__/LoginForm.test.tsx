// @vitest-environment jsdom
import React from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, act } from "@testing-library/react";

// ---------------------------------------------------------------------------
// Mocks — hoisted so they run before imports
// ---------------------------------------------------------------------------

vi.mock("next/link", () => ({
  default: ({ children, href }: { children: React.ReactNode; href: string }) => (
    <a href={href}>{children}</a>
  ),
}));

vi.mock("../actions", () => ({
  login: vi.fn(),
}));

// Control state returned by useActionState
let mockState = {
  error: null as string | null,
  attemptsRemaining: null as number | null,
  locked: false,
  lockedSeconds: null as number | null,
};
const mockFormAction = vi.fn();
let mockPending = false;

vi.mock("react", async () => {
  const actual = await vi.importActual<typeof import("react")>("react");
  return {
    ...actual,
    useActionState: (_action: unknown, _initial: unknown) => [mockState, mockFormAction, mockPending],
  };
});

import LoginForm from "../LoginForm";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const CLEAN_STATE = {
  error: null,
  attemptsRemaining: null,
  locked: false,
  lockedSeconds: null,
};

afterEach(() => {
  cleanup();
  Object.assign(mockState, CLEAN_STATE);
  mockPending = false;
});

beforeEach(() => {
  Object.assign(mockState, CLEAN_STATE);
  mockPending = false;
});

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("LoginForm", () => {
  // --- Rendering (clean state) -----------------------------------------------

  it("renders email input", () => {
    render(<LoginForm />);
    expect(screen.getByLabelText("Email Address")).toBeDefined();
  });

  it("renders password input", () => {
    render(<LoginForm />);
    expect(screen.getByLabelText("Password")).toBeDefined();
  });

  it("renders Sign In submit button", () => {
    render(<LoginForm />);
    expect(screen.getByRole("button", { name: "Sign In" })).toBeDefined();
  });

  it("renders Keep me signed in checkbox checked by default", () => {
    render(<LoginForm />);
    const checkbox = screen.getByLabelText("Keep me signed in") as HTMLInputElement;
    expect(checkbox).toBeDefined();
    expect(checkbox.defaultChecked).toBe(true);
  });

  it("renders Forgot password link pointing to /auth/forgot-password", () => {
    render(<LoginForm />);
    const link = screen.getByText("Forgot password?") as HTMLAnchorElement;
    expect(link.href).toContain("/auth/forgot-password");
  });

  it("renders create account link pointing to /sign-up", () => {
    render(<LoginForm />);
    const link = screen.getByText("Create one") as HTMLAnchorElement;
    expect(link.href).toContain("/sign-up");
  });

  // --- Error state (2B) -------------------------------------------------------

  it("shows error banner when state has error", () => {
    mockState.error = "Incorrect email or password.";
    mockState.attemptsRemaining = 2;
    render(<LoginForm />);
    expect(screen.getByRole("alert")).toBeDefined();
  });

  it("shows error message text in error banner", () => {
    mockState.error = "Incorrect email or password.";
    mockState.attemptsRemaining = 2;
    render(<LoginForm />);
    expect(screen.getByText(/Incorrect email or password/)).toBeDefined();
  });

  it("shows attempts remaining when attemptsRemaining is set", () => {
    mockState.error = "Incorrect email or password.";
    mockState.attemptsRemaining = 2;
    render(<LoginForm />);
    expect(screen.getByText(/2 attempts remaining/)).toBeDefined();
  });

  it("shows singular attempt when attemptsRemaining is 1", () => {
    mockState.error = "Incorrect email or password.";
    mockState.attemptsRemaining = 1;
    render(<LoginForm />);
    expect(screen.getByText(/1 attempt remaining/)).toBeDefined();
  });

  it("does not show error banner in clean state", () => {
    render(<LoginForm />);
    expect(screen.queryByRole("alert")).toBeNull();
  });

  // --- Locked state (2C) -------------------------------------------------------

  it("shows Account Locked heading when locked is true", () => {
    mockState.locked = true;
    mockState.lockedSeconds = 900;
    render(<LoginForm />);
    expect(screen.getByText("Account Locked")).toBeDefined();
  });

  it("shows Reset Password button on locked screen", () => {
    mockState.locked = true;
    mockState.lockedSeconds = 900;
    render(<LoginForm />);
    expect(screen.getByText("Reset Password")).toBeDefined();
  });

  it("does not show the login form when locked", () => {
    mockState.locked = true;
    mockState.lockedSeconds = 900;
    render(<LoginForm />);
    expect(screen.queryByLabelText("Email Address")).toBeNull();
    expect(screen.queryByLabelText("Password")).toBeNull();
  });

  // --- Password toggle -------------------------------------------------------

  it("password input starts as type password", () => {
    render(<LoginForm />);
    const input = screen.getByLabelText("Password") as HTMLInputElement;
    expect(input.type).toBe("password");
  });

  it("toggles password to text type when eye button clicked", async () => {
    render(<LoginForm />);
    const input = screen.getByLabelText("Password") as HTMLInputElement;

    await act(async () => {
      fireEvent.click(screen.getByLabelText("Show password"));
    });
    expect(input.type).toBe("text");
  });

  it("toggles password back to password type on second click", async () => {
    render(<LoginForm />);
    const input = screen.getByLabelText("Password") as HTMLInputElement;

    await act(async () => {
      fireEvent.click(screen.getByLabelText("Show password"));
    });
    await act(async () => {
      fireEvent.click(screen.getByLabelText("Hide password"));
    });
    expect(input.type).toBe("password");
  });

  // --- Locked state with null lockedSeconds (2C fallback) -------------------

  it("shows ~15 minutes when lockedSeconds is null", () => {
    mockState.locked = true;
    mockState.lockedSeconds = null;
    render(<LoginForm />);
    expect(screen.getByText(/~15 minute/)).toBeDefined();
  });

  it("shows Contact Support link on locked screen", () => {
    mockState.locked = true;
    mockState.lockedSeconds = 900;
    render(<LoginForm />);
    expect(screen.getByText("Contact Support")).toBeDefined();
  });

  // --- Pending state ---------------------------------------------------------

  it("shows Signing In text and disables button when pending", () => {
    mockPending = true;
    render(<LoginForm />);
    const button = screen.getByRole("button", { name: /Signing In/i });
    expect(button).toBeDefined();
    expect((button as HTMLButtonElement).disabled).toBe(true);
  });

  // --- Error hint on password input -----------------------------------------

  it("adds input-error class to password input when error is set", () => {
    mockState.error = "Incorrect email or password.";
    mockState.attemptsRemaining = 3;
    render(<LoginForm />);
    const input = screen.getByLabelText("Password") as HTMLInputElement;
    expect(input.className).toContain("input-error");
  });
});
