// The banks an organizer can nominate as a payout destination, keyed by
// SWIFT/BIC — which is what CHIP Send's `bank_code` field takes.
//
// The pairing matters: the client submits only a SWIFT code, and the server
// derives the display name from this table before writing
// organization_bank_accounts.bank_name. A client-supplied display name could
// disagree with the code it was sent alongside, and the row would then say
// "Maybank" while the money went to CIMB.
//
// RECONCILED against CHIP Send's bank_code enum (2026-08-16):
//   https://docs.chip-in.asia/chip-send/api-reference/bank-accounts/create
// This list is a 1:1 mirror of that enum — same 34 codes, no more, no fewer.
// Mirroring rather than curating is deliberate: a code we accept that CHIP
// rejects is a FAILED PAYOUT (discovered after a tournament, with an organizer
// waiting on money), whereas a code CHIP accepts that we omit is only a bank
// missing from a dropdown. Every judgement call about which banks are
// "plausible" trades the cheap error for the expensive one, so we make none —
// which is why the corporate and custody banks below are kept even though no
// chess organizer is likely to nominate one.
//
// Do not add an entry without confirming it against CHIP's enum first — the
// unit test pins the exact set and will fail.
//
// Two CHIP-side details worth not "fixing" back:
//   - MBSB Bank is AFBQMYKL, the legacy Asian Finance Bank code CHIP still
//     keys it by, NOT the intuitive MBSBMYKL.
//   - Finexus Cards and Touch 'n Go eWallet are e-money issuers, not banks.
//     CHIP accepts them as destinations, so they stay; the field is labelled
//     "bank" in the UI, which is a slight misnomer for those two.
//
// Citibank (CITIMYKL) was in this list before the reconciliation and is NOT in
// CHIP's enum — it was a latent failed payout. Its Malaysian consumer business
// went to UOB in 2022 in any case.

export interface MalaysianBank {
  /** Display name stored on the bank account row. */
  name: string;
  /** SWIFT/BIC. 8 chars, or 11 with a branch suffix. */
  swift: string;
}

export const MALAYSIAN_BANKS: readonly MalaysianBank[] = [
  { name: "AEON Bank", swift: "ACDBMYK2" },
  { name: "Affin Bank", swift: "PHBMMYKL" },
  { name: "Agrobank", swift: "AGOBMYKL" },
  { name: "Al Rajhi Bank", swift: "RJHIMYKL" },
  { name: "Alliance Bank", swift: "MFBBMYKL" },
  { name: "AmBank", swift: "ARBKMYKL" },
  { name: "Bank Islam", swift: "BIMBMYKL" },
  { name: "Bank Muamalat", swift: "BMMBMYKL" },
  { name: "Bank of America (Malaysia)", swift: "BOFAMY2X" },
  { name: "Bank of China (Malaysia)", swift: "BKCHMYKL" },
  { name: "Bank of Tokyo-Mitsubishi UFJ (Malaysia)", swift: "BOTKMYKX" },
  { name: "Bank Rakyat", swift: "BKRMMYKL" },
  { name: "Bank Simpanan Nasional", swift: "BSNAMYK1" },
  { name: "BNP Paribas Malaysia", swift: "BNPAMYKL" },
  { name: "China Construction Bank (Malaysia)", swift: "PCBCMYKL" },
  { name: "CIMB Bank", swift: "CIBBMYKL" },
  { name: "Deutsche Bank (Malaysia)", swift: "DEUTMYKL" },
  { name: "Finexus Cards", swift: "FNXSMYNB" },
  { name: "GX Bank", swift: "GXSPMYKL" },
  { name: "Hong Leong Bank", swift: "HLBBMYKL" },
  { name: "HSBC Bank Malaysia", swift: "HBMBMYKL" },
  {
    name: "Industrial and Commercial Bank of China (Malaysia)",
    swift: "ICBKMYKL",
  },
  { name: "JP Morgan Chase Bank", swift: "CHASMYKX" },
  { name: "Kuwait Finance House", swift: "KFHOMYKL" },
  { name: "Maybank", swift: "MBBEMYKL" },
  { name: "MBSB Bank", swift: "AFBQMYKL" },
  { name: "Mizuho Bank (Malaysia)", swift: "MHCBMYKA" },
  { name: "OCBC Bank", swift: "OCBCMYKL" },
  { name: "Public Bank", swift: "PBBEMYKL" },
  { name: "RHB Bank", swift: "RHBBMYKL" },
  { name: "Standard Chartered Bank", swift: "SCBLMYKX" },
  { name: "Sumitomo Mitsui Banking Corporation (Malaysia)", swift: "SMBCMYKL" },
  { name: "Touch 'n Go eWallet", swift: "TNGDMYNB" },
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
