// @vitest-environment jsdom
import React from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { act } from "@testing-library/react";
import { SignUpProvider, useSignUpForm } from "../SignUpContext";

afterEach(cleanup);

// ---------------------------------------------------------------------------
// Helper consumer components
// ---------------------------------------------------------------------------

function EmailDisplay() {
  const { form } = useSignUpForm();
  return <span data-testid="email">{form.email}</span>;
}

function FormUpdater() {
  const { form, setForm } = useSignUpForm();
  return (
    <div>
      <span data-testid="email">{form.email}</span>
      <button onClick={() => setForm((f) => ({ ...f, email: "updated@test.com" }))}>
        Update
      </button>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("SignUpProvider", () => {
  it("renders children inside the provider", () => {
    render(
      <SignUpProvider>
        <div data-testid="child">content</div>
      </SignUpProvider>
    );
    expect(screen.getByTestId("child").textContent).toBe("content");
  });

  it("initialises form with empty string values", () => {
    render(
      <SignUpProvider>
        <EmailDisplay />
      </SignUpProvider>
    );
    expect(screen.getByTestId("email").textContent).toBe("");
  });

  it("allows consumers to update form state via setForm", async () => {
    render(
      <SignUpProvider>
        <FormUpdater />
      </SignUpProvider>
    );

    await act(async () => {
      fireEvent.click(screen.getByRole("button"));
    });

    expect(screen.getByTestId("email").textContent).toBe("updated@test.com");
  });
});

describe("useSignUpForm", () => {
  it("throws when called outside a SignUpProvider", () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});

    expect(() => render(<EmailDisplay />)).toThrow(
      "useSignUpForm must be used within SignUpProvider"
    );

    spy.mockRestore();
  });
});
