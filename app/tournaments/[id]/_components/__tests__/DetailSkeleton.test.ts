import { describe, it, expect } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import DetailSkeleton from "../DetailSkeleton";

describe("DetailSkeleton", () => {
  it("renders without crashing", () => {
    const html = renderToStaticMarkup(DetailSkeleton());
    expect(html).toBeTruthy();
  });

  it("renders skeleton pulse elements", () => {
    const html = renderToStaticMarkup(DetailSkeleton());
    expect(html).toContain("animate-pulse");
  });
});
