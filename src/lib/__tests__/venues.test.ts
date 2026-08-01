import { describe, it, expect } from "vitest";
import {
  DEFAULT_COUNTRY_CODE,
  SUPPORTED_COUNTRIES,
  findCountry,
  isSupportedCountry,
  isValidRegion,
  regionsForCountry,
} from "../venues";

describe("SUPPORTED_COUNTRIES", () => {
  it("uses uppercase ISO 3166-1 alpha-2 codes", () => {
    for (const c of SUPPORTED_COUNTRIES) {
      expect(c.code).toMatch(/^[A-Z]{2}$/);
    }
  });

  it("has no duplicate country codes", () => {
    const codes = SUPPORTED_COUNTRIES.map((c) => c.code);
    expect(new Set(codes).size).toBe(codes.length);
  });

  it("gives every country at least one region, with no duplicates", () => {
    for (const c of SUPPORTED_COUNTRIES) {
      expect(c.regions.length).toBeGreaterThan(0);
      expect(new Set(c.regions).size).toBe(c.regions.length);
    }
  });

  it("includes the default country", () => {
    expect(findCountry(DEFAULT_COUNTRY_CODE)).toBeDefined();
  });
});

describe("findCountry / isSupportedCountry", () => {
  it("matches case-insensitively", () => {
    expect(findCountry("my")?.code).toBe("MY");
    expect(isSupportedCountry("My")).toBe(true);
  });

  it("rejects unknown, empty, and nullish codes", () => {
    expect(isSupportedCountry("ZZ")).toBe(false);
    expect(isSupportedCountry("")).toBe(false);
    expect(isSupportedCountry(null)).toBe(false);
    expect(isSupportedCountry(undefined)).toBe(false);
  });
});

describe("regionsForCountry / isValidRegion", () => {
  it("returns regions for a known country and empty for an unknown one", () => {
    expect(regionsForCountry("MY")).toContain("Selangor");
    expect(regionsForCountry("ZZ")).toEqual([]);
  });

  it("validates a region against its own country only", () => {
    expect(isValidRegion("MY", "Selangor")).toBe(true);
    expect(isValidRegion("MY", "Atlantis")).toBe(false);
    expect(isValidRegion("ZZ", "Selangor")).toBe(false);
  });

  it("treats empty and nullish regions as invalid", () => {
    expect(isValidRegion("MY", "")).toBe(false);
    expect(isValidRegion("MY", null)).toBe(false);
  });
});
