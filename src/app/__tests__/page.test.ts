import { beforeEach, describe, expect, it, vi } from "vitest";

const mockRedirect = vi.hoisted(() => vi.fn());

vi.mock("next/navigation", () => ({
  redirect: mockRedirect,
}));

vi.mock("@/lib/github", () => ({
  getIssueProgress: vi.fn().mockResolvedValue(50),
}));

vi.mock("@/components/WaitlistForm", () => ({
  default: vi.fn().mockReturnValue(null),
}));

vi.mock("@/components/BuildProgress", () => ({
  default: vi.fn().mockReturnValue(null),
}));

vi.mock("@/components/ProgressSkeleton", () => ({
  default: vi.fn().mockReturnValue(null),
}));

import LandingPage from "../page";

describe("RootPage (landing at /)", () => {
  beforeEach(() => vi.clearAllMocks());

  it("does not redirect", () => {
    LandingPage();
    expect(mockRedirect).not.toHaveBeenCalled();
  });

  it("returns a non-null React element", () => {
    const result = LandingPage();
    expect(result).not.toBeNull();
    expect(result).toBeDefined();
  });
});
