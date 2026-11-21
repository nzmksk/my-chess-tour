const TRUNCATED_MIN_LENGTH = 20;

const SYNONYMS: Record<string, string> = {
  SENDIRIAN: "SDN",
  BERHAD: "BHD",
  ENTERPRISE: "ENT",
  ENTERPRISES: "ENT",
  MOHD: "MUHAMMAD",
  MUHD: "MUHAMMAD",
  MD: "MUHAMMAD",
  MOHAMAD: "MUHAMMAD",
  MOHAMMAD: "MUHAMMAD",
  MOHAMED: "MUHAMMAD",
  MOHAMMED: "MUHAMMAD",
  MUHAMAD: "MUHAMMAD",
  ABD: "ABDUL",
};

const DROPPED = new Set([
  "BIN",
  "BINTI",
  "BINTE",
  "BTE",
  "BT",
  "B",
  "AL",
  "AP",
  "MR",
  "MRS",
  "MS",
  "MISS",
  "MDM",
  "MADAM",
  "DR",
  "ENCIK",
  "EN",
  "CIK",
  "PUAN",
  "TUAN",
  "DATO",
  "DATUK",
  "DATIN",
  "HAJI",
  "HJ",
  "HAJAH",
  "HJH",
]);

const PAIRED_TITLES = new Set(["TAN SRI", "PUAN SRI"]);

function tokens(name: string): string[] {
  const words = name
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toUpperCase()
    .replace(/\bS\s*\/\s*B\b/g, " SDN BHD ")
    .replace(/\b[ASD]\s*\/\s*[LPO]\b/g, " ")
    .replace(/&/g, " AND ")
    .replace(/[^A-Z0-9]+/g, " ")
    .trim()
    .split(" ")
    .filter(Boolean);

  const out: string[] = [];
  for (let i = 0; i < words.length; i++) {
    if (PAIRED_TITLES.has(`${words[i]} ${words[i + 1]}`)) {
      i++;
      continue;
    }
    const word = SYNONYMS[words[i]] ?? words[i];
    if (!DROPPED.has(word)) out.push(word);
  }
  return out;
}

export function normalizeHolderName(name: string): string {
  return tokens(name).join(" ");
}

export function holderNamesMatch(
  bankName: string | null | undefined,
  expectedName: string | null | undefined,
): boolean {
  if (!bankName?.trim() || !expectedName?.trim()) return false;

  const bank = tokens(bankName);
  const expected = tokens(expectedName);
  if (bank.length === 0 || expected.length === 0) return false;

  const bankCompact = bank.join("");
  const expectedCompact = expected.join("");
  if (bankCompact === expectedCompact) return true;

  if ([...bank].sort().join(" ") === [...expected].sort().join(" "))
    return true;

  const bankLength = bankName.trim().replace(/\s+/g, " ").length;
  return (
    bankLength >= TRUNCATED_MIN_LENGTH &&
    expectedCompact.startsWith(bankCompact)
  );
}

export type HolderNameCheck = "match" | "mismatch" | "not_recorded";

export function checkHolderName(
  bankName: string | null | undefined,
  expectedName: string | null | undefined,
): HolderNameCheck {
  if (!bankName?.trim()) return "not_recorded";
  return holderNamesMatch(bankName, expectedName) ? "match" : "mismatch";
}
