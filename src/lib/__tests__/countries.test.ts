import { describe, expect, it } from "vitest";
import { nameToAlpha3, resolveCountry } from "../countries";

describe("nameToAlpha3", () => {
  it("returns undefined for null", () => {
    expect(nameToAlpha3(null)).toBeUndefined();
  });

  it("returns undefined for undefined", () => {
    expect(nameToAlpha3(undefined)).toBeUndefined();
  });

  it("returns undefined for empty string", () => {
    expect(nameToAlpha3("")).toBeUndefined();
  });

  it("resolves a known country name to its alpha-3 code", () => {
    expect(nameToAlpha3("Malaysia")).toBe("MYS");
  });

  it("matches case-insensitively", () => {
    expect(nameToAlpha3("malaysia")).toBe("MYS");
    expect(nameToAlpha3("MALAYSIA")).toBe("MYS");
  });

  it("returns undefined for an unknown country name", () => {
    expect(nameToAlpha3("NotACountry")).toBeUndefined();
  });
});

describe("resolveCountry", () => {
  it("returns undefined for null", () => {
    expect(resolveCountry(null)).toBeUndefined();
  });

  it("returns undefined for undefined", () => {
    expect(resolveCountry(undefined)).toBeUndefined();
  });

  it("returns undefined for empty string", () => {
    expect(resolveCountry("")).toBeUndefined();
  });

  it("returns undefined for whitespace-only string", () => {
    expect(resolveCountry("   ")).toBeUndefined();
  });

  it("resolves by full country name", () => {
    const result = resolveCountry("Malaysia");
    expect(result?.alpha3).toBe("MYS");
  });

  it("resolves by alpha-2 code", () => {
    const result = resolveCountry("MY");
    expect(result?.alpha3).toBe("MYS");
  });

  it("resolves by alpha-3 code", () => {
    const result = resolveCountry("MYS");
    expect(result?.alpha3).toBe("MYS");
  });

  it("returns a full country object", () => {
    const result = resolveCountry("MY");
    expect(result?.name).toBe("Malaysia");
    expect(result?.alpha2).toBe("MY");
    expect(result?.alpha3).toBe("MYS");
  });

  it("returns undefined for an unknown value", () => {
    expect(resolveCountry("NotACountry")).toBeUndefined();
  });

  it("is case-sensitive for name matching", () => {
    expect(resolveCountry("malaysia")).toBeUndefined();
  });
});
