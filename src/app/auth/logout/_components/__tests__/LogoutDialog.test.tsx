// @vitest-environment jsdom
import React from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  act,
} from "@testing-library/react";

// ---------------------------------------------------------------------------
// Mocks — hoisted so they run before imports
// ---------------------------------------------------------------------------

const mocks = vi.hoisted(() => ({
  back: vi.fn(),
  push: vi.fn(),
  logout: vi.fn(),
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ back: mocks.back, push: mocks.push }),
}));

vi.mock("../../actions", () => ({
  logout: mocks.logout,
}));

let mockIsPending = false;
const mockStartTransition = vi.fn((fn: () => void) => fn());

vi.mock("react", async () => {
  const actual = await vi.importActual<typeof import("react")>("react");
  return {
    ...actual,
    useTransition: () => [mockIsPending, mockStartTransition],
  };
});

import LogoutDialog from "../LogoutDialog";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

afterEach(() => {
  cleanup();
  mockIsPending = false;
  vi.clearAllMocks();
});

beforeEach(() => {
  mockIsPending = false;
  mocks.logout.mockResolvedValue(undefined);
});

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("LogoutDialog", () => {
  // --- Rendering -------------------------------------------------------------

  it("renders Sign Out? heading", () => {
    render(<LogoutDialog />);
    expect(screen.getByText("Sign Out?")).toBeDefined();
  });

  it("renders confirmation body text", () => {
    render(<LogoutDialog />);
    expect(
      screen.getByText(/signing out of your MY Chess Tour account/i),
    ).toBeDefined();
  });

  it("renders Yes, Sign Out button", () => {
    render(<LogoutDialog />);
    expect(screen.getByRole("button", { name: "Yes, Sign Out" })).toBeDefined();
  });

  it("renders Cancel button", () => {
    render(<LogoutDialog />);
    expect(screen.getByRole("button", { name: "Cancel" })).toBeDefined();
  });

  it("Yes, Sign Out button has btn-danger class", () => {
    render(<LogoutDialog />);
    const btn = screen.getByRole("button", {
      name: "Yes, Sign Out",
    }) as HTMLButtonElement;
    expect(btn.className).toContain("btn-danger");
  });

  it("Cancel button has btn-secondary class", () => {
    render(<LogoutDialog />);
    const btn = screen.getByRole("button", {
      name: "Cancel",
    }) as HTMLButtonElement;
    expect(btn.className).toContain("btn-secondary");
  });

  // --- Interactions ----------------------------------------------------------

  it("calls logout action when Yes, Sign Out is clicked", async () => {
    render(<LogoutDialog />);
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Yes, Sign Out" }));
    });
    expect(mocks.logout).toHaveBeenCalledOnce();
  });

  it("navigates away when Cancel is clicked", async () => {
    render(<LogoutDialog />);
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    });
    // jsdom history.length === 1, so the fallback push("/tournaments") is used
    expect(mocks.back).toHaveBeenCalledTimes(0);
    expect(mocks.push).toHaveBeenCalledWith("/tournaments");
  });

  it("calls router.back() when Cancel is clicked and history has entries", async () => {
    Object.defineProperty(window, "history", {
      value: { ...window.history, length: 3 },
      writable: true,
      configurable: true,
    });
    render(<LogoutDialog />);
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    });
    expect(mocks.back).toHaveBeenCalledOnce();
    // restore
    Object.defineProperty(window, "history", {
      value: { ...window.history, length: 1 },
      writable: true,
      configurable: true,
    });
  });

  // --- Pending state ---------------------------------------------------------

  it("shows Signing Out… text and disables button when pending", () => {
    mockIsPending = true;
    render(<LogoutDialog />);
    const btn = screen.getByRole("button", {
      name: /Signing Out/i,
    }) as HTMLButtonElement;
    expect(btn).toBeDefined();
    expect(btn.disabled).toBe(true);
  });

  it("disables Cancel button when pending", () => {
    mockIsPending = true;
    render(<LogoutDialog />);
    const btn = screen.getByRole("button", {
      name: "Cancel",
    }) as HTMLButtonElement;
    expect(btn.disabled).toBe(true);
  });

  it("Yes, Sign Out button is not disabled in non-pending state", () => {
    render(<LogoutDialog />);
    const btn = screen.getByRole("button", {
      name: "Yes, Sign Out",
    }) as HTMLButtonElement;
    expect(btn.disabled).toBe(false);
  });
});
