import fs from "fs";
import path from "path";
import { describe, expect, it } from "vitest";

// email.test.ts mocks the filesystem, so nothing there reads a real template.
// These checks read every template from disk and catch one that was cut short:
// a missing footer or an unclosed element still renders, just badly, and a
// placeholder that isn't in the template silently drops what the caller passed.

const TEMPLATES_DIR = path.join(process.cwd(), "src/services/email/templates");

const templates = fs
  .readdirSync(TEMPLATES_DIR)
  .filter((name) => name.endsWith(".html"))
  .sort();

function read(name: string): string {
  return fs.readFileSync(path.join(TEMPLATES_DIR, name), "utf-8");
}

function count(html: string, needle: string): number {
  return html.split(needle).length - 1;
}

describe("email templates", () => {
  it("finds the templates", () => {
    expect(templates.length).toBeGreaterThan(0);
  });

  describe.each(templates)("%s", (name) => {
    const html = read(name);

    it("is a complete document", () => {
      expect(html.trimEnd()).toMatch(/<\/html>$/);
      expect(html).toContain("</body>");
    });

    it("has a footer", () => {
      expect(html).toContain("<!-- Footer -->");
    });

    it("closes every div it opens", () => {
      expect(count(html, "</div>")).toBe(count(html, "<div"));
    });
  });

  // The placeholders a decline/rejection email exists to carry.
  it.each([
    ["payout-request-rejected.html", "{{rejectionReason}}"],
    ["tournament-cancellation-rejected.html", "{{rejectionReason}}"],
    ["bank-account-verification-failed.html", "{{rejectionReason}}"],
    ["beneficiary-nomination.html", "{{dashboardUrl}}"],
  ])("%s renders %s", (name, placeholder) => {
    expect(read(name)).toContain(placeholder);
  });
});
