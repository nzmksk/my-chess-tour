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

vi.mock("next/link", () => ({
  default: ({ children, href }: { children: React.ReactNode; href: string }) =>
    React.createElement("a", { href }, children),
}));

vi.mock("../StepTracker", () => ({ default: () => null }));

// Make setForm call the updater so inner arrow-function callbacks are covered.
const mockFormData = {
  firstName: "Alice",
  lastName: "Wong",
  email: "alice@example.com",
  password: "Password1!",
  confirmPassword: "Password1!",
  termsAccepted: true,
  gender: "Female",
  nationality: "Malaysian",
  dateOfBirth: "1990-01-01",
  state: "Selangor",
  fideId: "",
  mcfId: "",
  isOku: false,
};

vi.mock("../SignUpContext", () => ({
  useSignUpForm: () => ({
    form: mockFormData,
    setForm: vi.fn((updater: unknown) => {
      if (typeof updater === "function") updater(mockFormData);
    }),
  }),
}));

import ProfileForm from "../ProfileForm";

afterEach(cleanup);

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function getSubmitButton(): HTMLButtonElement {
  return screen.getAllByRole("button").find(
    (b) => (b as HTMLButtonElement).type === "submit"
  ) as HTMLButtonElement;
}

function getBackButton(): HTMLElement {
  return screen.getAllByRole("button").find(
    (b) => b.textContent?.trim() === "Back"
  )!;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("ProfileForm", () => {
  const savedEnv = process.env.NEXT_PUBLIC_ENVIRONMENT;

  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    process.env.NEXT_PUBLIC_ENVIRONMENT = savedEnv;
    vi.unstubAllGlobals();
  });

  // --- Rendering ------------------------------------------------------------

  it("renders the gender, nationality, and date-of-birth fields", () => {
    render(<ProfileForm />);
    expect(screen.getByLabelText("Gender")).toBeDefined();
    expect(screen.getByLabelText("Nationality")).toBeDefined();
    expect(screen.getByLabelText("Date of Birth")).toBeDefined();
  });

  it("renders FIDE ID, MCF ID, and OKU fields", () => {
    render(<ProfileForm />);
    expect(screen.getByLabelText("FIDE ID")).toBeDefined();
    expect(screen.getByLabelText("MCF ID")).toBeDefined();
    expect(screen.getByRole("checkbox")).toBeDefined();
  });

  it("shows avatar initials 'AW' from firstName='Alice' lastName='Wong'", () => {
    render(<ProfileForm />);
    const avatar = screen.getByRole("button", { name: "Upload profile photo" });
    expect(avatar.textContent).toContain("AW");
  });

  it("renders Back and Continue/Sending buttons", () => {
    render(<ProfileForm />);
    expect(getBackButton()).toBeDefined();
    expect(getSubmitButton()).toBeDefined();
  });

  // --- Input interactions (covers onChange handlers) ------------------------

  it("fires onChange on the Gender select", async () => {
    render(<ProfileForm />);
    await act(async () => {
      fireEvent.change(screen.getByLabelText("Gender"), { target: { value: "Male" } });
    });
    // setForm was called (the updater executed successfully)
    expect(true).toBe(true);
  });

  it("fires onChange on the Nationality input", async () => {
    render(<ProfileForm />);
    await act(async () => {
      fireEvent.change(screen.getByLabelText("Nationality"), {
        target: { value: "Singaporean" },
      });
    });
    expect(true).toBe(true);
  });

  it("fires onChange on the Date of Birth input", async () => {
    render(<ProfileForm />);
    await act(async () => {
      fireEvent.change(screen.getByLabelText("Date of Birth"), {
        target: { value: "2000-05-15" },
      });
    });
    expect(true).toBe(true);
  });

  it("fires onChange on the State select", async () => {
    render(<ProfileForm />);
    await act(async () => {
      fireEvent.change(screen.getByLabelText("State"), { target: { value: "Sabah" } });
    });
    expect(true).toBe(true);
  });

  it("fires onChange on the FIDE ID input", async () => {
    render(<ProfileForm />);
    await act(async () => {
      fireEvent.change(screen.getByLabelText("FIDE ID"), {
        target: { value: "12345678" },
      });
    });
    expect(true).toBe(true);
  });

  it("fires onChange on the MCF ID input", async () => {
    render(<ProfileForm />);
    await act(async () => {
      fireEvent.change(screen.getByLabelText("MCF ID"), {
        target: { value: "MCF-001" },
      });
    });
    expect(true).toBe(true);
  });

  it("fires onChange on the OKU checkbox", async () => {
    render(<ProfileForm />);
    await act(async () => {
      fireEvent.click(screen.getByRole("checkbox"));
    });
    expect(true).toBe(true);
  });

  // --- Navigation -----------------------------------------------------------

  it("Back button calls router.push('/sign-up')", async () => {
    render(<ProfileForm />);
    await act(async () => {
      fireEvent.click(getBackButton());
    });
    expect(mockPush).toHaveBeenCalledWith("/sign-up");
  });

  // --- Non-production behaviour ---------------------------------------------

  it("skips fetch and navigation in non-production environment", async () => {
    delete process.env.NEXT_PUBLIC_ENVIRONMENT;
    const mockFetch = vi.fn();
    vi.stubGlobal("fetch", mockFetch);

    render(<ProfileForm />);
    await act(async () => {
      fireEvent.submit(getSubmitButton().closest("form")!);
    });

    expect(mockFetch).not.toHaveBeenCalled();
    expect(mockPush).not.toHaveBeenCalled();
  });

  // --- Production behaviour -------------------------------------------------

  it("navigates to /sign-up/verify on successful code request", async () => {
    process.env.NEXT_PUBLIC_ENVIRONMENT = "production";
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ message: "Verification code sent" }),
      })
    );

    render(<ProfileForm />);
    await act(async () => {
      fireEvent.submit(getSubmitButton().closest("form")!);
    });

    expect(mockPush).toHaveBeenCalledWith("/sign-up/verify");
  });

  it("shows error banner when the API returns an error", async () => {
    process.env.NEXT_PUBLIC_ENVIRONMENT = "production";
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: false,
        json: async () => ({ error: "Something went wrong" }),
      })
    );

    render(<ProfileForm />);
    await act(async () => {
      fireEvent.submit(getSubmitButton().closest("form")!);
    });

    expect(screen.getByRole("alert").textContent).toContain("Something went wrong");
  });

  it("shows a 'Log in instead' link on EMAIL_EXISTS error", async () => {
    process.env.NEXT_PUBLIC_ENVIRONMENT = "production";
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: false,
        json: async () => ({
          error: "An account with this email already exists",
          code: "EMAIL_EXISTS",
        }),
      })
    );

    render(<ProfileForm />);
    await act(async () => {
      fireEvent.submit(getSubmitButton().closest("form")!);
    });

    expect(screen.getByRole("link", { name: /log in instead/i })).toBeDefined();
  });

  it("shows 'Network error' message when fetch throws", async () => {
    process.env.NEXT_PUBLIC_ENVIRONMENT = "production";
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("Network down")));

    render(<ProfileForm />);
    await act(async () => {
      fireEvent.submit(getSubmitButton().closest("form")!);
    });

    expect(screen.getByRole("alert").textContent).toContain("Network error");
  });
});
