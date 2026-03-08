// @vitest-environment jsdom
import React from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

const { mockPush } = vi.hoisted(() => ({ mockPush: vi.fn() }));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: mockPush }),
}));

vi.mock("../StepTracker", () => ({ default: () => null }));

vi.mock("../SignUpContext", () => ({
  useSignUpForm: () => ({
    form: {
      email: "player@example.com",
      password: "Password1!",
      firstName: "Alice",
      lastName: "Wong",
      gender: "Female",
      nationality: "Malaysian",
      dateOfBirth: "1990-01-01",
      state: "Selangor",
      fideId: "",
      mcfId: "",
      isOku: false,
    },
    setForm: vi.fn(),
  }),
}));

import VerifyForm from "../VerifyForm";

afterEach(cleanup);

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const VALID_CODE = "ABC123";

function getCodeInput(): HTMLInputElement {
  return screen.getByLabelText("6-digit verification code") as HTMLInputElement;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("VerifyForm", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.unstubAllGlobals();
  });

  // --- Rendering ------------------------------------------------------------

  it("renders the verification code input", () => {
    render(<VerifyForm />);
    expect(getCodeInput()).toBeDefined();
  });

  it("displays the user's email address", () => {
    render(<VerifyForm />);
    // Use getAllByText to handle potential multiple matches, then assert at least one exists
    const matches = screen.getAllByText("player@example.com");
    expect(matches.length).toBeGreaterThan(0);
  });

  it("shows the initial 10:00 expiry countdown", () => {
    render(<VerifyForm />);
    const matches = screen.getAllByText("10:00");
    expect(matches.length).toBeGreaterThan(0);
  });

  it("shows the 'Resend code' link initially (no cooldown)", () => {
    render(<VerifyForm />);
    const matches = screen.getAllByText(/resend code/i);
    expect(matches.length).toBeGreaterThan(0);
  });

  it("Verify Email button is disabled when input is empty", () => {
    render(<VerifyForm />);
    const btn = screen.getAllByRole("button").find(
      (b) => b.textContent?.includes("Verify Email")
    ) as HTMLButtonElement | undefined;
    expect(btn).toBeDefined();
    expect(btn!.disabled).toBe(true);
  });

  // --- Code input -----------------------------------------------------------

  it("strips non-alphanumeric characters from code input", async () => {
    render(<VerifyForm />);
    const input = getCodeInput();

    await act(async () => {
      fireEvent.change(input, { target: { value: "AB!@#1" } });
    });

    expect(input.value).toBe("AB1");
  });

  it("uppercases the entered code", async () => {
    render(<VerifyForm />);
    const input = getCodeInput();

    await act(async () => {
      fireEvent.change(input, { target: { value: "abc" } });
    });

    expect(input.value).toBe("ABC");
  });

  // --- Auto-submit on 6 chars -----------------------------------------------

  it("calls the verify-code API when 6 chars are entered", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ message: "Account created successfully" }),
      })
    );

    render(<VerifyForm />);
    await act(async () => {
      fireEvent.change(getCodeInput(), { target: { value: VALID_CODE } });
    });

    expect(vi.mocked(fetch)).toHaveBeenCalledWith(
      "/api/v1/auth/signup/verify-code",
      expect.objectContaining({ method: "POST" })
    );
  });

  it("navigates to /sign-up/success after successful verification", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ message: "Account created successfully" }),
      })
    );

    render(<VerifyForm />);
    await act(async () => {
      fireEvent.change(getCodeInput(), { target: { value: VALID_CODE } });
    });

    expect(mockPush).toHaveBeenCalledWith("/sign-up/success");
  });

  it("shows an inline error when verification fails", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: false,
        json: async () => ({ error: "Incorrect code. Please try again." }),
      })
    );

    render(<VerifyForm />);
    await act(async () => {
      fireEvent.change(getCodeInput(), { target: { value: VALID_CODE } });
    });

    expect(screen.getByText(/incorrect code/i)).toBeDefined();
  });

  it("shows 'Network error' when fetch throws", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("Network down")));

    render(<VerifyForm />);
    await act(async () => {
      fireEvent.change(getCodeInput(), { target: { value: VALID_CODE } });
    });

    expect(screen.getByText(/network error/i)).toBeDefined();
  });

  // --- Timer ----------------------------------------------------------------

  it("shows 'Code has expired' after the 10-minute timer elapses", async () => {
    vi.useFakeTimers();
    render(<VerifyForm />);

    await act(async () => {
      vi.advanceTimersByTime(10 * 60 * 1000 + 500);
    });

    expect(screen.getByText(/code has expired/i)).toBeDefined();
    vi.useRealTimers();
  });

  // --- Resend ---------------------------------------------------------------

  it("calls the request-code API when Resend code is clicked", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ message: "Verification code sent" }),
      })
    );

    render(<VerifyForm />);
    const resendLink = screen
      .getAllByText(/resend code/i)
      .find((el) => el.tagName === "A")!;

    await act(async () => {
      fireEvent.click(resendLink);
    });

    expect(vi.mocked(fetch)).toHaveBeenCalledWith(
      "/api/v1/auth/signup/request-code",
      expect.objectContaining({ method: "POST" })
    );
  });
});
