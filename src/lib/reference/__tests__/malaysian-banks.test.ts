import { describe, expect, it } from "vitest";
import {
  BANK_SWIFT_CODES,
  accountNumberLengthError,
  MALAYSIAN_BANKS,
  bankNameForSwift,
} from "@/lib/reference/malaysian-banks";

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
    expect(bank.swift).toMatch(/^[A-Z0-9]{8}([A-Z0-9]{3})?$/);
  });

  it.each(MALAYSIAN_BANKS)("$swift has a non-empty display name", (bank) => {
    expect(bank.name.trim()).not.toBe("");
    expect(bank.name.length).toBeLessThanOrEqual(100);
  });

  it("has no duplicate SWIFT codes", () => {
    const codes = MALAYSIAN_BANKS.map((b) => b.swift);
    expect(new Set(codes).size).toBe(codes.length);
  });

  it("has no duplicate display names", () => {
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

describe("accountDigits", () => {
  it.each(MALAYSIAN_BANKS)(
    "$name's range fits chk_bank_account_number_digits (5 to 20)",
    (bank) => {
      const [min, max] = bank.accountDigits;
      expect(min).toBeGreaterThanOrEqual(5);
      expect(max).toBeLessThanOrEqual(20);
      expect(min).toBeLessThanOrEqual(max);
    },
  );

  it.each([
    ["MBBEMYKL", [12, 12]],
    ["CIBBMYKL", [10, 14]],
    ["PBBEMYKL", [10, 10]],
    ["RHBBMYKL", [14, 14]],
    ["HLBBMYKL", [11, 13]],
    ["BOTKMYKX", [6, 6]],
    ["SCBLMYKX", [5, 17]],
  ])("%s matches CHIP Send's supported-banks table", (swift, digits) => {
    expect(
      MALAYSIAN_BANKS.find((b) => b.swift === swift)?.accountDigits,
    ).toEqual(digits);
  });
});

describe("accountNumberLengthError", () => {
  it("accepts a number of the bank's length", () => {
    expect(accountNumberLengthError("MBBEMYKL", "514012345678")).toBeNull();
    expect(accountNumberLengthError("CIBBMYKL", "8000123456")).toBeNull();
    expect(accountNumberLengthError("CIBBMYKL", "80001234567890")).toBeNull();
  });

  it("names the one length a fixed-length bank expects", () => {
    expect(accountNumberLengthError("MBBEMYKL", "5140123456")).toBe(
      "Maybank account numbers have 12 digits",
    );
  });

  it("names the range a variable-length bank expects", () => {
    expect(accountNumberLengthError("CIBBMYKL", "800012345")).toBe(
      "CIMB Bank account numbers have 10 to 14 digits",
    );
  });

  it("leaves an unknown code to the bank-code check", () => {
    expect(accountNumberLengthError("NOTABANK", "1")).toBeNull();
  });
});
