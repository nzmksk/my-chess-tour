import { describe, expect, it } from "vitest";
import {
  BANK_SWIFT_CODES,
  MALAYSIAN_BANKS,
  bankNameForSwift,
} from "@/lib/malaysian-banks";

// Shape assertions, plus one that pins the exact set. MALAYSIAN_BANKS is a 1:1
// mirror of CHIP Send's documented BankCode list, so drift in either direction
// is a bug: a code CHIP does not know is a failed payout, and one we drop is a
// bank an organizer cannot pick.
// https://docs.chip-in.asia/openapi/chip-send.yaml (BankCode, 2026-11-05)
// Copied from the BankCode schema, in its order. Its description is
// authoritative if it ever disagrees with its `enum`. Kept as a literal, not
// derived from MALAYSIAN_BANKS, so that editing the list without checking CHIP
// first fails here instead of at payout time.
const CHIP_SEND_BANK_CODES = [
  "ACDBMYK2",
  "PHBMMYKL",
  "AGOBMYKL",
  "RJHIMYKL",
  "MFBBMYKL",
  "ARBKMYKL",
  "BIMBMYKL",
  "BKRMMYKL",
  "BMMBMYKL",
  "BOFAMY2X",
  "BKCHMYKL",
  "BOTKMYKX",
  "BSNAMYK1",
  "BNPAMYKL",
  "BOBEMYK2",
  "PCBCMYKL",
  "CIBBMYKL",
  "CITIMYKL",
  "DEUTMYKL",
  "FNXSMYNB",
  "GXSPMYKL",
  "HLBBMYKL",
  "HBMBMYKL",
  "ICBKMYKL",
  "CHASMYKX",
  "KFHOMYKL",
  "MBBEMYKL",
  "AFBQMYKL",
  "MHCBMYKA",
  "OCBCMYKL",
  "PBBEMYKL",
  "RHBBMYKL",
  "SCCHMYKL",
  "SCBLMYKX",
  "SMBCMYKL",
  "TNGDMYNB",
  "UOVBMYKL",
];

describe("MALAYSIAN_BANKS", () => {
  it("mirrors CHIP Send's BankCode list exactly", () => {
    expect([...BANK_SWIFT_CODES].sort()).toEqual(
      [...CHIP_SEND_BANK_CODES].sort(),
    );
  });

  it("is not empty", () => {
    expect(MALAYSIAN_BANKS.length).toBeGreaterThan(0);
  });

  it.each(MALAYSIAN_BANKS)("$name has a well-formed SWIFT code", (bank) => {
    // The DB CHECK is chk_bank_code_format: ^[A-Z0-9]{8}([A-Z0-9]{3})?$
    expect(bank.swift).toMatch(/^[A-Z0-9]{8}([A-Z0-9]{3})?$/);
  });

  it.each(MALAYSIAN_BANKS)("$swift has a non-empty display name", (bank) => {
    expect(bank.name.trim()).not.toBe("");
    // varchar(100) on organization_bank_accounts.bank_name
    expect(bank.name.length).toBeLessThanOrEqual(100);
  });

  it("has no duplicate SWIFT codes", () => {
    const codes = MALAYSIAN_BANKS.map((b) => b.swift);
    expect(new Set(codes).size).toBe(codes.length);
  });

  it("has no duplicate display names", () => {
    // Two entries with the same name would be indistinguishable in the picker.
    const names = MALAYSIAN_BANKS.map((b) => b.name);
    expect(new Set(names).size).toBe(names.length);
  });

  it("is sorted by name, so the picker reads alphabetically", () => {
    const names = MALAYSIAN_BANKS.map((b) => b.name);
    expect(names).toEqual([...names].sort((a, b) => a.localeCompare(b)));
  });
});

describe("BANK_SWIFT_CODES", () => {
  it("contains exactly the codes in the list", () => {
    expect(BANK_SWIFT_CODES.size).toBe(MALAYSIAN_BANKS.length);
    for (const bank of MALAYSIAN_BANKS) {
      expect(BANK_SWIFT_CODES.has(bank.swift)).toBe(true);
    }
  });

  it("does not contain an unknown code", () => {
    expect(BANK_SWIFT_CODES.has("NOTABANK")).toBe(false);
  });
});

describe("bankNameForSwift", () => {
  it("round-trips every entry", () => {
    for (const bank of MALAYSIAN_BANKS) {
      expect(bankNameForSwift(bank.swift)).toBe(bank.name);
    }
  });

  it("returns undefined for an unknown code, so callers must fail closed", () => {
    expect(bankNameForSwift("NOTABANK")).toBeUndefined();
  });

  it("is case-sensitive — SWIFT codes are uppercase", () => {
    expect(bankNameForSwift("mbbemykl")).toBeUndefined();
  });
});
