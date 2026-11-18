import { describe, it, expect, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import * as React from "react";

vi.mock("next/font/google", () => ({
  Cinzel: () => ({ variable: "--font-cinzel" }),
  Lato: () => ({ variable: "--font-lato" }),
}));

vi.mock("@/services/supabase/permission", () => ({
  getNavUser: vi.fn().mockResolvedValue(null),
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

const mockPathname = vi.fn<() => string>(() => "/");
vi.mock("next/navigation", () => ({
  usePathname: () => mockPathname(),
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

  it("renders the footer with the legal links", async () => {
    mockPathname.mockReturnValue("/tournaments/some-open");
    const html = await renderLayout("test");
    expect(html).toContain("<footer");
    expect(html).toContain('href="/terms"');
    expect(html).toContain('href="/privacy"');
    expect(html).toContain('href="/organizer-agreement"');
  });

  it("puts the footer after the page", async () => {
    mockPathname.mockReturnValue("/");
    const html = await renderLayout(<span id="child">hello</span>);
    expect(html.indexOf('id="child"')).toBeLessThan(html.indexOf("<footer"));
  });

  it("leaves the footer out of the admin console", async () => {
    mockPathname.mockReturnValue("/admin/dashboard");
    const html = await renderLayout("test");
    expect(html).not.toContain("<footer");
  });
});
