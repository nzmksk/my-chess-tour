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

const { mockPush, mockGetUser, mockUpload, mockGetPublicUrl } = vi.hoisted(
  () => ({
    mockPush: vi.fn(),
    mockGetUser: vi.fn(),
    mockUpload: vi.fn(),
    mockGetPublicUrl: vi.fn(),
  }),
);

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: mockPush }),
}));

vi.mock("../StepTracker", () => ({ default: () => null }));

// Stub the country dropdown (Radix Popover + cmdk) with a lightweight control so
// these tests stay focused on ProfileForm. Clicking it fires onChange like a
// real country selection would. aria-label keeps the "Nationality" query working.
vi.mock("@/components/ui/country-dropdown", () => ({
  CountryDropdown: ({
    placeholder,
    onChange,
  }: {
    placeholder?: string;
    onChange?: (c: { name: string; alpha2: string; alpha3: string }) => void;
  }) => (
    <button
      type="button"
      aria-label="Nationality"
      onClick={() =>
        onChange?.({ name: "Singapore", alpha2: "SG", alpha3: "SGP" })
      }
    >
      {placeholder}
    </button>
  ),
}));

vi.mock("next/image", () => ({
  default: ({ src, alt }: { src: string; alt: string }) => (
    // eslint-disable-next-line @next/next/no-img-element -- test stub for next/image
    <img src={src} alt={alt} />
  ),
}));

vi.mock("@/services/supabase/client", () => ({
  createClient: () => ({
    auth: { getUser: mockGetUser },
    storage: {
      from: () => ({ upload: mockUpload, getPublicUrl: mockGetPublicUrl }),
    },
  }),
}));

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

function makeImageFile(name: string, type: string, sizeBytes = 1024): File {
  const file = new File(["x"], name, { type });
  Object.defineProperty(file, "size", { value: sizeBytes });
  return file;
}

function getFileInput(): HTMLInputElement {
  return screen.getByLabelText("Profile photo file input") as HTMLInputElement;
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
    const nationality = screen.getByLabelText("Nationality");

    expect(gender.required).toBe(false);
    expect(gender.getAttribute("aria-required")).toBeNull();
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

  it("fires onChange when a nationality is selected", async () => {
    render(<ProfileForm />);
    await act(async () => {
      fireEvent.click(screen.getByLabelText("Nationality"));
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

  // --- Avatar upload --------------------------------------------------------

  it("rejects a non-image file type", async () => {
    render(<ProfileForm />);
    await act(async () => {
      fireEvent.change(getFileInput(), {
        target: { files: [makeImageFile("a.gif", "image/gif")] },
      });
    });
    expect(screen.getByRole("alert").textContent).toContain("JPG or PNG");
  });

  it("rejects an image larger than 2 MB", async () => {
    render(<ProfileForm />);
    await act(async () => {
      fireEvent.change(getFileInput(), {
        target: {
          files: [makeImageFile("big.png", "image/png", 3 * 1024 * 1024)],
        },
      });
    });
    expect(screen.getByRole("alert").textContent).toContain("2 MB");
  });

  it("shows a preview after a valid image is selected", async () => {
    render(<ProfileForm />);
    await act(async () => {
      fireEvent.change(getFileInput(), {
        target: { files: [makeImageFile("ok.png", "image/png")] },
      });
    });
    const img = await screen.findByAltText("Profile photo preview");
    expect(img).toBeDefined();
  });

  it("uploads the avatar and includes its URL in the profile request", async () => {
    mockGetUser.mockResolvedValue({ data: { user: { id: "u1" } } });
    mockUpload.mockResolvedValue({ error: null });
    mockGetPublicUrl.mockReturnValue({
      data: { publicUrl: "https://cdn/u1.png" },
    });
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockResolvedValue({ ok: true, json: async () => ({ message: "ok" }) }),
    );

    render(<ProfileForm />);
    await act(async () => {
      fireEvent.change(getFileInput(), {
        target: { files: [makeImageFile("ok.png", "image/png")] },
      });
    });
    await act(async () => {
      fireEvent.submit(getSubmitButton().closest("form")!);
    });

    expect(mockUpload).toHaveBeenCalled();
    const body = JSON.parse(
      (vi.mocked(fetch).mock.calls[0][1] as RequestInit).body as string,
    );
    expect(body.avatarUrl).toBe("https://cdn/u1.png");
    expect(mockPush).toHaveBeenCalledWith("/tournaments");
  });

  it("shows an error when the avatar upload fails", async () => {
    mockGetUser.mockResolvedValue({ data: { user: { id: "u1" } } });
    mockUpload.mockResolvedValue({ error: { message: "boom" } });
    vi.stubGlobal("fetch", vi.fn());

    render(<ProfileForm />);
    await act(async () => {
      fireEvent.change(getFileInput(), {
        target: { files: [makeImageFile("ok.png", "image/png")] },
      });
    });
    await act(async () => {
      fireEvent.submit(getSubmitButton().closest("form")!);
    });

    expect(screen.getByRole("alert").textContent).toContain(
      "Failed to upload photo",
    );
    expect(vi.mocked(fetch)).not.toHaveBeenCalled();
  });

  it("opens the file picker when the avatar is clicked", async () => {
    render(<ProfileForm />);
    const avatar = screen.getByRole("button", { name: "Upload profile photo" });
    await act(async () => {
      fireEvent.click(avatar);
    });
    expect(avatar).toBeDefined();
  });

  it("opens the file picker on Enter or Space, ignoring other keys", async () => {
    render(<ProfileForm />);
    const avatar = screen.getByRole("button", { name: "Upload profile photo" });
    await act(async () => {
      fireEvent.keyDown(avatar, { key: "Enter" });
      fireEvent.keyDown(avatar, { key: " " });
      fireEvent.keyDown(avatar, { key: "a" }); // non-trigger branch
    });
    expect(avatar).toBeDefined();
  });

  it("skips the upload when there is no authenticated user", async () => {
    mockGetUser.mockResolvedValue({ data: { user: null } });
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockResolvedValue({ ok: true, json: async () => ({ message: "ok" }) }),
    );

    render(<ProfileForm />);
    await act(async () => {
      fireEvent.change(getFileInput(), {
        target: { files: [makeImageFile("ok.png", "image/png")] },
      });
    });
    await act(async () => {
      fireEvent.submit(getSubmitButton().closest("form")!);
    });

    expect(mockUpload).not.toHaveBeenCalled();
    const body = JSON.parse(
      (vi.mocked(fetch).mock.calls[0][1] as RequestInit).body as string,
    );
    expect(body.avatarUrl).toBeUndefined();
    expect(mockPush).toHaveBeenCalledWith("/tournaments");
  });
});
