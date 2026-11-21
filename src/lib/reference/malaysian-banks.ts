export interface MalaysianBank {
  name: string;
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
  { name: "Bank Rakyat", swift: "BKRMMYKL" },
  { name: "Bank Simpanan Nasional", swift: "BSNAMYK1" },
  { name: "BNP Paribas Malaysia", swift: "BNPAMYKL" },
  { name: "Boost Bank", swift: "BOBEMYK2" },
  { name: "China Construction Bank (Malaysia)", swift: "PCBCMYKL" },
  { name: "CIMB Bank", swift: "CIBBMYKL" },
  { name: "Citibank", swift: "CITIMYKL" },
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
  { name: "MUFG Bank (Malaysia)", swift: "BOTKMYKX" },
  { name: "OCBC Bank", swift: "OCBCMYKL" },
  { name: "Public Bank", swift: "PBBEMYKL" },
  { name: "RHB Bank", swift: "RHBBMYKL" },
  { name: "RYT Bank", swift: "SCCHMYKL" },
  { name: "Standard Chartered Bank", swift: "SCBLMYKX" },
  { name: "Sumitomo Mitsui Banking Corporation (Malaysia)", swift: "SMBCMYKL" },
  { name: "Touch 'n Go eWallet", swift: "TNGDMYNB" },
  { name: "UOB Bank", swift: "UOVBMYKL" },
] as const;

export const BANK_SWIFT_CODES: ReadonlySet<string> = new Set(
  MALAYSIAN_BANKS.map((bank) => bank.swift),
);

export function bankNameForSwift(swift: string): string | undefined {
  return MALAYSIAN_BANKS.find((bank) => bank.swift === swift)?.name;
}
