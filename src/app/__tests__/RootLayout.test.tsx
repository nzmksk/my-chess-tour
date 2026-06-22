import { describe, it, expect, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import * as React from "react";

vi.mock("next/font/google", () => ({
  Cinzel: () => ({ variable: "--font-cinzel" }),
  Lato: () => ({ variable: "--font-lato" }),
}));

vi.mock("@/services/supabase/permission", () => ({
  getAuthClaims: vi.fn().mockResolvedValue(null),
}));

vi.mock("@/components/AuthProvider", () => ({
  AuthProvider: ({ children }: { children: React.ReactNode }) => (
    <>{children}</>
  ),
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
  // RootLayout is an async server component, so resolve it to an element first.
  async function renderLayout(children: React.ReactNode) {
    return renderToStaticMarkup(await RootLayout({ children }));
  }

  it('sets lang="en" on the html element', async () => {
    const html = await renderLayout("test");
    expect(html).toContain('lang="en"');
  });

  it("includes Cinzel font variable in html className", async () => {
    const html = await renderLayout("test");
    expect(html).toContain("--font-cinzel");
  });

  it("includes Lato font variable in html className", async () => {
    const html = await renderLayout("test");
    expect(html).toContain("--font-lato");
  });

  it("renders children inside body", async () => {
    const html = await renderLayout(<span id="child">hello</span>);
    expect(html).toContain('<span id="child">hello</span>');
  });
});
