import { describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";

vi.mock("@/components/NavBar", () => ({
  default: vi.fn().mockReturnValue(null),
}));

import NameGuidePage, { metadata } from "../page";
import { NAME_GROUPS } from "@/lib/reference/name-examples";

describe("NameGuidePage", () => {
  const html = renderToStaticMarkup(<NameGuidePage />);

  it("has a title", () => {
    expect(metadata.title).toBe("How to Enter Your Name");
  });

  it("renders every group and example", () => {
    for (const group of NAME_GROUPS) {
      expect(html).toContain(group.heading);
      for (const example of group.examples) {
        expect(html).toContain(
          `<td>${example.onId.replace(/'/g, "&#x27;")}</td>`,
        );
      }
    }
  });

  it("explains what goes in each field", () => {
    expect(html).toMatch(
      /Last name<\/strong> is the\s+part that comes from your family/,
    );
    expect(html).toContain("a/l");
  });
});
