export interface MalaysianBank {
  name: string;
  swift: string;
  accountDigits: readonly [min: number, max: number];
}

export const MALAYSIAN_BANKS: readonly MalaysianBank[] = [
  { name: "AEON Bank", swift: "ACDBMYK2", accountDigits: [13, 13] },
  { name: "Affin Bank", swift: "PHBMMYKL", accountDigits: [12, 12] },
  { name: "Agrobank", swift: "AGOBMYKL", accountDigits: [16, 16] },
  { name: "Al Rajhi Bank", swift: "RJHIMYKL", accountDigits: [15, 15] },
  { name: "Alliance Bank", swift: "MFBBMYKL", accountDigits: [15, 15] },
  { name: "AmBank", swift: "ARBKMYKL", accountDigits: [12, 13] },
  { name: "Bank Islam", swift: "BIMBMYKL", accountDigits: [13, 14] },
  { name: "Bank Muamalat", swift: "BMMBMYKL", accountDigits: [14, 14] },
  {
    name: "Bank of America (Malaysia)",
    swift: "BOFAMY2X",
    accountDigits: [5, 17],
  },
  {
    name: "Bank of China (Malaysia)",
    swift: "BKCHMYKL",
    accountDigits: [13, 15],
  },
  { name: "Bank Rakyat", swift: "BKRMMYKL", accountDigits: [10, 12] },
  {
    name: "Bank Simpanan Nasional",
    swift: "BSNAMYK1",
    accountDigits: [16, 16],
  },
  { name: "BNP Paribas Malaysia", swift: "BNPAMYKL", accountDigits: [6, 16] },
  { name: "Boost Bank", swift: "BOBEMYK2", accountDigits: [12, 15] },
  {
    name: "China Construction Bank (Malaysia)",
    swift: "PCBCMYKL",
    accountDigits: [12, 12],
  },
  { name: "CIMB Bank", swift: "CIBBMYKL", accountDigits: [10, 14] },
  { name: "Citibank", swift: "CITIMYKL", accountDigits: [9, 16] },
  {
    name: "Deutsche Bank (Malaysia)",
    swift: "DEUTMYKL",
    accountDigits: [10, 14],
  },
  { name: "Finexus Cards", swift: "FNXSMYNB", accountDigits: [8, 16] },
  { name: "GX Bank", swift: "GXSPMYKL", accountDigits: [11, 13] },
  { name: "Hong Leong Bank", swift: "HLBBMYKL", accountDigits: [11, 13] },
  { name: "HSBC Bank Malaysia", swift: "HBMBMYKL", accountDigits: [12, 12] },
  {
    name: "Industrial and Commercial Bank of China (Malaysia)",
    swift: "ICBKMYKL",
    accountDigits: [17, 17],
  },
  { name: "JP Morgan Chase Bank", swift: "CHASMYKX", accountDigits: [15, 17] },
  { name: "Kuwait Finance House", swift: "KFHOMYKL", accountDigits: [12, 12] },
  { name: "Maybank", swift: "MBBEMYKL", accountDigits: [12, 12] },
  { name: "MBSB Bank", swift: "AFBQMYKL", accountDigits: [16, 17] },
  {
    name: "Mizuho Bank (Malaysia)",
    swift: "MHCBMYKA",
    accountDigits: [10, 10],
  },
  { name: "MUFG Bank (Malaysia)", swift: "BOTKMYKX", accountDigits: [6, 6] },
  { name: "OCBC Bank", swift: "OCBCMYKL", accountDigits: [10, 10] },
  { name: "Public Bank", swift: "PBBEMYKL", accountDigits: [10, 10] },
  { name: "RHB Bank", swift: "RHBBMYKL", accountDigits: [14, 14] },
  { name: "RYT Bank", swift: "SCCHMYKL", accountDigits: [10, 10] },
  {
    name: "Standard Chartered Bank",
    swift: "SCBLMYKX",
    accountDigits: [5, 17],
  },
  {
    name: "Sumitomo Mitsui Banking Corporation (Malaysia)",
    swift: "SMBCMYKL",
    accountDigits: [8, 8],
  },
  { name: "Touch 'n Go eWallet", swift: "TNGDMYNB", accountDigits: [12, 12] },
  { name: "UOB Bank", swift: "UOVBMYKL", accountDigits: [10, 11] },
] as const;

export const BANK_SWIFT_CODES: ReadonlySet<string> = new Set(
  MALAYSIAN_BANKS.map((bank) => bank.swift),
);

export function bankNameForSwift(swift: string): string | undefined {
  return MALAYSIAN_BANKS.find((bank) => bank.swift === swift)?.name;
}

export function accountNumberLengthError(
  swift: string,
  accountNumber: string,
): string | null {
  const bank = MALAYSIAN_BANKS.find((b) => b.swift === swift);
  if (!bank) return null;
  const [min, max] = bank.accountDigits;
  const length = accountNumber.length;
  if (length >= min && length <= max) return null;
  const expected = min === max ? `${min}` : `${min} to ${max}`;
  return `${bank.name} account numbers have ${expected} digits`;
}
