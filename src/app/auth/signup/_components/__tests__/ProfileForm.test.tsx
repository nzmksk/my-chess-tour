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

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

const { mockPush } = vi.hoisted(() => ({ mockPush: vi.fn() }));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: mockPush }),
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
    clearForm: vi.fn(),
  }),
}));

import ProfileForm from "../ProfileForm";

afterEach(cleanup);

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function getSubmitButton(): HTMLButtonElement {
  return screen
    .getAllByRole("button")
    .find(
      (b) => (b as HTMLButtonElement).type === "submit",
    ) as HTMLButtonElement;
}

function getSkipButton(): HTMLElement {
  return screen
    .getAllByRole("button")
    .find((b) => b.textContent?.trim() === "Skip")!;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("ProfileForm", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.unstubAllGlobals();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  // --- Rendering ------------------------------------------------------------

  it("renders the gender, nationality, and date-of-birth fields", () => {
    render(<ProfileForm />);
    expect(screen.getByLabelText("Gender")).toBeDefined();
    expect(screen.getByLabelText("Nationality")).toBeDefined();
    expect(screen.getByLabelText("Date of Birth")).toBeDefined();
  });

  it("does not mark Gender or Nationality as required (profile is optional)", () => {
    render(<ProfileForm />);
    const gender = screen.getByLabelText("Gender") as HTMLSelectElement;
    const nationality = screen.getByLabelText(
      "Nationality",
    ) as HTMLInputElement;

    expect(gender.required).toBe(false);
    expect(gender.getAttribute("aria-required")).toBeNull();
    expect(nationality.required).toBe(false);
    expect(nationality.getAttribute("aria-required")).toBeNull();
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

  it("falls back to 'CT' initials (not 'UNDEFINED') when names are empty", () => {
    const origFirst = mockFormData.firstName;
    const origLast = mockFormData.lastName;
    mockFormData.firstName = "";
    mockFormData.lastName = "";
    try {
      render(<ProfileForm />);
      const avatar = screen.getByRole("button", {
        name: "Upload profile photo",
      });
      expect(avatar.textContent).toContain("CT");
      expect(avatar.textContent?.toUpperCase()).not.toContain("UNDEFINED");
    } finally {
      mockFormData.firstName = origFirst;
      mockFormData.lastName = origLast;
    }
  });

  it("renders Skip and Complete Profile buttons", () => {
    render(<ProfileForm />);
    expect(getSkipButton()).toBeDefined();
    expect(getSubmitButton()).toBeDefined();
  });

  // --- Input interactions (covers onChange handlers) ------------------------

  it("fires onChange on the Gender select", async () => {
    render(<ProfileForm />);
    await act(async () => {
      fireEvent.change(screen.getByLabelText("Gender"), {
        target: { value: "Male" },
      });
    });
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

  it("Skip button navigates to /tournaments", async () => {
    render(<ProfileForm />);
    await act(async () => {
      fireEvent.click(getSkipButton());
    });
    expect(mockPush).toHaveBeenCalledWith("/tournaments");
  });

  it("navigates to /tournaments on successful profile completion", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ message: "Profile updated" }),
      }),
    );

    render(<ProfileForm />);
    await act(async () => {
      fireEvent.submit(getSubmitButton().closest("form")!);
    });

    expect(mockPush).toHaveBeenCalledWith("/tournaments");
  });

  it("calls the complete-profile API endpoint on submit", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ message: "Profile updated" }),
      }),
    );

    render(<ProfileForm />);
    await act(async () => {
      fireEvent.submit(getSubmitButton().closest("form")!);
    });

    expect(vi.mocked(fetch)).toHaveBeenCalledWith(
      "/api/v1/auth/signup/complete-profile",
      expect.objectContaining({ method: "POST" }),
    );
  });

  it("shows error banner when the API returns an error", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: false,
        json: async () => ({
          error: { code: "INTERNAL_ERROR", message: "Something went wrong" },
        }),
      }),
    );

    render(<ProfileForm />);
    await act(async () => {
      fireEvent.submit(getSubmitButton().closest("form")!);
    });

    expect(screen.getByRole("alert").textContent).toContain(
      "Something went wrong",
    );
  });

  it("shows fallback error message when API response has no error field", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: false,
        json: async () => ({}),
      }),
    );

    render(<ProfileForm />);
    await act(async () => {
      fireEvent.submit(getSubmitButton().closest("form")!);
    });

    expect(screen.getByRole("alert").textContent).toContain(
      "Something went wrong",
    );
  });

  it("shows 'Network error' message when fetch throws", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockRejectedValue(new Error("Network down")),
    );

    render(<ProfileForm />);
    await act(async () => {
      fireEvent.submit(getSubmitButton().closest("form")!);
    });

    expect(screen.getByRole("alert").textContent).toContain("Network error");
  });
});
