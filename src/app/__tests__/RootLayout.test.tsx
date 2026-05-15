import { describe, it, expect, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import * as React from "react";

vi.mock("next/font/google", () => ({
  Cinzel: () => ({ variable: "--font-cinzel" }),
  Lato: () => ({ variable: "--font-lato" }),
}));

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

import RootLayout from "../layout";

describe("RootLayout", () => {
  it('sets lang="en" on the html element', () => {
    const html = renderToStaticMarkup(<RootLayout>test</RootLayout>);
    expect(html).toContain('lang="en"');
  });

  it("includes Cinzel font variable in html className", () => {
    const html = renderToStaticMarkup(<RootLayout>test</RootLayout>);
    expect(html).toContain("--font-cinzel");
  });

  it("includes Lato font variable in html className", () => {
    const html = renderToStaticMarkup(<RootLayout>test</RootLayout>);
    expect(html).toContain("--font-lato");
  });

  it("renders children inside body", () => {
    const html = renderToStaticMarkup(
      <RootLayout>
        <span id="child">hello</span>
      </RootLayout>,
    );
    expect(html).toContain('<span id="child">hello</span>');
  });

  it("renders a footer element", () => {
    const html = renderToStaticMarkup(<RootLayout>test</RootLayout>);
    expect(html).toContain("<footer");
  });
});
