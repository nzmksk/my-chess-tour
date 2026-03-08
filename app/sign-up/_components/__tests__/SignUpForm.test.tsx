// @vitest-environment jsdom
import React from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { SignUpProvider } from "../SignUpContext";

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

const { mockPush } = vi.hoisted(() => ({ mockPush: vi.fn() }));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: mockPush }),
}));

vi.mock("next/link", () => ({
  default: ({ children }: { children: React.ReactNode }) => children,
}));

vi.mock("../StepTracker", () => ({ default: () => null }));

import SignUpForm from "../SignUpForm";

afterEach(cleanup);

// ---------------------------------------------------------------------------
// Helper
// ---------------------------------------------------------------------------

function renderForm() {
  return render(
    <SignUpProvider>
      <SignUpForm />
    </SignUpProvider>
  );
}

function getForm() {
  return screen.getByRole("button", { name: /create account/i }).closest("form")!;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("SignUpForm", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  // --- Rendering ------------------------------------------------------------

  it("renders the form inputs", () => {
    renderForm();
    // Use exact label text to avoid matching aria-label on nearby help-icon spans
    expect(screen.getByLabelText("First Name")).toBeDefined();
    expect(screen.getByLabelText("Last Name")).toBeDefined();
    expect(screen.getByLabelText("Email Address")).toBeDefined();
  });

  it("renders the Create Account submit button", () => {
    renderForm();
    expect(screen.getByRole("button", { name: "Create Account" })).toBeDefined();
  });

  it("renders the password strength meter", () => {
    renderForm();
    expect(document.querySelector('[role="meter"]')).not.toBeNull();
  });

  it("shows password requirements list", () => {
    renderForm();
    expect(screen.getByText(/password must contain/i)).toBeDefined();
  });

  // --- Validation on submit -------------------------------------------------

  it("shows error banner when submitted with empty fields", async () => {
    renderForm();
    await act(async () => {
      fireEvent.submit(getForm());
    });
    expect(screen.getByRole("alert")).toBeDefined();
  });

  it("shows field-level validation errors on empty submit", async () => {
    renderForm();
    await act(async () => {
      fireEvent.submit(getForm());
    });
    expect(document.querySelectorAll(".input-hint.error").length).toBeGreaterThan(0);
  });

  it("does not navigate when the form is invalid", async () => {
    renderForm();
    await act(async () => {
      fireEvent.submit(getForm());
    });
    expect(mockPush).not.toHaveBeenCalled();
  });

  // --- Valid submission ------------------------------------------------------

  it("navigates to /sign-up/profile on a valid form submit", async () => {
    renderForm();

    fireEvent.change(screen.getByLabelText("First Name"), { target: { value: "Alice" } });
    fireEvent.change(screen.getByLabelText("Last Name"), { target: { value: "Wong" } });
    fireEvent.change(screen.getByLabelText("Email Address"), {
      target: { value: "alice@example.com" },
    });
    fireEvent.change(screen.getByLabelText("Password"), { target: { value: "Password1!" } });
    fireEvent.change(screen.getByLabelText("Confirm Password"), {
      target: { value: "Password1!" },
    });
    fireEvent.click(screen.getByRole("checkbox"));

    await act(async () => {
      fireEvent.submit(getForm());
    });

    expect(mockPush).toHaveBeenCalledWith("/sign-up/profile");
  });

  // --- Password visibility toggles ------------------------------------------

  it("toggles password field between text and password type", async () => {
    renderForm();
    const input = screen.getByLabelText("Password") as HTMLInputElement;
    expect(input.type).toBe("password");

    await act(async () => {
      fireEvent.click(screen.getByLabelText("Show password"));
    });
    expect(input.type).toBe("text");

    await act(async () => {
      fireEvent.click(screen.getByLabelText("Hide password"));
    });
    expect(input.type).toBe("password");
  });

  it("toggles confirm-password field visibility", async () => {
    renderForm();
    const input = screen.getByLabelText("Confirm Password") as HTMLInputElement;
    expect(input.type).toBe("password");

    await act(async () => {
      fireEvent.click(screen.getByLabelText("Show confirm password"));
    });
    expect(input.type).toBe("text");

    await act(async () => {
      fireEvent.click(screen.getByLabelText("Hide confirm password"));
    });
    expect(input.type).toBe("password");
  });
});
