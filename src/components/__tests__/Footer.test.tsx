import { describe, it, expect, vi, afterEach } from "vitest";
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

  it("renders the Changelog link", () => {
    const html = renderToStaticMarkup(<Footer />);
    expect(html).toContain('href="/changelogs"');
    expect(html).toContain("Changelog");
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

  describe("release version", () => {
    afterEach(() => {
      vi.unstubAllEnvs();
    });

    it("shows the release version", () => {
      vi.stubEnv("APP_VERSION", "v0.10.0-alpha");
      vi.stubEnv("APP_COMMIT", "");
      const html = renderToStaticMarkup(<Footer />);
      expect(html).toContain("v0.10.0-alpha</a>");
    });

    it("appends the short commit outside production", () => {
      vi.stubEnv("APP_VERSION", "v0.10.0-alpha");
      vi.stubEnv("APP_COMMIT", "2579032");
      vi.stubEnv("NEXT_PUBLIC_ENVIRONMENT", "staging");
      const html = renderToStaticMarkup(<Footer />);
      expect(html).toContain("v0.10.0-alpha · 2579032");
    });

    it("shows the version only in production", () => {
      vi.stubEnv("APP_VERSION", "v0.10.0-alpha");
      vi.stubEnv("APP_COMMIT", "2579032");
      vi.stubEnv("NEXT_PUBLIC_ENVIRONMENT", "production");
      const html = renderToStaticMarkup(<Footer />);
      expect(html).toContain("v0.10.0-alpha</a>");
      expect(html).not.toContain("2579032");
    });

    it("links the version to its changelog entry", () => {
      vi.stubEnv("APP_VERSION", "v0.10.0-alpha");
      const html = renderToStaticMarkup(<Footer />);
      expect(html).toContain('href="/changelogs#v0.10.0-alpha"');
    });

    it("links a non-release version to the changelog page", () => {
      vi.stubEnv("APP_VERSION", "dev");
      const html = renderToStaticMarkup(<Footer />);
      expect(html).toContain('href="/changelogs"');
      expect(html).not.toContain('href="/changelogs#');
    });

    it("renders no version line when none was inlined", () => {
      vi.stubEnv("APP_VERSION", "");
      vi.stubEnv("APP_COMMIT", "2579032");
      const html = renderToStaticMarkup(<Footer />);
      expect(html).not.toContain("2579032");
    });
  });
});
