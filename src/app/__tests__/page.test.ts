import { beforeEach, describe, expect, it, vi } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

const mockRedirect = vi.hoisted(() => vi.fn());

vi.mock("next/navigation", () => ({
  redirect: mockRedirect,
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

  it("renders every feature card with its icon", () => {
    const html = renderToStaticMarkup(createElement(LandingPage));
    for (const title of [
      "Browse Tournaments",
      "Register &amp; Pay Online",
      "One Player Profile",
      "For Parents",
      "For Organizers",
      "More Coming Soon",
    ]) {
      expect(html).toContain(title);
    }
    expect(html.match(/<svg/g)).toHaveLength(6);
  });
});
