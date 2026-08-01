import { describe, it, expect } from "vitest";
import {
  DEFAULT_COUNTRY_CODE,
  SUPPORTED_COUNTRIES,
  findCountry,
  isSupportedCountry,
  isValidRegion,
  regionsForCountry,
  timeZoneForRegion,
} from "../venues";
import { DEFAULT_TIME_ZONE, isSupportedTimeZone } from "../datetime";

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
      const names = c.regions.map((r) => r.name);
      expect(new Set(names).size).toBe(names.length);
    }
  });

  // A region's zone is written straight to tournaments.timezone and then read
  // back by resolveTimeZone, which silently swaps anything off the picklist for
  // the default. A typo here would relocate a venue's clock without a word.
  it("gives every region a timezone the platform recognises", () => {
    for (const c of SUPPORTED_COUNTRIES) {
      for (const r of c.regions) {
        expect(isSupportedTimeZone(r.timeZone)).toBe(true);
      }
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

  // These arrive from `await request.json()`, where the declared field type is
  // a claim about well-behaved clients and nothing more. Guarding only
  // falsiness would let every truthy non-string reach .toUpperCase() and throw,
  // turning a bad request body into a 500.
  it("rejects non-string codes instead of throwing", () => {
    for (const bad of [123, true, {}, ["MY"], () => "MY"]) {
      expect(() => findCountry(bad)).not.toThrow();
      expect(findCountry(bad)).toBeUndefined();
      expect(isSupportedCountry(bad)).toBe(false);
      expect(regionsForCountry(bad)).toEqual([]);
    }
  });
});

describe("regionsForCountry / isValidRegion", () => {
  it("returns regions for a known country and empty for an unknown one", () => {
    expect(regionsForCountry("MY").map((r) => r.name)).toContain("Selangor");
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

  it("treats non-string regions as invalid instead of throwing", () => {
    expect(() => isValidRegion("MY", 123)).not.toThrow();
    expect(isValidRegion("MY", 123)).toBe(false);
    expect(isValidRegion(123, "Selangor")).toBe(false);
  });
});

describe("timeZoneForRegion", () => {
  it("resolves a region to the zone its dates are read in", () => {
    expect(timeZoneForRegion("MY", "Selangor")).toBe("Asia/Kuala_Lumpur");
    // East Malaysia keeps the same clock as the peninsula.
    expect(timeZoneForRegion("MY", "Sarawak")).toBe("Asia/Kuala_Lumpur");
  });

  // Callers write the result straight to tournaments.timezone, so it has to be
  // a zone Intl can format — throwing or returning "" would take down every
  // page that renders one of the tournament's dates.
  it("falls back to the platform default rather than failing", () => {
    expect(timeZoneForRegion("MY", "Atlantis")).toBe(DEFAULT_TIME_ZONE);
    expect(timeZoneForRegion("ZZ", "Selangor")).toBe(DEFAULT_TIME_ZONE);
    // An unfinished draft has no state yet.
    expect(timeZoneForRegion("MY", "")).toBe(DEFAULT_TIME_ZONE);
    expect(timeZoneForRegion(null, null)).toBe(DEFAULT_TIME_ZONE);
    expect(() => timeZoneForRegion(123, {})).not.toThrow();
  });
});
