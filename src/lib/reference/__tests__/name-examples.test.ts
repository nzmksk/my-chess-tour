import { describe, expect, it } from "vitest";
import { NAME_GROUPS } from "../name-examples";
import { NAME_PATTERN } from "@/services/auth/auth-validation";

const examples = NAME_GROUPS.flatMap((g) => g.examples);

const CONNECTORS = ["BIN", "BINTI", "BT", "A/L", "A/P", "S/O", "D/O", "ANAK"];

const words = (name: string) => name.trim().toUpperCase().split(/\s+/);

describe("NAME_GROUPS", () => {
  it("covers Malay, Chinese, Indian and other names", () => {
    expect(NAME_GROUPS.map((g) => g.heading)).toEqual([
      "Malay names",
      "Chinese names",
      "Indian names",
      "Other names",
    ]);
    for (const group of NAME_GROUPS) {
      expect(group.examples.length).toBeGreaterThan(0);
    }
  });

  it.each(examples)(
    "suggests $firstName / $lastName, which sign-up accepts",
    ({ firstName, lastName }) => {
      expect(NAME_PATTERN.test(firstName)).toBe(true);
      expect(NAME_PATTERN.test(lastName)).toBe(true);
    },
  );

  it.each(examples)(
    "leaves bin, binti, a/l, a/p and anak out of $firstName / $lastName",
    ({ firstName, lastName }) => {
      for (const word of words(`${firstName} ${lastName}`)) {
        expect(CONNECTORS).not.toContain(word);
      }
    },
  );

  it("keeps every other word of the ID name", () => {
    for (const { onId, firstName, lastName } of examples) {
      const idWords = words(onId.replace(/\(.*\)/, "")).filter(
        (w) => !CONNECTORS.includes(w),
      );
      const enteredWords = words(`${firstName} ${lastName}`);
      expect(enteredWords.toSorted()).toEqual(idWords.toSorted());
    }
  });
});
