import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import {
  BrowseIcon,
  CloseIcon,
  FacebookIcon,
  InstagramIcon,
  LinkedInIcon,
  LogoutIcon,
  MenuIcon,
  MoonIcon,
  PayIcon,
  SunIcon,
  TrophyIcon,
} from "../Icons";

describe("Icons", () => {
  it("renders BrowseIcon as an SVG element", () => {
    const html = renderToStaticMarkup(<BrowseIcon />);
    expect(html).toContain("<svg");
    expect(html).toContain("viewBox");
  });

  it("renders PayIcon as an SVG element", () => {
    const html = renderToStaticMarkup(<PayIcon />);
    expect(html).toContain("<svg");
    expect(html).toContain("viewBox");
  });

  it("renders TrophyIcon as an SVG element", () => {
    const html = renderToStaticMarkup(<TrophyIcon />);
    expect(html).toContain("<svg");
    expect(html).toContain("viewBox");
  });

  it("renders FacebookIcon as an SVG with correct dimensions", () => {
    const html = renderToStaticMarkup(<FacebookIcon />);
    expect(html).toContain("<svg");
    expect(html).toContain('width="16"');
    expect(html).toContain('height="16"');
  });

  it("renders InstagramIcon as an SVG with stroke", () => {
    const html = renderToStaticMarkup(<InstagramIcon />);
    expect(html).toContain("<svg");
    expect(html).toContain("stroke");
  });

  it("renders LinkedInIcon as an SVG element", () => {
    const html = renderToStaticMarkup(<LinkedInIcon />);
    expect(html).toContain("<svg");
    expect(html).toContain('aria-hidden="true"');
  });

  it("renders LogoutIcon as an SVG element", () => {
    const html = renderToStaticMarkup(<LogoutIcon />);
    expect(html).toContain("<svg");
    expect(html).toContain('aria-hidden="true"');
  });

  it("renders MenuIcon as an SVG with three lines", () => {
    const html = renderToStaticMarkup(<MenuIcon />);
    expect(html).toContain("<svg");
    expect(html).toContain("<line");
  });

  it("renders CloseIcon as an SVG with cross lines", () => {
    const html = renderToStaticMarkup(<CloseIcon />);
    expect(html).toContain("<svg");
    expect(html).toContain("<line");
  });

  it("renders SunIcon as an SVG with a circle", () => {
    const html = renderToStaticMarkup(<SunIcon />);
    expect(html).toContain("<svg");
    expect(html).toContain("<circle");
  });

  it("renders MoonIcon as an SVG with a path", () => {
    const html = renderToStaticMarkup(<MoonIcon />);
    expect(html).toContain("<svg");
    expect(html).toContain("<path");
  });
});
