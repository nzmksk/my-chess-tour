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

  it("renders the Terms and Conditions link", () => {
    const html = renderToStaticMarkup(<Footer />);
    expect(html).toContain('href="/terms"');
    expect(html).toContain("Terms and Conditions");
  });

  it("renders the Privacy Policy link", () => {
    const html = renderToStaticMarkup(<Footer />);
    expect(html).toContain('href="/privacy"');
    expect(html).toContain("Privacy Policy");
  });

  it("renders the Organizer Agreement link", () => {
    const html = renderToStaticMarkup(<Footer />);
    expect(html).toContain('href="/organizer-agreement"');
    expect(html).toContain("Organizer Agreement");
  });

  it("renders the Facebook social link", () => {
    const html = renderToStaticMarkup(<Footer />);
    expect(html).toContain("facebook.com/mychesstour");
    expect(html).toContain("Facebook");
  });

  it("renders the Instagram social link", () => {
    const html = renderToStaticMarkup(<Footer />);
    expect(html).toContain("instagram.com/mychesstour");
    expect(html).toContain("Instagram");
  });

  it("renders the LinkedIn social link", () => {
    const html = renderToStaticMarkup(<Footer />);
    expect(html).toContain("linkedin.com/company/mychesstour");
    expect(html).toContain("LinkedIn");
  });

  it("does not render old navigation links", () => {
    const html = renderToStaticMarkup(<Footer />);
    expect(html).not.toContain('href="/tournaments"');
    expect(html).not.toContain('href="/organizations/apply"');
    expect(html).not.toContain('href="/auth/login"');
    expect(html).not.toContain('href="/auth/signup"');
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

  it("opens social links in a new tab", () => {
    const html = renderToStaticMarkup(<Footer />);
    expect(html).toContain('target="_blank"');
    expect(html).toContain('rel="noopener noreferrer"');
  });
});
