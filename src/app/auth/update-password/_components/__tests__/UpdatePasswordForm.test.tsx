// @vitest-environment jsdom
import React from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";

// ---------------------------------------------------------------------------
// Mocks — hoisted so they run before imports
// ---------------------------------------------------------------------------

vi.mock("../actions", () => ({
  updatePassword: vi.fn(),
}));

let mockState = {
  error: null as string | null,
  fieldErrors: {} as { password?: string; confirmPassword?: string },
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

import UpdatePasswordForm from "../UpdatePasswordForm";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const CLEAN_STATE = {
  error: null as string | null,
  fieldErrors: {} as { password?: string; confirmPassword?: string },
};

afterEach(() => {
  cleanup();
  Object.assign(mockState, CLEAN_STATE);
  mockState.fieldErrors = {};
  mockPending = false;
});

beforeEach(() => {
  Object.assign(mockState, CLEAN_STATE);
  mockState.fieldErrors = {};
  mockPending = false;
});

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("UpdatePasswordForm", () => {
  // --- Default form rendering ------------------------------------------------

  it("renders New Password heading", () => {
    render(<UpdatePasswordForm />);
    expect(screen.getByRole("heading", { name: "New Password" })).toBeDefined();
  });

  it("renders password input", () => {
    render(<UpdatePasswordForm />);
    expect(screen.getByLabelText("New Password")).toBeDefined();
  });

  it("renders confirm password input", () => {
    render(<UpdatePasswordForm />);
    expect(screen.getByLabelText("Confirm Password")).toBeDefined();
  });

  it("renders Update Password submit button", () => {
    render(<UpdatePasswordForm />);
    expect(screen.getByRole("button", { name: "Update Password" })).toBeDefined();
  });

  // --- Error state ----------------------------------------------------------

  it("shows error banner when state has error", () => {
    mockState.error = "Something went wrong.";
    render(<UpdatePasswordForm />);
    expect(screen.getByRole("alert")).toBeDefined();
  });

  it("shows password field error", () => {
    mockState.fieldErrors = { password: "Password does not meet the requirements" };
    render(<UpdatePasswordForm />);
    expect(screen.getByText("Password does not meet the requirements")).toBeDefined();
  });

  it("shows confirmPassword field error", () => {
    mockState.fieldErrors = { confirmPassword: "Passwords do not match" };
    render(<UpdatePasswordForm />);
    expect(screen.getByText("Passwords do not match")).toBeDefined();
  });

  it("does not show error banner in clean state", () => {
    render(<UpdatePasswordForm />);
    expect(screen.queryByRole("alert")).toBeNull();
  });

  // --- Password toggle -------------------------------------------------------

  it("password input starts as type password", () => {
    render(<UpdatePasswordForm />);
    const input = screen.getByLabelText("New Password") as HTMLInputElement;
    expect(input.type).toBe("password");
  });

  it("confirm password starts as type password", () => {
    render(<UpdatePasswordForm />);
    const input = screen.getByLabelText("Confirm Password") as HTMLInputElement;
    expect(input.type).toBe("password");
  });

  it("toggles password to text when first eye button clicked", async () => {
    render(<UpdatePasswordForm />);
    const input = screen.getByLabelText("New Password") as HTMLInputElement;
    const buttons = screen.getAllByLabelText("Show password");

    await act(async () => {
      fireEvent.click(buttons[0]);
    });

    expect(input.type).toBe("text");
  });

  it("toggles confirmPassword to text when second eye button clicked", async () => {
    render(<UpdatePasswordForm />);
    const input = screen.getByLabelText("Confirm Password") as HTMLInputElement;
    const buttons = screen.getAllByLabelText("Show password");

    await act(async () => {
      fireEvent.click(buttons[1]);
    });

    expect(input.type).toBe("text");
  });

  // --- Pending state --------------------------------------------------------

  it("shows Updating text and disables button when pending", () => {
    mockPending = true;
    render(<UpdatePasswordForm />);
    const button = screen.getByRole("button", { name: /Updating/i });
    expect(button).toBeDefined();
    expect((button as HTMLButtonElement).disabled).toBe(true);
  });

  // --- input-error class ----------------------------------------------------

  it("adds input-error class to password when fieldErrors.password is set", () => {
    mockState.fieldErrors = { password: "Password does not meet the requirements" };
    render(<UpdatePasswordForm />);
    const input = screen.getByLabelText("New Password") as HTMLInputElement;
    expect(input.className).toContain("input-error");
  });

  it("adds input-error class to confirmPassword when fieldErrors.confirmPassword is set", () => {
    mockState.fieldErrors = { confirmPassword: "Passwords do not match" };
    render(<UpdatePasswordForm />);
    const input = screen.getByLabelText("Confirm Password") as HTMLInputElement;
    expect(input.className).toContain("input-error");
  });
});
