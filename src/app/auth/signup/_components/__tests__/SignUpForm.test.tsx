// @vitest-environment jsdom
import React from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
} from "@testing-library/react";
import { SignUpProvider } from "../SignUpContext";

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

const { mockPush } = vi.hoisted(() => ({ mockPush: vi.fn() }));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: mockPush }),
}));

vi.mock("next/link", () => ({
  default: ({
    children,
    ...props
  }: React.AnchorHTMLAttributes<HTMLAnchorElement>) => <a {...props}>{children}</a>,
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
    </SignUpProvider>,
  );
}

function getForm() {
  return screen
    .getByRole("button", { name: /create account/i })
    .closest("form")!;
}

function fillValidForm({
  dateOfBirth = "1990-05-17",
}: { dateOfBirth?: string } = {}) {
  fireEvent.change(screen.getByLabelText("First Name"), {
    target: { value: "Alice" },
  });
  fireEvent.change(screen.getByLabelText("Last Name"), {
    target: { value: "Wong" },
  });
  fireEvent.change(screen.getByLabelText("Date of Birth"), {
    target: { value: dateOfBirth },
  });
  fireEvent.change(screen.getByLabelText("Email Address"), {
    target: { value: "alice@example.com" },
  });
  fireEvent.change(screen.getByLabelText("Password"), {
    target: { value: "Password1!" },
  });
  fireEvent.change(screen.getByLabelText("Confirm Password"), {
    target: { value: "Password1!" },
  });
  fireEvent.click(
    screen.getByLabelText(
      "I agree to the Terms of Service and Privacy Policy",
    ),
  );
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("SignUpForm", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    window.sessionStorage.clear();
  });

  // --- Rendering ------------------------------------------------------------

  it("renders the form inputs", () => {
    renderForm();
    // Use exact label text to avoid matching aria-label on nearby help-icon spans
    expect(screen.getByLabelText("First Name")).toBeDefined();
    expect(screen.getByLabelText("Last Name")).toBeDefined();
    expect(screen.getByLabelText("Email Address")).toBeDefined();
  });

  it("links to the name examples in a new tab", () => {
    renderForm();
    const link = screen.getByRole("link", { name: /see examples/i });
    expect(link.getAttribute("href")).toBe("/name-guide");
    expect(link.getAttribute("target")).toBe("_blank");
    expect(link.getAttribute("rel")).toBe("noopener noreferrer");
    expect(link.textContent).toContain("opens in a new tab");
  });

  it("doesn't tell bin/binti names to repeat the first name", () => {
    renderForm();
    expect(screen.queryByText(/repeat your first name/i)).toBeNull();
    expect(
      screen.getByText(/father's name without bin, binti, a\/l, a\/p or anak/),
    ).toBeDefined();
  });

  it("renders the Create Account submit button", () => {
    renderForm();
    expect(
      screen.getByRole("button", { name: "Create Account" }),
    ).toBeDefined();
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
    expect(
      document.querySelectorAll(".input-hint.error").length,
    ).toBeGreaterThan(0);
  });

  it("does not navigate when the form is invalid", async () => {
    renderForm();
    await act(async () => {
      fireEvent.submit(getForm());
    });
    expect(mockPush).not.toHaveBeenCalled();
  });

  // --- Valid submission ------------------------------------------------------

  it("navigates to /auth/signup/verify on a valid form submit", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ message: "Account created. Verification code sent." }),
      }),
    );

    renderForm();

    fillValidForm();

    await act(async () => {
      fireEvent.submit(getForm());
    });

    expect(mockPush).toHaveBeenCalledWith("/auth/signup/verify");
    vi.unstubAllGlobals();
  });

  it("shows error banner when account creation API fails", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: false,
        json: async () => ({
          error: { code: "EMAIL_EXISTS", message: "An account with this email already exists" },
        }),
      }),
    );

    renderForm();

    fillValidForm();

    await act(async () => {
      fireEvent.submit(getForm());
    });

    expect(screen.getByRole("alert")).toBeDefined();
    expect(mockPush).not.toHaveBeenCalled();
    vi.unstubAllGlobals();
  });

  it("asks for a date of birth and points under-18s to a guardian", () => {
    renderForm();
    const input = screen.getByLabelText("Date of Birth") as HTMLInputElement;
    expect(input.type).toBe("date");
    expect(input.value).toBe("");
    expect(input.getAttribute("aria-describedby")).toBe("dateOfBirth-hint");
    expect(
      screen.getByText(/Under 18\? You\s+take part through a parent or guardian/),
    ).toBeDefined();
    expect(screen.queryByLabelText("I am 18 or over")).toBeNull();
  });

  it("doesn't submit an under-18 date of birth", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    renderForm();
    const tenYearsAgo = new Date().getUTCFullYear() - 10;
    fillValidForm({ dateOfBirth: `${tenYearsAgo}-01-01` });

    await act(async () => {
      fireEvent.submit(getForm());
    });

    expect(fetchMock).not.toHaveBeenCalled();
    expect(document.getElementById("dateOfBirth-error")?.textContent).toMatch(
      /18 or over/,
    );
    const input = screen.getByLabelText("Date of Birth");
    expect(input.getAttribute("aria-invalid")).toBe("true");
    expect(input.getAttribute("aria-describedby")).toBe(
      "dateOfBirth-hint dateOfBirth-error",
    );
    vi.unstubAllGlobals();
  });

  it("sends the date of birth with the signup", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ message: "Account created. Verification code sent." }),
    });
    vi.stubGlobal("fetch", fetchMock);
    renderForm();
    fillValidForm();

    await act(async () => {
      fireEvent.submit(getForm());
    });

    const body = JSON.parse(fetchMock.mock.calls[0][1].body);
    expect(body).toMatchObject({
      termsAccepted: true,
      dateOfBirth: "1990-05-17",
    });
    expect(body).not.toHaveProperty("adultConfirmed");
    vi.unstubAllGlobals();
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
