import fs from "fs";
import path from "path";
import { describe, expect, it } from "vitest";
import { loadTemplate } from "../template-source";

const TEMPLATES_DIR = path.join(process.cwd(), "src/services/email/templates");

const names = fs
  .readdirSync(TEMPLATES_DIR)
  .filter((name) => name.endsWith(".html"))
  .sort();

describe("loadTemplate", () => {
  it.each(names)("bundles %s with the same contents as the file", (name) => {
    expect(loadTemplate(name)).toBe(
      fs.readFileSync(path.join(TEMPLATES_DIR, name), "utf-8"),
    );
  });

  it("throws for a template that does not exist", () => {
    expect(() => loadTemplate("does-not-exist.html")).toThrow(
      "Unknown email template: does-not-exist.html",
    );
  });
});
