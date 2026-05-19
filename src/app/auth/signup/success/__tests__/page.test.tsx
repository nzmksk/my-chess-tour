import React from "react";
import { describe, it, expect, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";

vi.mock("@/components/NavBar", () => ({ default: () => null }));
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

import SignUpSuccessPage from "../page";

describe("SignUpSuccessPage", () => {
  it("renders with provided name and email", async () => {
    const html = renderToStaticMarkup(
      await SignUpSuccessPage({
        searchParams: Promise.resolve({
          name: "Alice",
          email: "alice@example.com",
          since: "January 2026",
        }),
      }),
    );

    expect(html).toContain("Alice");
    expect(html).toContain("alice@example.com");
    expect(html).toContain("January 2026");
  });

  it("defaults name to 'Player' when not provided", async () => {
    const html = renderToStaticMarkup(
      await SignUpSuccessPage({
        searchParams: Promise.resolve({}),
      }),
    );

    expect(html).toContain("Player");
  });

  it("omits the email row when email is empty", async () => {
    const html = renderToStaticMarkup(
      await SignUpSuccessPage({
        searchParams: Promise.resolve({ name: "Bob", email: "" }),
      }),
    );

    // The session-key "Email" row should not appear when email is empty
    expect(html).not.toContain(">Email<");
  });

  it("shows the email row when email is provided", async () => {
    const html = renderToStaticMarkup(
      await SignUpSuccessPage({
        searchParams: Promise.resolve({ email: "bob@example.com" }),
      }),
    );

    expect(html).toContain("bob@example.com");
  });

  it("renders without searchParams (uses all defaults)", async () => {
    const html = renderToStaticMarkup(await SignUpSuccessPage({}));

    expect(html).toContain("Player");
    expect(html).toContain("Browse Tournaments");
  });
});
