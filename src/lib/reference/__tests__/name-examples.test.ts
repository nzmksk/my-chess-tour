import { describe, expect, it } from "vitest";
import { NAME_GROUPS } from "../name-examples";
import { NAME_PATTERN } from "@/services/auth/auth-validation";

const examples = NAME_GROUPS.flatMap((g) => g.examples);

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

  it("keeps every word of the ID name", () => {
    for (const { onId, firstName, lastName } of examples) {
      const idWords = onId
        .replace(/\(.*\)/, "")
        .trim()
        .toUpperCase()
        .split(/\s+/);
      const enteredWords = `${firstName} ${lastName}`
        .toUpperCase()
        .split(/\s+/);
      expect(enteredWords.toSorted()).toEqual(idWords.toSorted());
    }
  });
});
