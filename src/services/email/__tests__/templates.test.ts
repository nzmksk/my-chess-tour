import fs from "fs";
import path from "path";
import { describe, expect, it } from "vitest";
import { SUPPORT_EMAIL } from "@/lib/reference/contact";

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

    it("names only the shared support address", () => {
      const addresses = html.match(/[\w.+-]+@[\w-]+(\.[\w-]+)+/g) ?? [];
      for (const address of addresses) {
        expect(address).toBe(SUPPORT_EMAIL);
      }
    });
  });

  it.each([
    ["payout-request-rejected.html", "{{rejectionReason}}"],
    ["tournament-cancellation-rejected.html", "{{rejectionReason}}"],
    ["bank-account-verification-failed.html", "{{rejectionReason}}"],
    ["beneficiary-nomination.html", "{{dashboardUrl}}"],
    ["organizer-application-rejected.html", "{{rejectionReason}}"],
    ["oku-rejected.html", "{{rejectionReason}}"],
    ["registration-confirmed.html", "{{feePaid}}"],
    ["nomination-accepted.html", "{{nomineeName}}"],
    ["nomination-declined.html", "{{nomineeName}}"],
    ["prize-funding-request.html", "{{checkoutUrl}}"],
    ["prize-funding-request.html", "{{amount}}"],
    ["tournament-listed.html", "{{ctaUrl}}"],
    ["refund-completed.html", "{{amount}}"],
    ["refund-completed.html", "{{paymentMethod}}"],
    ["refund-failed.html", "{{amount}}"],
    ["refund-failed.html", "{{paymentMethod}}"],
    ["member-invitation.html", "{{invitationUrl}}"],
    ["member-invitation.html", "{{organizationName}}"],
    ["member-invitation.html", "{{recipientName}}"],
    ["invitation-accepted.html", "{{inviteeName}}"],
    ["invitation-accepted.html", "{{membersUrl}}"],
    ["invitation-declined.html", "{{inviteeName}}"],
    ["invitation-declined.html", "{{membersUrl}}"],
  ])("%s renders %s", (name, placeholder) => {
    expect(read(name)).toContain(placeholder);
  });
});
