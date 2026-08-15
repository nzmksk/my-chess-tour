// The banks an organizer can nominate as a payout destination, keyed by
// SWIFT/BIC — which is what CHIP Send's `bank_code` field takes.
//
// The pairing matters: the client submits only a SWIFT code, and the server
// derives the display name from this table before writing
// organization_bank_accounts.bank_name. A client-supplied display name could
// disagree with the code it was sent alongside, and the row would then say
// "Maybank" while the money went to CIMB.
//
// ⚠️ Reconcile against CHIP before Phase 4 (#519). CHIP Send accepts its own
// supported set of bank codes; a code accepted here but rejected there becomes
// a failed payout rather than a failed form — a much worse place to find out.
// The unit test can only assert shape, not that CHIP knows the code.

export interface MalaysianBank {
  /** Display name stored on the bank account row. */
  name: string;
  /** SWIFT/BIC. 8 chars, or 11 with a branch suffix. */
  swift: string;
}

export const MALAYSIAN_BANKS: readonly MalaysianBank[] = [
  { name: "Affin Bank", swift: "PHBMMYKL" },
  { name: "Agrobank", swift: "AGOBMYKL" },
  { name: "Al Rajhi Bank", swift: "RJHIMYKL" },
  { name: "Alliance Bank", swift: "MFBBMYKL" },
  { name: "AmBank", swift: "ARBKMYKL" },
  { name: "Bank Islam", swift: "BIMBMYKL" },
  { name: "Bank Muamalat", swift: "BMMBMYKL" },
  { name: "Bank of China (Malaysia)", swift: "BKCHMYKL" },
  { name: "Bank Rakyat", swift: "BKRMMYKL" },
  { name: "Bank Simpanan Nasional", swift: "BSNAMYK1" },
  { name: "CIMB Bank", swift: "CIBBMYKL" },
  { name: "Citibank", swift: "CITIMYKL" },
  { name: "Hong Leong Bank", swift: "HLBBMYKL" },
  { name: "HSBC Bank Malaysia", swift: "HBMBMYKL" },
  { name: "Kuwait Finance House", swift: "KFHOMYKL" },
  { name: "Maybank", swift: "MBBEMYKL" },
  { name: "MBSB Bank", swift: "MBSBMYKL" },
  { name: "OCBC Bank", swift: "OCBCMYKL" },
  { name: "Public Bank", swift: "PBBEMYKL" },
  { name: "RHB Bank", swift: "RHBBMYKL" },
  { name: "Standard Chartered Bank", swift: "SCBLMYKX" },
  { name: "UOB Bank", swift: "UOVBMYKL" },
] as const;

/** Membership test for validators — O(1) instead of scanning the array. */
export const BANK_SWIFT_CODES: ReadonlySet<string> = new Set(
  MALAYSIAN_BANKS.map((bank) => bank.swift),
);

/**
 * The display name for a SWIFT code, or `undefined` if it isn't one we accept.
 *
 * Callers persisting a bank account must treat `undefined` as a validation
 * failure rather than falling back to the submitted code: an unknown code is
 * one CHIP Send will not recognise either.
 */
export function bankNameForSwift(swift: string): string | undefined {
  return MALAYSIAN_BANKS.find((bank) => bank.swift === swift)?.name;
}
