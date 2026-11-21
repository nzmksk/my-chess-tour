import { describe, expect, it } from "vitest";
import {
  checkHolderName,
  holderNamesMatch,
  normalizeHolderName,
} from "../holder-name";

describe("normalizeHolderName", () => {
  it("uppercases, strips accents and punctuation, and collapses whitespace", () => {
    expect(normalizeHolderName("  Zoë   O'Brien-Smith ")).toBe(
      "ZOE O BRIEN SMITH",
    );
  });

  it("writes company suffixes one way", () => {
    expect(normalizeHolderName("Catur Hebat Sdn. Bhd.")).toBe(
      "CATUR HEBAT SDN BHD",
    );
    expect(normalizeHolderName("CATUR HEBAT SENDIRIAN BERHAD")).toBe(
      "CATUR HEBAT SDN BHD",
    );
    expect(normalizeHolderName("Catur Hebat S/B")).toBe("CATUR HEBAT SDN BHD");
    expect(normalizeHolderName("Catur Hebat Enterprises")).toBe(
      "CATUR HEBAT ENT",
    );
  });

  it("drops Malay and Indian patronymic connectors", () => {
    expect(normalizeHolderName("Ahmad bin Ali")).toBe("AHMAD ALI");
    expect(normalizeHolderName("Siti Binti Abu")).toBe("SITI ABU");
    expect(normalizeHolderName("Nurul Bt. Hassan")).toBe("NURUL HASSAN");
    expect(normalizeHolderName("Ravi A/L Muthu")).toBe("RAVI MUTHU");
    expect(normalizeHolderName("Devi a/p Raju")).toBe("DEVI RAJU");
    expect(normalizeHolderName("Kumar S/O Rajan")).toBe("KUMAR RAJAN");
  });

  it("drops honorifics, including two-word titles, but keeps the surname Tan", () => {
    expect(normalizeHolderName("Dato' Haji Ismail")).toBe("ISMAIL");
    expect(normalizeHolderName("Tan Sri Lim Kok Wing")).toBe("LIM KOK WING");
    expect(normalizeHolderName("Tan Ah Kow")).toBe("TAN AH KOW");
    expect(normalizeHolderName("Dr. Mrs. Wong")).toBe("WONG");
  });

  it("expands common abbreviations of Muhammad and Abdul", () => {
    expect(normalizeHolderName("Mohd Faiz")).toBe("MUHAMMAD FAIZ");
    expect(normalizeHolderName("Mohamad Faiz")).toBe("MUHAMMAD FAIZ");
    expect(normalizeHolderName("Abd Rahman")).toBe("ABDUL RAHMAN");
  });

  it("writes & as AND", () => {
    expect(normalizeHolderName("Lim & Sons")).toBe("LIM AND SONS");
  });
});

describe("holderNamesMatch", () => {
  it.each([
    ["AHMAD BIN ALI", "Ahmad bin Ali"],
    ["AHMAD B ALI", "Ahmad bin Ali"],
    ["MOHD FAIZ BIN ABD RAHMAN", "Muhammad Faiz Abdul Rahman"],
    ["CATUR HEBAT SDN BHD", "Catur Hebat Sdn. Bhd."],
    ["PERSATUAN CATUR SELANGOR", "Persatuan  Catur  Selangor"],
    ["RAVI A/L MUTHU", "Ravi Muthu"],
    ["ABDULRAHMAN ISMAIL", "Abdul Rahman Ismail"],
    ["AH KOW TAN", "Tan Ah Kow"],
    ["DATO HAJI ISMAIL BIN OMAR", "Ismail bin Omar"],
  ])("matches %s with %s", (bank, expected) => {
    expect(holderNamesMatch(bank, expected)).toBe(true);
  });

  it.each([
    ["SITI AMINAH BINTI ABU", "Ahmad bin Ali"],
    ["AHMAD BIN ALI", "Ahmad bin Abu"],
    ["CATUR HEBAT ENTERPRISE", "Catur Hebat Sdn Bhd"],
    ["CATUR HEBAT", "Catur Hebat Sdn Bhd"],
    ["LIM KOK", "Lim Kok Wing"],
  ])("does not match %s with %s", (bank, expected) => {
    expect(holderNamesMatch(bank, expected)).toBe(false);
  });

  it("accepts a long bank name the bank truncated", () => {
    expect(
      holderNamesMatch(
        "PERSATUAN CATUR NEGERI SEMBIL",
        "Persatuan Catur Negeri Sembilan Darul Khusus",
      ),
    ).toBe(true);
  });

  it("does not treat a short prefix as truncation", () => {
    expect(
      holderNamesMatch("MUHAMMAD HAFIZ", "Muhammad Hafiz bin Abdullah"),
    ).toBe(false);
  });

  it("does not accept an expected name that is only a prefix of the bank's", () => {
    expect(
      holderNamesMatch(
        "PERSATUAN CATUR NEGERI SEMBILAN DARUL KHUSUS",
        "Persatuan Catur Negeri Sembil",
      ),
    ).toBe(false);
  });

  it.each([
    [null, "Ahmad"],
    ["AHMAD", null],
    ["", "Ahmad"],
    ["AHMAD", "   "],
    ["BIN", "Binti"],
  ])("never matches a missing or empty name (%s, %s)", (bank, expected) => {
    expect(holderNamesMatch(bank, expected)).toBe(false);
  });
});

describe("checkHolderName", () => {
  it("reports a name CHIP never returned as not recorded", () => {
    expect(checkHolderName(null, "Ahmad")).toBe("not_recorded");
    expect(checkHolderName("  ", "Ahmad")).toBe("not_recorded");
  });

  it("reports whether a returned name matches", () => {
    expect(checkHolderName("AHMAD BIN ALI", "Ahmad Ali")).toBe("match");
    expect(checkHolderName("SITI", "Ahmad Ali")).toBe("mismatch");
  });
});
