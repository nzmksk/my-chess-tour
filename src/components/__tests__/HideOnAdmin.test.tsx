import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import * as React from "react";

const mockPathname = vi.fn<() => string | null>();
vi.mock("next/navigation", () => ({
  usePathname: () => mockPathname(),
}));

import { HideOnAdmin } from "../HideOnAdmin";

function render(pathname: string | null) {
  mockPathname.mockReturnValue(pathname);
  return renderToStaticMarkup(
    <HideOnAdmin>
      <span id="child">shown</span>
    </HideOnAdmin>,
  );
}

describe("HideOnAdmin", () => {
  beforeEach(() => mockPathname.mockReset());

  it.each(["/", "/terms", "/my/tournaments", "/auth/signup", "/administer"])(
    "renders its children on %s",
    (pathname) => {
      expect(render(pathname)).toContain('<span id="child">shown</span>');
    },
  );

  it.each(["/admin", "/admin/dashboard", "/admin/payouts/abc"])(
    "renders nothing on %s",
    (pathname) => {
      expect(render(pathname)).toBe("");
    },
  );

  it("renders its children when the pathname is unknown", () => {
    expect(render(null)).toContain("shown");
  });
});
