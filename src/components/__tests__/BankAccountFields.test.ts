import { describe, expect, it } from "vitest";
import { validateBankAccount } from "../BankAccountFields";

const VALID = {
  bankName: "",
  bankCode: "MBBEMYKL",
  accountHolder: "KL Chess Association",
  accountNumber: "5140 1234-5678",
};

describe("validateBankAccount", () => {
  it("accepts a number of the chosen bank's length", () => {
    expect(validateBankAccount(VALID, { requireBankCode: true })).toBeNull();
  });

  it("rejects a number of the wrong length for the chosen bank", () => {
    expect(
      validateBankAccount(
        { ...VALID, accountNumber: "5140 1234-56" },
        { requireBankCode: true },
      ),
    ).toBe("Maybank account numbers have 12 digits.");
  });

  it("checks only the 5 to 20 digits when the bank is typed, not chosen", () => {
    expect(
      validateBankAccount(
        {
          ...VALID,
          bankName: "Maybank",
          bankCode: "",
          accountNumber: "51401234",
        },
        { requireBankCode: false },
      ),
    ).toBeNull();
  });
});
