import { describe, it, expect, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";

vi.mock("next/font/google", () => ({
  Cinzel: () => ({ variable: "--font-cinzel" }),
  Lato: () => ({ variable: "--font-lato" }),
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
});
