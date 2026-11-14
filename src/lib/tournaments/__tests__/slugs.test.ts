import { describe, expect, it } from "vitest";
import { ensureUniqueSlug, slugify } from "../slugs";

describe("slugify", () => {
  it("lowercases and hyphenates a normal name", () => {
    expect(slugify("Penang Open 2026")).toBe("penang-open-2026");
  });

  it("collapses runs of non-alphanumerics into a single hyphen", () => {
    expect(slugify("KL  Open — Rapid!! (2026)")).toBe("kl-open-rapid-2026");
  });

  it("trims leading and trailing separators", () => {
    expect(slugify("  --Selangor Masters--  ")).toBe("selangor-masters");
  });

  it("strips diacritics", () => {
    expect(slugify("Café Champions Cup")).toBe("cafe-champions-cup");
  });

  it("falls back to 'tournament' when nothing usable remains", () => {
    expect(slugify("!!!")).toBe("tournament");
    expect(slugify("名人戦")).toBe("tournament");
  });

  it("caps length and does not end on a hyphen", () => {
    const slug = slugify("a".repeat(100));
    expect(slug.length).toBeLessThanOrEqual(50);
    expect(slug.endsWith("-")).toBe(false);
  });
});

describe("ensureUniqueSlug", () => {
  it("returns the base slug when it is free", async () => {
    const result = await ensureUniqueSlug("penang-open", async () => false);
    expect(result).toBe("penang-open");
  });

  it("appends -2, then -3 until a free slug is found", async () => {
    const taken = new Set(["penang-open", "penang-open-2"]);
    const result = await ensureUniqueSlug("penang-open", async (c) =>
      taken.has(c),
    );
    expect(result).toBe("penang-open-3");
  });
});
