// @vitest-environment jsdom
import React from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, render } from "@testing-library/react";

const mockPush = vi.fn();
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: mockPush }),
}));

beforeEach(() => {
  mockPush.mockClear();
});

afterEach(() => {
  vi.useRealTimers();
});

vi.mock("@/components/NavBar", () => ({
  default: vi.fn().mockReturnValue(null),
}));

vi.mock("next/link", () => ({
  default: vi.fn().mockReturnValue(null),
}));

import SignedOutPage from "../page";

describe("SignedOutPage", () => {
  it("returns a non-null React element", () => {
    const { container } = render(<SignedOutPage />);
    expect(container.firstChild).not.toBeNull();
  });

  it("has a min-h-screen container", () => {
    const { container } = render(<SignedOutPage />);
    const root = container.firstChild as HTMLElement;
    expect(root.className).toContain("min-h-screen");
  });

  it("displays the initial countdown at 10 seconds", () => {
    const { container } = render(<SignedOutPage />);
    expect(container.textContent).toContain("10s");
  });

  it("redirects to /tournaments when the timer reaches 0", async () => {
    vi.useFakeTimers();

    render(<SignedOutPage />);

    for (let i = 0; i < 10; i++) {
      await act(async () => {
        vi.advanceTimersByTime(1000);
      });
    }

    expect(mockPush).toHaveBeenCalledWith("/tournaments");
  });

  it("decrements the displayed countdown each second", async () => {
    vi.useFakeTimers();

    const { getByText } = render(<SignedOutPage />);

    await act(async () => {
      vi.advanceTimersByTime(1000);
    });

    expect(getByText(/9s/)).toBeDefined();
  });
});
