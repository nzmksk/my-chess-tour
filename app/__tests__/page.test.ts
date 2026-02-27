import { describe, expect, it, vi } from "vitest";

const mockRedirect = vi.hoisted(() => vi.fn());

vi.mock("next/navigation", () => ({
  redirect: mockRedirect,
}));

import RootPage from "../page";

describe("RootPage", () => {
  it("redirects to /landing", () => {
    RootPage();
    expect(mockRedirect).toHaveBeenCalledOnce();
    expect(mockRedirect).toHaveBeenCalledWith("/landing");
  });
});
