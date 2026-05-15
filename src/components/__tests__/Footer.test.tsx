import { describe, it, expect, vi } from "vitest";
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

import Footer from "../Footer";

describe("Footer", () => {
  it("renders a footer element", () => {
    const html = renderToStaticMarkup(<Footer />);
    expect(html).toContain("<footer");
  });

  it("renders the brand name", () => {
    const html = renderToStaticMarkup(<Footer />);
    expect(html).toContain("MY Chess Tour");
  });

  it("renders the tagline", () => {
    const html = renderToStaticMarkup(<Footer />);
    expect(html).toContain("Malaysia");
    expect(html).toContain("premier competitive chess circuit");
  });

  it("renders the Tournaments navigation link", () => {
    const html = renderToStaticMarkup(<Footer />);
    expect(html).toContain('href="/tournaments"');
    expect(html).toContain("Tournaments");
  });

  it("renders the Become an Organizer link", () => {
    const html = renderToStaticMarkup(<Footer />);
    expect(html).toContain('href="/organizations/apply"');
    expect(html).toContain("Become an Organizer");
  });

  it("renders the Login link", () => {
    const html = renderToStaticMarkup(<Footer />);
    expect(html).toContain('href="/auth/login"');
    expect(html).toContain("Login");
  });

  it("renders the Sign Up link", () => {
    const html = renderToStaticMarkup(<Footer />);
    expect(html).toContain('href="/auth/signup"');
    expect(html).toContain("Sign Up");
  });

  it("renders a copyright notice", () => {
    const html = renderToStaticMarkup(<Footer />);
    expect(html).toContain("MY Chess Tour. All rights reserved.");
  });

  it("renders the current year in the copyright notice", () => {
    const html = renderToStaticMarkup(<Footer />);
    expect(html).toContain(String(new Date().getFullYear()));
  });

  it("applies footer-link class to nav links", () => {
    const html = renderToStaticMarkup(<Footer />);
    expect(html).toContain("footer-link");
  });
});
