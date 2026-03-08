// @vitest-environment jsdom
import React from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

vi.mock("next/link", () => ({
  default: ({ children, href }: { children: React.ReactNode; href: string }) => (
    <a href={href}>{children}</a>
  ),
}));

vi.mock("../actions", () => ({
  forgotPassword: vi.fn(),
}));

let mockState = {
  error: null as string | null,
  submitted: false,
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

import ForgotPasswordForm from "../ForgotPasswordForm";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const CLEAN_STATE = { error: null, submitted: false };

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

describe("ForgotPasswordForm", () => {
  // --- Default form rendering ------------------------------------------------

  it("renders the Reset Password heading", () => {
    render(<ForgotPasswordForm />);
    expect(screen.getByText("Reset Password")).toBeDefined();
  });

  it("renders email input", () => {
    render(<ForgotPasswordForm />);
    expect(screen.getByLabelText("Email Address")).toBeDefined();
  });

  it("renders Send Reset Link button", () => {
    render(<ForgotPasswordForm />);
    expect(screen.getByRole("button", { name: "Send Reset Link" })).toBeDefined();
  });

  it("renders Back to sign in link pointing to /login", () => {
    render(<ForgotPasswordForm />);
    const link = screen.getByText("Back to sign in") as HTMLAnchorElement;
    expect(link.href).toContain("/login");
  });

  it("shows reset link validity hint", () => {
    render(<ForgotPasswordForm />);
    expect(screen.getByText(/valid for 1 hour/i)).toBeDefined();
  });

  // --- Error state ----------------------------------------------------------

  it("shows error banner when state has an error", () => {
    mockState.error = "Please enter a valid email address.";
    render(<ForgotPasswordForm />);
    expect(screen.getByRole("alert")).toBeDefined();
  });

  it("shows error message text in banner", () => {
    mockState.error = "Please enter a valid email address.";
    render(<ForgotPasswordForm />);
    expect(screen.getByText(/Please enter a valid email address/)).toBeDefined();
  });

  it("does not show error banner in clean state", () => {
    render(<ForgotPasswordForm />);
    expect(screen.queryByRole("alert")).toBeNull();
  });

  // --- Success state --------------------------------------------------------

  it("shows Check Your Email heading after submission", () => {
    mockState.submitted = true;
    render(<ForgotPasswordForm />);
    expect(screen.getByText("Check Your Email")).toBeDefined();
  });

  it("shows Back to Sign In link on success screen", () => {
    mockState.submitted = true;
    render(<ForgotPasswordForm />);
    expect(screen.getByText("Back to Sign In")).toBeDefined();
  });

  it("does not show the form after submission", () => {
    mockState.submitted = true;
    render(<ForgotPasswordForm />);
    expect(screen.queryByRole("button", { name: "Send Reset Link" })).toBeNull();
    expect(screen.queryByLabelText("Email Address")).toBeNull();
  });

  // --- Pending state --------------------------------------------------------

  it("shows Sending text and disables button when pending", () => {
    mockPending = true;
    render(<ForgotPasswordForm />);
    const button = screen.getByRole("button", { name: /Sending/i });
    expect(button).toBeDefined();
    expect((button as HTMLButtonElement).disabled).toBe(true);
  });
});
