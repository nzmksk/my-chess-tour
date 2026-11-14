import { beforeEach, describe, expect, it, vi } from "vitest";

// ---------------------------------------------------------------------------
// Mocks — must be hoisted so vi.mock factories can reference them
// ---------------------------------------------------------------------------

const { mockReadFileSync, mockSend } = vi.hoisted(() => ({
  mockReadFileSync: vi.fn(),
  mockSend: vi.fn(),
}));

vi.mock("fs", () => ({
  default: { readFileSync: mockReadFileSync },
  readFileSync: mockReadFileSync,
}));

vi.mock("resend", () => ({
  Resend: vi.fn(function () {
    return { emails: { send: mockSend } };
  }),
}));

import {
  sendAdminPayoutAlertEmail,
  sendBankVerificationEmail,
  sendBeneficiaryNominationEmail,
  sendCancellationReviewEmail,
  sendOrganizerApplicationReviewEmail,
  sendPasswordResetEmail,
  sendPayoutFailedEmail,
  sendPayoutProcessedEmail,
  sendPayoutReviewEmail,
  sendTournamentCancellationEmail,
  sendVerificationEmail,
} from "../email";

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("sendVerificationEmail", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockReadFileSync.mockReturnValue("<html>{{code}}</html>");
    mockSend.mockResolvedValue({ error: null });
  });

  // --- Template loading -----------------------------------------------------

  it("loads the verification.html template from the filesystem", async () => {
    await sendVerificationEmail("player@example.com", "ABC123");

    expect(mockReadFileSync).toHaveBeenCalledOnce();
    expect(mockReadFileSync).toHaveBeenCalledWith(
      expect.stringContaining("verification.html"),
      "utf-8",
    );
  });

  it("loads the template from the templates directory", async () => {
    await sendVerificationEmail("player@example.com", "ABC123");

    const [filePath] = mockReadFileSync.mock.calls[0];
    expect(filePath).toMatch(/templates/);
  });

  // --- Code injection -------------------------------------------------------

  it("injects the code into the template", async () => {
    await sendVerificationEmail("player@example.com", "ABC123");

    const { html } = mockSend.mock.calls[0][0];
    expect(html).toBe("<html>ABC123</html>");
  });

  it("removes the {{code}} placeholder from the sent HTML", async () => {
    await sendVerificationEmail("player@example.com", "ABC123");

    const { html } = mockSend.mock.calls[0][0];
    expect(html).not.toContain("{{code}}");
  });

  // --- Email fields ---------------------------------------------------------

  it("sends to the correct email address", async () => {
    await sendVerificationEmail("player@example.com", "ABC123");

    expect(mockSend).toHaveBeenCalledWith(
      expect.objectContaining({ to: "player@example.com" }),
    );
  });

  it("includes a subject line mentioning verification code", async () => {
    await sendVerificationEmail("player@example.com", "ABC123");

    const { subject } = mockSend.mock.calls[0][0];
    expect(subject).toMatch(/verification code/i);
  });

  // --- Error handling -------------------------------------------------------

  it("throws when Resend returns an error", async () => {
    mockSend.mockResolvedValue({ error: { message: "Sending failed" } });

    await expect(
      sendVerificationEmail("player@example.com", "ABC123"),
    ).rejects.toThrow(/sending failed/i);
  });

  it("resolves without a value when send succeeds", async () => {
    await expect(
      sendVerificationEmail("player@example.com", "ABC123"),
    ).resolves.toBeUndefined();
  });
});

describe("sendPasswordResetEmail", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockReadFileSync.mockReturnValue(
      '<html><a href="{{resetLink}}">reset</a>{{resetLink}}</html>',
    );
    mockSend.mockResolvedValue({ error: null });
  });

  // --- Template loading -----------------------------------------------------

  it("loads the reset-password.html template from the filesystem", async () => {
    await sendPasswordResetEmail(
      "player@example.com",
      "https://example.com/reset",
    );

    expect(mockReadFileSync).toHaveBeenCalledOnce();
    expect(mockReadFileSync).toHaveBeenCalledWith(
      expect.stringContaining("reset-password.html"),
      "utf-8",
    );
  });

  // --- Link injection -------------------------------------------------------

  it("replaces all {{resetLink}} placeholders with the actual link", async () => {
    const link = "https://example.com/reset?token=abc";
    await sendPasswordResetEmail("player@example.com", link);

    const { html } = mockSend.mock.calls[0][0];
    expect(html).not.toContain("{{resetLink}}");
    expect(html).toContain(link);
  });

  // --- Email fields ---------------------------------------------------------

  it("sends to the correct email address", async () => {
    await sendPasswordResetEmail(
      "player@example.com",
      "https://example.com/reset",
    );

    expect(mockSend).toHaveBeenCalledWith(
      expect.objectContaining({ to: "player@example.com" }),
    );
  });

  it("includes a subject mentioning reset (case-insensitive)", async () => {
    await sendPasswordResetEmail(
      "player@example.com",
      "https://example.com/reset",
    );

    const { subject } = mockSend.mock.calls[0][0];
    expect(subject).toMatch(/reset/i);
  });

  // --- Error handling -------------------------------------------------------

  it("throws when Resend returns an error", async () => {
    mockSend.mockResolvedValue({ error: { message: "Sending failed" } });

    await expect(
      sendPasswordResetEmail("player@example.com", "https://example.com/reset"),
    ).rejects.toThrow(/sending failed/i);
  });

  it("resolves without a value when send succeeds", async () => {
    await expect(
      sendPasswordResetEmail("player@example.com", "https://example.com/reset"),
    ).resolves.toBeUndefined();
  });
});

describe("sendTournamentCancellationEmail", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockReadFileSync.mockReturnValue(
      "<html>Dear {{playerName}}, {{tournamentName}} cancelled. " +
        '<a href="{{browseUrl}}">browse</a></html>',
    );
    mockSend.mockResolvedValue({ error: null });
    process.env.NEXT_PUBLIC_SITE_URL = "https://mychesstour.com";
  });

  // --- Template loading -----------------------------------------------------

  it("loads the tournament-cancellation.html template", async () => {
    await sendTournamentCancellationEmail("player@example.com", {
      playerName: "Ali",
      tournamentName: "KL Open 2026",
    });

    expect(mockReadFileSync).toHaveBeenCalledWith(
      expect.stringContaining("tournament-cancellation.html"),
      "utf-8",
    );
  });

  // --- Placeholder injection ------------------------------------------------

  it("injects player name, tournament name, and browse URL", async () => {
    await sendTournamentCancellationEmail("player@example.com", {
      playerName: "Ali",
      tournamentName: "KL Open 2026",
    });

    const { html } = mockSend.mock.calls[0][0];
    expect(html).toContain("Ali");
    expect(html).toContain("KL Open 2026");
    expect(html).toContain("https://mychesstour.com/tournaments");
    expect(html).not.toContain("{{playerName}}");
    expect(html).not.toContain("{{tournamentName}}");
    expect(html).not.toContain("{{browseUrl}}");
  });

  it("escapes HTML in user-supplied values to prevent injection", async () => {
    await sendTournamentCancellationEmail("player@example.com", {
      playerName: "<script>x</script>",
      tournamentName: "Rook & Roll <b>2026</b>",
    });

    const { html } = mockSend.mock.calls[0][0];
    expect(html).not.toContain("<script>");
    expect(html).toContain("&lt;script&gt;");
    expect(html).toContain("Rook &amp; Roll &lt;b&gt;2026&lt;/b&gt;");
  });

  // --- Email fields ---------------------------------------------------------

  it("sends to the correct email address", async () => {
    await sendTournamentCancellationEmail("player@example.com", {
      playerName: "Ali",
      tournamentName: "KL Open 2026",
    });

    expect(mockSend).toHaveBeenCalledWith(
      expect.objectContaining({ to: "player@example.com" }),
    );
  });

  it("includes the tournament name in the subject", async () => {
    await sendTournamentCancellationEmail("player@example.com", {
      playerName: "Ali",
      tournamentName: "KL Open 2026",
    });

    const { subject } = mockSend.mock.calls[0][0];
    expect(subject).toMatch(/KL Open 2026/);
    expect(subject).toMatch(/cancelled/i);
  });

  // --- Error handling -------------------------------------------------------

  it("throws when Resend returns an error", async () => {
    mockSend.mockResolvedValue({ error: { message: "Sending failed" } });

    await expect(
      sendTournamentCancellationEmail("player@example.com", {
        playerName: "Ali",
        tournamentName: "KL Open 2026",
      }),
    ).rejects.toThrow(/sending failed/i);
  });

  it("resolves without a value when send succeeds", async () => {
    await expect(
      sendTournamentCancellationEmail("player@example.com", {
        playerName: "Ali",
        tournamentName: "KL Open 2026",
      }),
    ).resolves.toBeUndefined();
  });
});

describe("sendCancellationReviewEmail", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockReadFileSync.mockReturnValue(
      "<html>Hi {{recipientName}}, {{tournamentName}} — {{rejectionReason}} " +
        '<a href="{{dashboardUrl}}">dashboard</a></html>',
    );
    mockSend.mockResolvedValue({ error: null });
    process.env.NEXT_PUBLIC_SITE_URL = "https://mychesstour.com";
  });

  // --- Template selection ---------------------------------------------------

  it("loads the approved template and subject when approved", async () => {
    await sendCancellationReviewEmail("owner@example.com", {
      recipientName: "Olivia",
      tournamentName: "KL Open 2026",
      approved: true,
    });

    expect(mockReadFileSync).toHaveBeenCalledWith(
      expect.stringContaining("tournament-cancellation-approved.html"),
      "utf-8",
    );
    const { subject } = mockSend.mock.calls[0][0];
    expect(subject).toMatch(/approved/i);
    expect(subject).toMatch(/KL Open 2026/);
  });

  it("loads the rejected template and subject when not approved", async () => {
    await sendCancellationReviewEmail("owner@example.com", {
      recipientName: "Olivia",
      tournamentName: "KL Open 2026",
      approved: false,
      rejectionReason: "Event is proceeding",
    });

    expect(mockReadFileSync).toHaveBeenCalledWith(
      expect.stringContaining("tournament-cancellation-rejected.html"),
      "utf-8",
    );
    const { subject } = mockSend.mock.calls[0][0];
    expect(subject).toMatch(/declined/i);
  });

  // --- Placeholder injection ------------------------------------------------

  it("injects recipient, tournament, dashboard URL, and rejection reason", async () => {
    await sendCancellationReviewEmail("owner@example.com", {
      recipientName: "Olivia",
      tournamentName: "KL Open 2026",
      approved: false,
      rejectionReason: "Event is proceeding",
    });

    const { html } = mockSend.mock.calls[0][0];
    expect(html).toContain("Olivia");
    expect(html).toContain("KL Open 2026");
    expect(html).toContain("Event is proceeding");
    expect(html).toContain("https://mychesstour.com/my/organizations");
    expect(html).not.toContain("{{recipientName}}");
    expect(html).not.toContain("{{rejectionReason}}");
    expect(html).not.toContain("{{dashboardUrl}}");
  });

  it("escapes HTML in user-supplied values", async () => {
    await sendCancellationReviewEmail("owner@example.com", {
      recipientName: "<b>O</b>",
      tournamentName: "Rook & Roll",
      approved: false,
      rejectionReason: "<script>x</script>",
    });

    const { html } = mockSend.mock.calls[0][0];
    expect(html).not.toContain("<script>");
    expect(html).toContain("&lt;script&gt;");
    expect(html).toContain("Rook &amp; Roll");
  });

  // --- Email fields ---------------------------------------------------------

  it("sends to the correct email address", async () => {
    await sendCancellationReviewEmail("owner@example.com", {
      recipientName: "Olivia",
      tournamentName: "KL Open 2026",
      approved: true,
    });

    expect(mockSend).toHaveBeenCalledWith(
      expect.objectContaining({ to: "owner@example.com" }),
    );
  });

  // --- Error handling -------------------------------------------------------

  it("throws when Resend returns an error", async () => {
    mockSend.mockResolvedValue({ error: { message: "Sending failed" } });

    await expect(
      sendCancellationReviewEmail("owner@example.com", {
        recipientName: "Olivia",
        tournamentName: "KL Open 2026",
        approved: true,
      }),
    ).rejects.toThrow(/sending failed/i);
  });

  it("resolves without a value when send succeeds", async () => {
    await expect(
      sendCancellationReviewEmail("owner@example.com", {
        recipientName: "Olivia",
        tournamentName: "KL Open 2026",
        approved: true,
      }),
    ).resolves.toBeUndefined();
  });
});

describe("sendBankVerificationEmail", () => {
  const base = {
    recipientName: "Olivia",
    orgName: "KL Chess Club",
    orgId: "11111111-1111-4111-8111-111111111111",
    bankName: "Maybank",
    accountLast4: "2229",
  };

  beforeEach(() => {
    vi.clearAllMocks();
    mockReadFileSync.mockReturnValue(
      "<html>Hi {{recipientName}}, {{orgName}} {{bankName}} *{{accountLast4}} " +
        '— {{rejectionReason}} <a href="{{settingsUrl}}">settings</a></html>',
    );
    mockSend.mockResolvedValue({ error: null });
    process.env.NEXT_PUBLIC_SITE_URL = "https://mychesstour.com";
  });

  it("uses the verified template and subject when verified", async () => {
    await sendBankVerificationEmail("owner@example.com", {
      ...base,
      verified: true,
    });

    expect(mockReadFileSync).toHaveBeenCalledWith(
      expect.stringContaining("bank-account-verified.html"),
      "utf-8",
    );
    const { subject, to } = mockSend.mock.calls[0][0];
    expect(to).toBe("owner@example.com");
    expect(subject).toMatch(/verified/i);
    expect(subject).toMatch(/KL Chess Club/);
  });

  it("uses the failed template with the reason when not verified", async () => {
    await sendBankVerificationEmail("owner@example.com", {
      ...base,
      verified: false,
      rejectionReason: "Name does not match",
    });

    expect(mockReadFileSync).toHaveBeenCalledWith(
      expect.stringContaining("bank-account-verification-failed.html"),
      "utf-8",
    );
    const { html, subject } = mockSend.mock.calls[0][0];
    expect(subject).toMatch(/couldn't verify/i);
    expect(html).toContain("Name does not match");
  });

  it("links to the organization's settings page", async () => {
    await sendBankVerificationEmail("owner@example.com", {
      ...base,
      verified: false,
    });
    const { html } = mockSend.mock.calls[0][0];
    expect(html).toContain(
      `https://mychesstour.com/my/organizations/${base.orgId}/settings`,
    );
  });

  it("renders at most the last 4 digits even if given a full number", async () => {
    await sendBankVerificationEmail("owner@example.com", {
      ...base,
      accountLast4: "157380112229",
      verified: true,
    });
    const { html } = mockSend.mock.calls[0][0];
    expect(html).toContain("*2229");
    expect(html).not.toContain("157380112229");
  });

  it("escapes user-supplied values", async () => {
    await sendBankVerificationEmail("owner@example.com", {
      ...base,
      orgName: "<script>x</script>",
      verified: false,
      rejectionReason: "<b>bad</b>",
    });
    const { html } = mockSend.mock.calls[0][0];
    expect(html).not.toContain("<script>");
    expect(html).toContain("&lt;b&gt;bad&lt;/b&gt;");
  });

  it("throws when Resend reports an error", async () => {
    mockSend.mockResolvedValue({ error: { message: "boom" } });
    vi.spyOn(console, "error").mockImplementation(() => {});
    await expect(
      sendBankVerificationEmail("owner@example.com", { ...base, verified: true }),
    ).rejects.toThrow(/boom/);
  });
});

describe("sendPayoutProcessedEmail", () => {
  const base = {
    recipientName: "Aisha",
    tournamentName: "KL Open",
    amountCents: 123450,
    accountLast4: "1234",
  };

  beforeEach(() => {
    vi.clearAllMocks();
    mockReadFileSync.mockReturnValue(
      "{{recipientName}}|{{tournamentName}}|{{amount}}|{{accountLast4}}|{{ctaUrl}}|{{ctaLabel}}|{{dashboardUrl}}",
    );
    mockSend.mockResolvedValue({ error: null });
  });

  const sentHtml = () => mockSend.mock.calls[0][0].html as string;

  it("loads the template and renders the amount in ringgit", async () => {
    await sendPayoutProcessedEmail("o@example.com", base);
    expect(mockReadFileSync).toHaveBeenCalledWith(
      expect.stringContaining("payout-processed.html"),
      "utf-8",
    );
    expect(sentHtml()).toContain("RM 1,234.50");
  });

  it("links to CHIP's receipt when there is a safe one", async () => {
    await sendPayoutProcessedEmail("o@example.com", {
      ...base,
      receiptUrl: "https://chip.test/receipt/1",
    });
    expect(sentHtml()).toContain("https://chip.test/receipt/1|View Receipt");
  });

  it.each([
    ["missing", null],
    ["not a URL", "nope"],
    ["not https", "javascript:alert(1)"],
  ])("falls back to the dashboard when the receipt is %s", async (_l, receiptUrl) => {
    await sendPayoutProcessedEmail("o@example.com", { ...base, receiptUrl });
    expect(sentHtml()).toContain("/my/organizations|View Payouts");
    expect(sentHtml()).not.toContain("javascript:");
  });

  it("never renders more than the last 4 digits", async () => {
    await sendPayoutProcessedEmail("o@example.com", {
      ...base,
      accountLast4: "514000001234",
    });
    expect(sentHtml()).toContain("|1234|");
    expect(sentHtml()).not.toContain("514000001234");
  });

  it("escapes the tournament name", async () => {
    await sendPayoutProcessedEmail("o@example.com", {
      ...base,
      tournamentName: "<b>Open</b>",
    });
    expect(sentHtml()).toContain("&lt;b&gt;Open&lt;/b&gt;");
  });

  it("uses a different subject for an early payout", async () => {
    await sendPayoutProcessedEmail("o@example.com", { ...base, early: true });
    expect(mockSend.mock.calls[0][0].subject).toMatch(/early payout/i);
  });

  it("throws when the send fails", async () => {
    mockSend.mockResolvedValue({ error: { message: "nope" } });
    vi.spyOn(console, "error").mockImplementation(() => {});
    await expect(sendPayoutProcessedEmail("o@example.com", base)).rejects.toThrow(
      /nope/,
    );
  });
});

describe("sendPayoutFailedEmail", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockReadFileSync.mockReturnValue(
      "{{recipientName}}|{{tournamentName}}|{{amount}}|{{failureReason}}|{{dashboardUrl}}",
    );
    mockSend.mockResolvedValue({ error: null });
  });

  it("renders the amount and the escaped reason", async () => {
    await sendPayoutFailedEmail("o@example.com", {
      recipientName: "Aisha",
      tournamentName: "KL Open",
      amountCents: 5000,
      failureReason: "Bank <said> no",
    });
    const html = mockSend.mock.calls[0][0].html as string;
    expect(mockReadFileSync).toHaveBeenCalledWith(
      expect.stringContaining("payout-failed.html"),
      "utf-8",
    );
    expect(html).toContain("RM 50.00");
    expect(html).toContain("Bank &lt;said&gt; no");
  });
});

describe("sendPayoutReviewEmail", () => {
  const base = {
    recipientName: "Aisha",
    tournamentName: "KL Open",
    amountCents: 250000,
  };

  beforeEach(() => {
    vi.clearAllMocks();
    mockReadFileSync.mockReturnValue(
      "{{recipientName}}|{{tournamentName}}|{{amount}}|{{dashboardUrl}}|{{rejectionReason}}",
    );
    mockSend.mockResolvedValue({ error: null });
  });

  const sent = () => mockSend.mock.calls[0][0] as { html: string; subject: string };

  it("uses the approved template and subject when approved", async () => {
    await sendPayoutReviewEmail("o@example.com", { ...base, approved: true });
    expect(mockReadFileSync).toHaveBeenCalledWith(
      expect.stringContaining("payout-request-approved.html"),
      "utf-8",
    );
    expect(sent().subject).toMatch(/early payout request for KL Open was approved/);
    expect(sent().html).toContain("RM 2,500.00");
  });

  it("uses the rejected template with the escaped reason when declined", async () => {
    await sendPayoutReviewEmail("o@example.com", {
      ...base,
      approved: false,
      rejectionReason: "Send <the> invoice",
    });
    expect(mockReadFileSync).toHaveBeenCalledWith(
      expect.stringContaining("payout-request-rejected.html"),
      "utf-8",
    );
    expect(sent().subject).toMatch(/was declined/);
    expect(sent().html).toContain("Send &lt;the&gt; invoice");
  });

  it("escapes the tournament name", async () => {
    await sendPayoutReviewEmail("o@example.com", {
      ...base,
      tournamentName: "<b>Open</b>",
      approved: true,
    });
    expect(sent().html).toContain("&lt;b&gt;Open&lt;/b&gt;");
  });

  it("throws when the send fails", async () => {
    mockSend.mockResolvedValue({ error: { message: "nope" } });
    vi.spyOn(console, "error").mockImplementation(() => {});
    await expect(
      sendPayoutReviewEmail("o@example.com", { ...base, approved: true }),
    ).rejects.toThrow(/nope/);
  });
});

describe("sendAdminPayoutAlertEmail", () => {
  const base = {
    recipientName: "Hafiz",
    tournamentName: "KL Open",
    organizationName: "KL Chess Club",
    amountCents: 400000,
    path: "/admin/payouts/abc",
  };

  beforeEach(() => {
    vi.clearAllMocks();
    mockReadFileSync.mockReturnValue(
      "{{headline}}|{{intro}}|{{recipientName}}|{{tournamentName}}|{{organizationName}}|{{amount}}|{{detail}}|{{ctaUrl}}|{{ctaLabel}}|{{siteUrl}}",
    );
    mockSend.mockResolvedValue({ error: null });
  });

  const sent = () => mockSend.mock.calls[0][0] as { html: string; subject: string };

  it("renders an early request alert linking to the review page", async () => {
    await sendAdminPayoutAlertEmail("admin@example.com", {
      ...base,
      alert: "early_request",
      detail: "Venue deposit",
    });
    expect(mockReadFileSync).toHaveBeenCalledWith(
      expect.stringContaining("admin-payout-alert.html"),
      "utf-8",
    );
    expect(sent().subject).toBe("Early payout request to review: KL Open");
    expect(sent().html).toContain("Early Payout Request|");
    expect(sent().html).toContain("RM 4,000.00");
    expect(sent().html).toContain("|Venue deposit|");
    expect(sent().html).toContain("/admin/payouts/abc|Review Request");
  });

  it("renders an awaiting-budget alert", async () => {
    await sendAdminPayoutAlertEmail("admin@example.com", {
      ...base,
      alert: "awaiting_budget",
      path: "/admin/payouts",
    });
    expect(sent().subject).toMatch(/CHIP Send budget/);
    expect(sent().html).toContain("Payout Awaiting Budget|");
    expect(sent().html).toContain("/admin/payouts|View Payouts");
  });

  it("escapes organizer-supplied values", async () => {
    await sendAdminPayoutAlertEmail("admin@example.com", {
      ...base,
      alert: "early_request",
      organizationName: "<i>Club</i>",
      detail: "<script>x</script>",
    });
    expect(sent().html).toContain("&lt;i&gt;Club&lt;/i&gt;");
    expect(sent().html).not.toContain("<script>");
  });
});

describe("sendBeneficiaryNominationEmail", () => {
  const base = {
    recipientName: "Siti",
    nomineeOrgId: "org/1",
    nomineeName: "Selangor Chess",
    organizerName: "KL Chess Club",
    tournamentName: "KL Open",
  };

  beforeEach(() => {
    vi.clearAllMocks();
    mockReadFileSync.mockReturnValue(
      "{{recipientName}}|{{nomineeName}}|{{organizerName}}|{{tournamentName}}|{{dashboardUrl}}",
    );
    mockSend.mockResolvedValue({ error: null });
  });

  const sent = () => mockSend.mock.calls[0][0] as { html: string; subject: string };

  it("links the nominee to its own dashboard", async () => {
    await sendBeneficiaryNominationEmail("n@example.com", base);
    expect(mockReadFileSync).toHaveBeenCalledWith(
      expect.stringContaining("beneficiary-nomination.html"),
      "utf-8",
    );
    expect(sent().html).toContain("/my/organizations/org%2F1");
    expect(sent().subject).toBe(
      "KL Chess Club nominated Selangor Chess to receive a tournament payout",
    );
  });

  it("escapes organization and tournament names", async () => {
    await sendBeneficiaryNominationEmail("n@example.com", {
      ...base,
      organizerName: "<b>Org</b>",
      tournamentName: "A & B",
    });
    expect(sent().html).toContain("&lt;b&gt;Org&lt;/b&gt;");
    expect(sent().html).toContain("A &amp; B");
  });
});

describe("sendOrganizerApplicationReviewEmail", () => {
  const base = {
    recipientName: "Aisha",
    organizationName: "KL Chess Club",
    orgId: "22222222-2222-2222-2222-222222222222",
  };

  beforeEach(() => {
    vi.clearAllMocks();
    mockReadFileSync.mockReturnValue(
      "{{recipientName}}|{{organizationName}}|{{dashboardUrl}}|{{applicationsUrl}}|{{siteUrl}}|{{rejectionReason}}",
    );
    mockSend.mockResolvedValue({ error: null });
  });

  const sent = () => mockSend.mock.calls[0][0] as { html: string; subject: string; to: string };

  it("uses the approved template, linking to the new organization's dashboard", async () => {
    await sendOrganizerApplicationReviewEmail("a@example.com", { ...base, approved: true });
    expect(mockReadFileSync).toHaveBeenCalledWith(
      expect.stringContaining("organizer-application-approved.html"),
      "utf-8",
    );
    expect(sent().to).toBe("a@example.com");
    expect(sent().subject).toBe("KL Chess Club is approved on MY Chess Tour");
    expect(sent().html).toContain(
      "/my/organizations/22222222-2222-2222-2222-222222222222|",
    );
  });

  it("uses the rejected template with the escaped reason and a link to reapply", async () => {
    await sendOrganizerApplicationReviewEmail("a@example.com", {
      ...base,
      approved: false,
      rejectionReason: "Attach the <SSM> certificate",
    });
    expect(mockReadFileSync).toHaveBeenCalledWith(
      expect.stringContaining("organizer-application-rejected.html"),
      "utf-8",
    );
    expect(sent().subject).toBe("Your application for KL Chess Club was declined");
    expect(sent().html).toContain("Attach the &lt;SSM&gt; certificate");
    expect(sent().html).toContain("/my/organizations/applications|");
  });

  it("escapes the applicant-supplied organization name", async () => {
    await sendOrganizerApplicationReviewEmail("a@example.com", {
      ...base,
      organizationName: "<b>Club</b>",
      approved: true,
    });
    expect(sent().html).toContain("&lt;b&gt;Club&lt;/b&gt;");
    expect(sent().html).not.toContain("<b>");
  });

  it("throws when the send fails", async () => {
    mockSend.mockResolvedValue({ error: { message: "nope" } });
    vi.spyOn(console, "error").mockImplementation(() => {});
    await expect(
      sendOrganizerApplicationReviewEmail("a@example.com", { ...base, approved: true }),
    ).rejects.toThrow(/nope/);
  });
});
