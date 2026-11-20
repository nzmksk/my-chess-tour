import { describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import * as React from "react";

vi.mock("next/link", () => ({
  default: ({
    href,
    children,
    className,
  }: {
    href: string;
    children: React.ReactNode;
    className?: string;
  }) => (
    <a href={href} className={className}>
      {children}
    </a>
  ),
}));

import NotFound from "../not-found";

describe("NotFound", () => {
  it("opts out of the site footer (#643)", () => {
    // Footer hides itself while the page holds a data-no-footer element.
    const html = renderToStaticMarkup(<NotFound />);
    expect(html).toContain("data-no-footer");
  });

  it("links back home", () => {
    const html = renderToStaticMarkup(<NotFound />);
    expect(html).toContain('href="/"');
  });
});
