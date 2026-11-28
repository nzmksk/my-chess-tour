import { beforeEach, describe, expect, it, vi } from "vitest";

const { mockLoadTemplate, mockSend } = vi.hoisted(() => ({
  mockLoadTemplate: vi.fn(),
  mockSend: vi.fn(),
}));

vi.mock("../template-source", () => ({
  loadTemplate: mockLoadTemplate,
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
  sendHelperInvitationEmail,
  sendAccountClaimEmail,
  sendGuardianshipAgeOutEmail,
  sendInvitationResponseEmail,
  sendMemberInvitationEmail,
  sendNominationResponseEmail,
  sendOkuReviewEmail,
  sendOrganizerApplicationReviewEmail,
  sendPasswordResetEmail,
  sendPayoutFailedEmail,
  sendPayoutProcessedEmail,
  sendPayoutReviewEmail,
  sendPrizeAwardedEmail,
  sendPrizePaidEmail,
  sendPrizeFundingRequestEmail,
  sendTournamentListedEmail,
  sendRefundOutcomeEmail,
  sendRegistrationConfirmationEmail,
  sendTournamentCancellationEmail,
  sendVerificationEmail,
} from "../email";

describe("sendVerificationEmail", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockLoadTemplate.mockReturnValue("<html>{{code}}</html>");
    mockSend.mockResolvedValue({ error: null });
  });

  it("loads the verification.html template", async () => {
    await sendVerificationEmail("player@example.com", "ABC123");

    expect(mockLoadTemplate).toHaveBeenCalledOnce();
    expect(mockLoadTemplate).toHaveBeenCalledWith("verification.html");
  });

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
    mockLoadTemplate.mockReturnValue(
      '<html><a href="{{resetLink}}">reset</a>{{resetLink}}</html>',
    );
    mockSend.mockResolvedValue({ error: null });
  });

  it("loads the reset-password.html template", async () => {
    await sendPasswordResetEmail(
      "player@example.com",
      "https://example.com/reset",
    );

    expect(mockLoadTemplate).toHaveBeenCalledOnce();
    expect(mockLoadTemplate).toHaveBeenCalledWith("reset-password.html");
  });

  it("replaces all {{resetLink}} placeholders with the actual link", async () => {
    const link = "https://example.com/reset?token=abc";
    await sendPasswordResetEmail("player@example.com", link);

    const { html } = mockSend.mock.calls[0][0];
    expect(html).not.toContain("{{resetLink}}");
    expect(html).toContain(link);
  });

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
  it("names the dependent to a guardian (#716)", async () => {
    await sendTournamentCancellationEmail("g@example.com", {
      recipientName: "Siti",
      tournamentName: "KL Open 2026",
      aboutPlayer: "Aina Rahman",
    });

    const { html, subject } = mockSend.mock.calls[0][0];
    expect(subject).toBe("KL Open 2026, which Aina Rahman entered, has been cancelled");
    expect(html).toContain("Dear Siti,");
    expect(html).toContain("let you know that Aina Rahman&#39;s tournament KL Open 2026");
    expect(html).toContain("because Aina Rahman was registered for");
  });

  beforeEach(() => {
    vi.clearAllMocks();
    mockLoadTemplate.mockReturnValue(
      "<html>Dear {{recipientName}}, {{lead}} {{tournamentName}} cancelled. " +
        '<a href="{{browseUrl}}">browse</a> {{footerReason}}</html>',
    );
    mockSend.mockResolvedValue({ error: null });
    process.env.NEXT_PUBLIC_SITE_URL = "https://mychesstour.com";
  });

  it("loads the tournament-cancellation.html template", async () => {
    await sendTournamentCancellationEmail("player@example.com", {
      recipientName: "Ali",
      tournamentName: "KL Open 2026",
    });

    expect(mockLoadTemplate).toHaveBeenCalledWith("tournament-cancellation.html");
  });

  it("injects player name, tournament name, and browse URL", async () => {
    await sendTournamentCancellationEmail("player@example.com", {
      recipientName: "Ali",
      tournamentName: "KL Open 2026",
    });

    const { html } = mockSend.mock.calls[0][0];
    expect(html).toContain("Ali");
    expect(html).toContain("KL Open 2026");
    expect(html).toContain('href="https://mychesstour.com/"');
    expect(html).not.toContain("{{recipientName}}");
    expect(html).not.toContain("{{tournamentName}}");
    expect(html).not.toContain("{{browseUrl}}");
  });

  it("escapes HTML in user-supplied values to prevent injection", async () => {
    await sendTournamentCancellationEmail("player@example.com", {
      recipientName: "<script>x</script>",
      tournamentName: "Rook & Roll <b>2026</b>",
    });

    const { html } = mockSend.mock.calls[0][0];
    expect(html).not.toContain("<script>");
    expect(html).toContain("&lt;script&gt;");
    expect(html).toContain("Rook &amp; Roll &lt;b&gt;2026&lt;/b&gt;");
  });

  it("sends to the correct email address", async () => {
    await sendTournamentCancellationEmail("player@example.com", {
      recipientName: "Ali",
      tournamentName: "KL Open 2026",
    });

    expect(mockSend).toHaveBeenCalledWith(
      expect.objectContaining({ to: "player@example.com" }),
    );
  });

  it("includes the tournament name in the subject", async () => {
    await sendTournamentCancellationEmail("player@example.com", {
      recipientName: "Ali",
      tournamentName: "KL Open 2026",
    });

    const { subject } = mockSend.mock.calls[0][0];
    expect(subject).toMatch(/KL Open 2026/);
    expect(subject).toMatch(/cancelled/i);
  });

  it("throws when Resend returns an error", async () => {
    mockSend.mockResolvedValue({ error: { message: "Sending failed" } });

    await expect(
      sendTournamentCancellationEmail("player@example.com", {
        recipientName: "Ali",
        tournamentName: "KL Open 2026",
      }),
    ).rejects.toThrow(/sending failed/i);
  });

  it("resolves without a value when send succeeds", async () => {
    await expect(
      sendTournamentCancellationEmail("player@example.com", {
        recipientName: "Ali",
        tournamentName: "KL Open 2026",
      }),
    ).resolves.toBeUndefined();
  });
});

describe("sendCancellationReviewEmail", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockLoadTemplate.mockReturnValue(
      "<html>Hi {{recipientName}}, {{tournamentName}} — {{rejectionReason}} " +
        '<a href="{{dashboardUrl}}">dashboard</a></html>',
    );
    mockSend.mockResolvedValue({ error: null });
    process.env.NEXT_PUBLIC_SITE_URL = "https://mychesstour.com";
  });

  it("loads the approved template and subject when approved", async () => {
    await sendCancellationReviewEmail("owner@example.com", {
      recipientName: "Olivia",
      tournamentName: "KL Open 2026",
      approved: true,
    });

    expect(mockLoadTemplate).toHaveBeenCalledWith("tournament-cancellation-approved.html");
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

    expect(mockLoadTemplate).toHaveBeenCalledWith("tournament-cancellation-rejected.html");
    const { subject } = mockSend.mock.calls[0][0];
    expect(subject).toMatch(/declined/i);
  });

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
    mockLoadTemplate.mockReturnValue(
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

    expect(mockLoadTemplate).toHaveBeenCalledWith("bank-account-verified.html");
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

    expect(mockLoadTemplate).toHaveBeenCalledWith("bank-account-verification-failed.html");
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
    mockLoadTemplate.mockReturnValue(
      "{{recipientName}}|{{tournamentName}}|{{amount}}|{{accountLast4}}|{{ctaUrl}}|{{ctaLabel}}|{{dashboardUrl}}",
    );
    mockSend.mockResolvedValue({ error: null });
  });

  const sentHtml = () => mockSend.mock.calls[0][0].html as string;

  it("loads the template and renders the amount in ringgit", async () => {
    await sendPayoutProcessedEmail("o@example.com", base);
    expect(mockLoadTemplate).toHaveBeenCalledWith("payout-processed.html");
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
    mockLoadTemplate.mockReturnValue(
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
    expect(mockLoadTemplate).toHaveBeenCalledWith("payout-failed.html");
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
    mockLoadTemplate.mockReturnValue(
      "{{recipientName}}|{{tournamentName}}|{{amount}}|{{dashboardUrl}}|{{rejectionReason}}",
    );
    mockSend.mockResolvedValue({ error: null });
  });

  const sent = () => mockSend.mock.calls[0][0] as { html: string; subject: string };

  it("uses the approved template and subject when approved", async () => {
    await sendPayoutReviewEmail("o@example.com", { ...base, approved: true });
    expect(mockLoadTemplate).toHaveBeenCalledWith("payout-request-approved.html");
    expect(sent().subject).toMatch(/early payout request for KL Open was approved/);
    expect(sent().html).toContain("RM 2,500.00");
  });

  it("uses the rejected template with the escaped reason when declined", async () => {
    await sendPayoutReviewEmail("o@example.com", {
      ...base,
      approved: false,
      rejectionReason: "Send <the> invoice",
    });
    expect(mockLoadTemplate).toHaveBeenCalledWith("payout-request-rejected.html");
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
    mockLoadTemplate.mockReturnValue(
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
    expect(mockLoadTemplate).toHaveBeenCalledWith("admin-payout-alert.html");
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
    mockLoadTemplate.mockReturnValue(
      "{{recipientName}}|{{nomineeName}}|{{organizerName}}|{{tournamentName}}|{{dashboardUrl}}",
    );
    mockSend.mockResolvedValue({ error: null });
  });

  const sent = () => mockSend.mock.calls[0][0] as { html: string; subject: string };

  it("links the nominee to its own dashboard", async () => {
    await sendBeneficiaryNominationEmail("n@example.com", base);
    expect(mockLoadTemplate).toHaveBeenCalledWith("beneficiary-nomination.html");
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
    mockLoadTemplate.mockReturnValue(
      "{{recipientName}}|{{organizationName}}|{{dashboardUrl}}|{{applicationsUrl}}|{{siteUrl}}|{{rejectionReason}}",
    );
    mockSend.mockResolvedValue({ error: null });
  });

  const sent = () => mockSend.mock.calls[0][0] as { html: string; subject: string; to: string };

  it("uses the approved template, linking to the new organization's dashboard", async () => {
    await sendOrganizerApplicationReviewEmail("a@example.com", { ...base, approved: true });
    expect(mockLoadTemplate).toHaveBeenCalledWith("organizer-application-approved.html");
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
    expect(mockLoadTemplate).toHaveBeenCalledWith("organizer-application-rejected.html");
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

describe("sendOkuReviewEmail", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockLoadTemplate.mockReturnValue(
      "{{recipientName}}|{{settingsUrl}}|{{browseUrl}}|{{rejectionReason}}|{{lead}}|{{retryLine}}|{{footerReason}}|{{ctaUrl}}|{{ctaLabel}}",
    );
    mockSend.mockResolvedValue({ error: null });
  });

  const sent = () => mockSend.mock.calls[0][0] as { html: string; subject: string; to: string };

  it("uses the verified template", async () => {
    await sendOkuReviewEmail("p@example.com", { recipientName: "Farid", verified: true });
    expect(mockLoadTemplate).toHaveBeenCalledWith("oku-verified.html");
    expect(sent().to).toBe("p@example.com");
    expect(sent().subject).toBe("Your OKU status is verified");
    expect(sent().html).toContain("Farid|");
    expect(sent().html).toMatch(/\/settings\|https?:\/\/[^|/]+\/\|/);
  });

  it("uses the rejected template with the escaped reason and a link to settings", async () => {
    await sendOkuReviewEmail("p@example.com", {
      recipientName: "Farid",
      verified: false,
      rejectionReason: "Card <expired>",
    });
    expect(mockLoadTemplate).toHaveBeenCalledWith("oku-rejected.html");
    expect(sent().subject).toBe("We couldn't verify your OKU card");
    expect(sent().html).toContain("Card &lt;expired&gt;");
    expect(sent().html).toContain("/settings|");
  });

  it("escapes the player's name", async () => {
    await sendOkuReviewEmail("p@example.com", { recipientName: "<i>F</i>", verified: true });
    expect(sent().html).toContain("&lt;i&gt;F&lt;/i&gt;");
  });

  it("names the dependent to a guardian when verified (#716)", async () => {
    await sendOkuReviewEmail("g@example.com", {
      recipientName: "Siti",
      verified: true,
      aboutPlayer: "Aina Rahman",
    });
    expect(sent().subject).toBe("Aina Rahman's OKU status is verified");
    expect(sent().html).toContain(
      "We have checked Aina Rahman&#39;s OKU card, and their OKU status is now verified.",
    );
    expect(sent().html).toContain("an OKU card for Aina Rahman was submitted");
  });

  it("names the dependent to a guardian when rejected (#716)", async () => {
    await sendOkuReviewEmail("g@example.com", {
      recipientName: "Siti",
      verified: false,
      rejectionReason: "Blurry",
      aboutPlayer: "Aina Rahman",
    });
    expect(sent().subject).toBe("We couldn't verify Aina Rahman's OKU card");
    expect(sent().html).toContain("We were unable to verify Aina Rahman&#39;s OKU card.");
    expect(sent().html).toContain(
      "To send a new copy of Aina Rahman&#39;s card, email support@mychesstour.com",
    );
    expect(sent().html).toContain("|mailto:support@mychesstour.com|Contact Support");
  });

  it("sends the player to Settings to upload again", async () => {
    await sendOkuReviewEmail("p@example.com", {
      recipientName: "Farid",
      verified: false,
      rejectionReason: "Blurry",
    });
    expect(sent().html).toContain("from your settings");
    expect(sent().html).toMatch(/\|https?:\/\/[^|]+\/settings\|Upload Again$/);
  });

  it("sends a player who can't sign in to support instead (#716)", async () => {
    await sendOkuReviewEmail("b@example.com", {
      recipientName: "Badrul",
      verified: false,
      rejectionReason: "Blurry",
      canActInSettings: false,
    });
    expect(sent().subject).toBe("We couldn't verify your OKU card");
    expect(sent().html).toContain("To send a new copy of your card, email support@mychesstour.com");
    expect(sent().html).not.toContain("from your settings");
  });

  it("throws when the send fails", async () => {
    mockSend.mockResolvedValue({ error: { message: "nope" } });
    vi.spyOn(console, "error").mockImplementation(() => {});
    await expect(
      sendOkuReviewEmail("p@example.com", { recipientName: "Farid", verified: true }),
    ).rejects.toThrow(/nope/);
  });
});

describe("sendRegistrationConfirmationEmail", () => {
  const base = {
    recipientName: "Farid",
    tournamentName: "KL Open",
    tournamentSlug: "kl-open-2026",
    tournamentDates: "10 Aug – 12 Aug 2026 (MYT)",
    venue: "Dewan Besar, Selangor",
    feePaidCents: 5500,
  };

  beforeEach(() => {
    vi.clearAllMocks();
    mockLoadTemplate.mockReturnValue(
      "{{recipientName}}|{{tournamentName}}|{{tournamentDates}}|{{venue}}|{{feePaid}}|{{tournamentUrl}}|{{siteUrl}}|{{lead}}|{{footerReason}}",
    );
    mockSend.mockResolvedValue({ error: null });
  });

  const sent = () => mockSend.mock.calls[0][0] as { html: string; subject: string; to: string };

  it("renders the tournament, dates, venue and fee paid", async () => {
    await sendRegistrationConfirmationEmail("p@example.com", base);
    expect(mockLoadTemplate).toHaveBeenCalledWith("registration-confirmed.html");
    expect(sent().to).toBe("p@example.com");
    expect(sent().subject).toBe("You're registered for KL Open");
    expect(sent().html).toContain("Farid|KL Open|10 Aug – 12 Aug 2026 (MYT)|Dewan Besar, Selangor|RM 55.00|");
    expect(sent().html).toContain("/tournaments/kl-open-2026|");
  });

  it("shows a free entry as Free", async () => {
    await sendRegistrationConfirmationEmail("p@example.com", { ...base, feePaidCents: 0 });
    expect(sent().html).toContain("|Free|");
  });

  it("falls back to the tournament list at / without a slug", async () => {
    await sendRegistrationConfirmationEmail("p@example.com", { ...base, tournamentSlug: null });
    expect(sent().html).toMatch(/\|https?:\/\/[^|/]+\/\|/);
    expect(sent().html).not.toContain("/tournaments");
  });

  it("escapes organizer- and player-supplied values", async () => {
    await sendRegistrationConfirmationEmail("p@example.com", {
      ...base,
      tournamentName: "<b>Open</b>",
      venue: "<script>x</script>",
    });
    expect(sent().html).toContain("&lt;b&gt;Open&lt;/b&gt;");
    expect(sent().html).not.toContain("<script>");
  });

  it("throws when the send fails", async () => {
    mockSend.mockResolvedValue({ error: { message: "nope" } });
    vi.spyOn(console, "error").mockImplementation(() => {});
    await expect(sendRegistrationConfirmationEmail("p@example.com", base)).rejects.toThrow(/nope/);
  });

  it("speaks to the player when they are the recipient", async () => {
    await sendRegistrationConfirmationEmail("p@example.com", base);
    expect(sent().html).toContain(
      "|You are registered for|You received this email because you registered for a tournament",
    );
  });

  it("names the dependent to a guardian (#716)", async () => {
    await sendRegistrationConfirmationEmail("g@example.com", {
      ...base,
      recipientName: "Siti",
      aboutPlayer: "Aina <Rahman>",
    });
    expect(sent().subject).toBe("Aina <Rahman> is registered for KL Open");
    expect(sent().html).toMatch(/^Siti\|/);
    expect(sent().html).toContain("|Aina &lt;Rahman&gt; is registered for|");
    expect(sent().html).toContain("you look after Aina &lt;Rahman&gt;&#39;s entries");
  });
});

describe("sendNominationResponseEmail", () => {
  const base = {
    recipientName: "Aisha",
    organizerOrgId: "org-1",
    tournamentId: "t-1",
    nomineeName: "Selangor Chess Association",
    tournamentName: "KL Open",
  };

  beforeEach(() => {
    vi.clearAllMocks();
    mockLoadTemplate.mockReturnValue(
      "{{recipientName}}|{{nomineeName}}|{{tournamentName}}|{{tournamentUrl}}",
    );
    mockSend.mockResolvedValue({ error: null });
  });

  const sent = () => mockSend.mock.calls[0][0] as { html: string; subject: string; to: string };

  it("uses the accepted template, linking to the organizer's tournament", async () => {
    await sendNominationResponseEmail("o@example.com", { ...base, accepted: true });
    expect(mockLoadTemplate).toHaveBeenCalledWith("nomination-accepted.html");
    expect(sent().to).toBe("o@example.com");
    expect(sent().subject).toBe(
      "Selangor Chess Association accepted the payout nomination for KL Open",
    );
    expect(sent().html).toContain("/my/organizations/org-1/tournaments/t-1");
  });

  it("uses the declined template", async () => {
    await sendNominationResponseEmail("o@example.com", { ...base, accepted: false });
    expect(mockLoadTemplate).toHaveBeenCalledWith("nomination-declined.html");
    expect(sent().subject).toMatch(/declined the payout nomination for KL Open/);
  });

  it("escapes organization-supplied names", async () => {
    await sendNominationResponseEmail("o@example.com", {
      ...base,
      nomineeName: "<b>Club</b>",
      accepted: true,
    });
    expect(sent().html).toContain("&lt;b&gt;Club&lt;/b&gt;");
    expect(sent().html).not.toContain("<b>");
  });

  it("throws when the send fails", async () => {
    mockSend.mockResolvedValue({ error: { message: "nope" } });
    vi.spyOn(console, "error").mockImplementation(() => {});
    await expect(
      sendNominationResponseEmail("o@example.com", { ...base, accepted: true }),
    ).rejects.toThrow(/nope/);
  });
});

describe("sendRefundOutcomeEmail", () => {
  const base = {
    recipientName: "Farid",
    tournamentName: "KL Open",
    amountCents: 11000,
    paymentMethod: "GrabPay",
  };

  beforeEach(() => {
    vi.clearAllMocks();
    mockLoadTemplate.mockReturnValue(
      "{{recipientName}}|{{tournamentName}}|{{amount}}|{{paymentMethod}}|{{dashboardUrl}}|{{siteUrl}}|{{lead}}|{{footerReason}}",
    );
    mockSend.mockResolvedValue({ error: null });
  });

  const sent = () => mockSend.mock.calls[0][0] as { html: string; subject: string; to: string };

  it("renders a completed refund from refund-completed.html", async () => {
    await sendRefundOutcomeEmail("p@example.com", { ...base, completed: true });
    expect(mockLoadTemplate).toHaveBeenCalledWith("refund-completed.html");
    expect(sent().to).toBe("p@example.com");
    expect(sent().subject).toBe("Your refund for KL Open is on its way");
    expect(sent().html).toMatch(/^Farid\|KL Open\|RM 110\.00\|GrabPay\|.*\/my\|/);
  });

  it("renders a failed refund from refund-failed.html", async () => {
    await sendRefundOutcomeEmail("p@example.com", { ...base, completed: false });
    expect(mockLoadTemplate).toHaveBeenCalledWith("refund-failed.html");
    expect(sent().subject).toMatch(/^Action needed: your refund for KL Open/);
    expect(sent().html).toContain("|We tried to refund RM 110.00 for|");
  });

  it("names the dependent whose entry the payer is refunded for (#716)", async () => {
    await sendRefundOutcomeEmail("g@example.com", {
      ...base,
      recipientName: "Siti",
      aboutPlayer: "Aina Rahman",
      completed: true,
    });
    expect(sent().subject).toBe(
      "The refund for Aina Rahman's entry to KL Open is on its way",
    );
    expect(sent().html).toContain("|The refund for Aina Rahman&#39;s entry to|");
    expect(sent().html).toContain("you paid for Aina Rahman&#39;s entry to");
  });

  it("names the dependent when a refund fails (#716)", async () => {
    await sendRefundOutcomeEmail("g@example.com", {
      ...base,
      recipientName: "Siti",
      aboutPlayer: "Aina Rahman",
      completed: false,
    });
    expect(sent().subject).toBe(
      "Action needed: the refund for Aina Rahman's entry to KL Open was not completed",
    );
    expect(sent().html).toContain(
      "|We tried to refund RM 110.00 for Aina Rahman&#39;s entry to|",
    );
  });

  it("escapes organizer- and player-supplied values", async () => {
    await sendRefundOutcomeEmail("p@example.com", {
      ...base,
      recipientName: "<i>Farid</i>",
      tournamentName: "<b>Open</b>",
      completed: true,
    });
    expect(sent().html).toContain("&lt;i&gt;Farid&lt;/i&gt;");
    expect(sent().html).toContain("&lt;b&gt;Open&lt;/b&gt;");
  });

  it("throws when the send fails", async () => {
    mockSend.mockResolvedValue({ error: { message: "nope" } });
    vi.spyOn(console, "error").mockImplementation(() => {});
    await expect(
      sendRefundOutcomeEmail("p@example.com", { ...base, completed: true }),
    ).rejects.toThrow(/nope/);
  });
});

describe("sendMemberInvitationEmail", () => {
  const base = {
    recipientName: "Farid",
    inviterName: "Aisha Rahman",
    organizationName: "KL Chess Club",
    role: "admin" as const,
    invitationUrl: "https://example.com/invitations/abc_DEF-123",
  };

  beforeEach(() => {
    vi.clearAllMocks();
    mockLoadTemplate.mockReturnValue(
      "{{recipientName}}|{{inviterName}}|{{organizationName}}|{{roleLabel}}|{{roleSummary}}|{{invitationUrl}}|{{siteUrl}}",
    );
    mockSend.mockResolvedValue({ error: null });
  });

  const sent = () =>
    mockSend.mock.calls[0][0] as { html: string; subject: string; to: string };

  it("links to the invitation, naming the inviter, organization and role", async () => {
    await sendMemberInvitationEmail("f@example.com", base);
    expect(mockLoadTemplate).toHaveBeenCalledWith("member-invitation.html");
    expect(sent().to).toBe("f@example.com");
    expect(sent().subject).toBe(
      "Aisha Rahman invited you to join KL Chess Club on MY Chess Tour",
    );
    expect(sent().html).toContain(
      "Farid|Aisha Rahman|KL Chess Club|an admin|create and edit tournaments",
    );
    expect(sent().html).toContain("|https://example.com/invitations/abc_DEF-123|");
  });

  it("describes what a member can do", async () => {
    await sendMemberInvitationEmail("f@example.com", { ...base, role: "member" });
    expect(sent().html).toContain(
      "|a member|view the organization&#39;s tournaments and registrations|",
    );
  });

  it("escapes organizer-supplied values", async () => {
    await sendMemberInvitationEmail("f@example.com", {
      ...base,
      inviterName: "<i>Aisha</i>",
      organizationName: "A & B <Club>",
    });
    expect(sent().html).toContain("&lt;i&gt;Aisha&lt;/i&gt;");
    expect(sent().html).toContain("A &amp; B &lt;Club&gt;");
  });

  it("throws when the send fails", async () => {
    mockSend.mockResolvedValue({ error: { message: "nope" } });
    vi.spyOn(console, "error").mockImplementation(() => {});
    await expect(sendMemberInvitationEmail("f@example.com", base)).rejects.toThrow(
      /nope/,
    );
  });
});

describe("sendInvitationResponseEmail", () => {
  const ORG_ID = "22222222-2222-2222-2222-222222222222";
  const base = {
    recipientName: "Aisha",
    inviteeName: "Farid Ali",
    inviteeEmail: "farid@example.com",
    organizationName: "KL Chess Club",
    orgId: ORG_ID,
    role: "admin" as const,
  };

  beforeEach(() => {
    vi.clearAllMocks();
    mockLoadTemplate.mockReturnValue(
      "{{recipientName}}|{{inviteeName}}|{{inviteeEmail}}|{{organizationName}}|{{roleLabel}}|{{membersUrl}}|{{siteUrl}}",
    );
    mockSend.mockResolvedValue({ error: null });
  });

  const sent = () =>
    mockSend.mock.calls[0][0] as { html: string; subject: string; to: string };

  it("tells the inviter the invitation was accepted", async () => {
    await sendInvitationResponseEmail("aisha@example.com", { ...base, accepted: true });
    expect(mockLoadTemplate).toHaveBeenCalledWith("invitation-accepted.html");
    expect(sent().to).toBe("aisha@example.com");
    expect(sent().subject).toBe("Farid Ali joined KL Chess Club");
    expect(sent().html).toContain(
      `Aisha|Farid Ali|farid@example.com|KL Chess Club|an admin|`,
    );
    expect(sent().html).toContain(`/my/organizations/${ORG_ID}/members|`);
  });

  it("tells the inviter the invitation was declined", async () => {
    await sendInvitationResponseEmail("aisha@example.com", {
      ...base,
      inviteeName: "farid@example.com",
      accepted: false,
    });
    expect(mockLoadTemplate).toHaveBeenCalledWith("invitation-declined.html");
    expect(sent().subject).toBe(
      "farid@example.com declined your invitation to KL Chess Club",
    );
  });

  it("escapes user-supplied values", async () => {
    await sendInvitationResponseEmail("aisha@example.com", {
      ...base,
      inviteeName: "<b>Farid</b>",
      organizationName: "A & B",
      accepted: true,
    });
    expect(sent().html).toContain("&lt;b&gt;Farid&lt;/b&gt;");
    expect(sent().html).toContain("A &amp; B");
  });

  it("throws when the send fails", async () => {
    mockSend.mockResolvedValue({ error: { message: "nope" } });
    vi.spyOn(console, "error").mockImplementation(() => {});
    await expect(
      sendInvitationResponseEmail("aisha@example.com", { ...base, accepted: true }),
    ).rejects.toThrow(/nope/);
  });
});

describe("sendPrizeAwardedEmail", () => {
  const base = {
    recipientName: "Aisyah",
    tournamentName: "Merdeka Open",
    prizeName: "Open — 1st",
    amountCents: 30000,
    accountLast4: "0101",
  };

  beforeEach(() => {
    vi.clearAllMocks();
    mockLoadTemplate.mockReturnValue(
      "{{recipientName}}|{{tournamentName}}|{{prizeName}}|{{amount}}|{{bankLine}}|{{ctaUrl}}|{{ctaLabel}}|{{settingsUrl}}|{{lead}}|{{footerReason}}",
    );
    mockSend.mockResolvedValue({ error: null });
  });

  const sent = () => mockSend.mock.calls[0][0] as { subject: string; html: string };

  it("loads the template and says where the prize will go", async () => {
    await sendPrizeAwardedEmail("w@example.com", base);
    expect(mockLoadTemplate).toHaveBeenCalledWith("prize-awarded.html");
    expect(sent().html).toContain("RM 300.00");
    expect(sent().html).toContain("account ending in 0101");
    expect(sent().subject).toBe("You've been awarded a prize at Merdeka Open");
  });

  it("tells the guardian a minor's prize goes to their own account (#718)", async () => {
    await sendPrizeAwardedEmail("mum@example.com", {
      ...base,
      aboutPlayer: "Cara",
      canActInSettings: true,
      paidToRecipientAsGuardian: true,
    });
    expect(sent().html).toContain("As Cara&#39;s guardian, it will be sent to your account ending in 0101.");
    expect(sent().html).toContain("View Settings");
  });

  it("asks the paid guardian for their bank details when they have none (#718)", async () => {
    await sendPrizeAwardedEmail("mum@example.com", {
      ...base,
      accountLast4: null,
      aboutPlayer: "Cara",
      canActInSettings: true,
      paidToRecipientAsGuardian: true,
    });
    expect(sent().html).toContain("paid into their guardian&#39;s account");
    expect(sent().html).toContain("Add Bank Details");
  });

  it("asks for bank details when there is no verified account", async () => {
    await sendPrizeAwardedEmail("w@example.com", { ...base, accountLast4: null });
    expect(sent().html).toContain("Please add your bank details");
    expect(sent().html).toContain("/settings|Add Bank Details");
    expect(sent().subject).toMatch(/^Action needed/);
  });

  it("asks them to fix a rejected account", async () => {
    await sendPrizeAwardedEmail("w@example.com", {
      ...base,
      accountLast4: null,
      accountRejected: true,
    });
    expect(sent().html).toContain("couldn&#39;t be verified");
  });

  it("never renders more than the last 4 digits", async () => {
    await sendPrizeAwardedEmail("w@example.com", { ...base, accountLast4: "514100000101" });
    expect(sent().html).not.toContain("514100000101");
    expect(sent().html).toContain("ending in 0101");
  });

  it("escapes the prize and tournament names", async () => {
    await sendPrizeAwardedEmail("w@example.com", {
      ...base,
      prizeName: "<i>Best</i>",
      tournamentName: "<b>Open</b>",
    });
    expect(sent().html).toContain("&lt;i&gt;Best&lt;/i&gt;");
    expect(sent().html).toContain("&lt;b&gt;Open&lt;/b&gt;");
  });

  it("throws when Resend fails", async () => {
    mockSend.mockResolvedValue({ error: { message: "rate limited" } });
    await expect(sendPrizeAwardedEmail("w@example.com", base)).rejects.toThrow(
      "rate limited",
    );
  });

  it("names the dependent to a guardian, without asking for the guardian's bank details (#716)", async () => {
    await sendPrizeAwardedEmail("g@example.com", {
      ...base,
      recipientName: "Siti",
      accountLast4: null,
      aboutPlayer: "Aina Rahman",
    });
    expect(sent().subject).toBe("Aina Rahman has been awarded a prize at Merdeka Open");
    expect(sent().html).toContain("|Congratulations! Aina Rahman has been awarded|");
    expect(sent().html).toContain("We will contact you about where to send the prize.");
    expect(sent().html).toContain("|View Settings|");
    expect(sent().html).toContain("because Aina Rahman won a prize");
  });

  it("doesn't send a winner who can't sign in to Settings (#716)", async () => {
    await sendPrizeAwardedEmail("b@example.com", {
      ...base,
      recipientName: "Badrul",
      accountLast4: null,
      canActInSettings: false,
    });
    expect(sent().subject).toBe("You've been awarded a prize at Merdeka Open");
    expect(sent().html).toContain("We will contact you about where to send the prize.");
    expect(sent().html).not.toContain("Add Bank Details");
  });
});

describe("sendPrizePaidEmail", () => {
  const base = {
    recipientName: "Aisyah",
    tournamentName: "Merdeka Open",
    prizeName: "Open — 1st",
    amountCents: 30000,
    accountLast4: "0101",
  };

  beforeEach(() => {
    vi.clearAllMocks();
    mockLoadTemplate.mockReturnValue(
      "{{recipientName}}|{{tournamentName}}|{{prizeName}}|{{amount}}|{{accountLast4}}|{{ctaUrl}}|{{ctaLabel}}|{{settingsUrl}}|{{lead}}|{{footerReason}}",
    );
    mockSend.mockResolvedValue({ error: null });
  });

  const sentHtml = () => mockSend.mock.calls[0][0].html as string;

  it("links to CHIP's receipt when there is a safe one", async () => {
    await sendPrizePaidEmail("w@example.com", {
      ...base,
      receiptUrl: "https://chip.test/receipt/7001",
    });
    expect(mockLoadTemplate).toHaveBeenCalledWith("prize-paid.html");
    expect(sentHtml()).toContain("https://chip.test/receipt/7001|View Receipt");
    expect(sentHtml()).toContain("RM 300.00");
  });

  it("falls back to settings when the receipt isn't a safe https URL", async () => {
    await sendPrizePaidEmail("w@example.com", { ...base, receiptUrl: "javascript:alert(1)" });
    expect(sentHtml()).toContain("/settings|View Settings");
    expect(sentHtml()).not.toContain("javascript:");
  });

  it("never renders more than the last 4 digits", async () => {
    await sendPrizePaidEmail("w@example.com", { ...base, accountLast4: "514100000101" });
    expect(sentHtml()).toContain("|0101|");
    expect(sentHtml()).not.toContain("514100000101");
  });

  it("names the dependent to a guardian (#716)", async () => {
    await sendPrizePaidEmail("g@example.com", {
      ...base,
      recipientName: "Siti",
      aboutPlayer: "Aina Rahman",
    });
    expect(mockSend.mock.calls[0][0].subject).toBe(
      "Aina Rahman's prize from Merdeka Open has been sent",
    );
    expect(sentHtml()).toContain("|Aina Rahman&#39;s prize for|");
  });

  it("speaks to the winner when they are the recipient", async () => {
    await sendPrizePaidEmail("w@example.com", base);
    expect(sentHtml()).toContain("|Your prize for|");
  });
});

describe("sendPrizeFundingRequestEmail", () => {
  const base = {
    funderName: "ACME <Sdn Bhd>",
    organizerName: "KL Chess",
    tournamentName: "Merdeka Open",
    amountCents: 45000,
    prizeList: "Open — 1st, Open — 2nd",
    checkoutUrl: "https://gate.chip-in.asia/p/abc",
  };

  beforeEach(() => {
    vi.clearAllMocks();
    mockLoadTemplate.mockReturnValue(
      "{{funderName}}|{{organizerName}}|{{tournamentName}}|{{amount}}|{{prizeList}}|{{checkoutUrl}}|{{siteUrl}}",
    );
    mockSend.mockResolvedValue({ error: null });
  });

  it("sends the sponsor their share and the CHIP link", async () => {
    await sendPrizeFundingRequestEmail("pay@acme.test", base);
    const sent = mockSend.mock.calls[0][0];
    expect(mockLoadTemplate).toHaveBeenCalledWith("prize-funding-request.html");
    expect(sent.to).toBe("pay@acme.test");
    expect(sent.subject).toBe("Prize fund payment for Merdeka Open");
    expect(sent.html).toContain("RM 450.00");
    expect(sent.html).toContain("https://gate.chip-in.asia/p/abc");
    expect(sent.html).toContain("ACME &lt;Sdn Bhd&gt;");
  });

  it("refuses a link that isn't https", async () => {
    await expect(
      sendPrizeFundingRequestEmail("pay@acme.test", { ...base, checkoutUrl: "javascript:alert(1)" }),
    ).rejects.toThrow(/https/);
    expect(mockSend).not.toHaveBeenCalled();
  });

  it("throws when Resend refuses", async () => {
    mockSend.mockResolvedValue({ error: { message: "rate limited" } });
    await expect(sendPrizeFundingRequestEmail("pay@acme.test", base)).rejects.toThrow(
      /rate limited/,
    );
  });
});

describe("sendTournamentListedEmail", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockLoadTemplate.mockReturnValue(
      "{{recipientName}}|{{orgName}}|{{tournamentName}}|{{amount}}|{{ctaUrl}}",
    );
    mockSend.mockResolvedValue({ error: null });
  });

  it("links to the public page and states the pool", async () => {
    await sendTournamentListedEmail("owner@org.test", {
      recipientName: "Hafiz",
      orgName: "KL Chess",
      tournamentName: "Merdeka Open",
      tournamentUrl: "https://mychesstour.com/tournaments/merdeka-open",
      fundedCents: 50000,
    });
    const sent = mockSend.mock.calls[0][0];
    expect(sent.subject).toBe("Merdeka Open is now open for registration");
    expect(sent.html).toBe(
      "Hafiz|KL Chess|Merdeka Open|RM 500.00|https://mychesstour.com/tournaments/merdeka-open",
    );
  });

  it("falls back to the dashboard without a public page", async () => {
    await sendTournamentListedEmail("owner@org.test", {
      recipientName: "Hafiz",
      orgName: "KL Chess",
      tournamentName: "Merdeka Open",
      tournamentUrl: null,
      fundedCents: 50000,
    });
    expect(mockSend.mock.calls[0][0].html).toContain("/my/organizations");
  });
});

describe("sendHelperInvitationEmail", () => {
  const base = {
    playerName: "Bea Player",
    relationshipLabel: "carer",
    invitationUrl: "https://example.com/helper-invitations/abc_DEF-123",
  };

  beforeEach(() => {
    vi.clearAllMocks();
    mockLoadTemplate.mockReturnValue(
      "{{playerName}}|{{relationshipLabel}}|{{invitationUrl}}|{{siteUrl}}",
    );
    mockSend.mockResolvedValue({ error: null });
  });

  const sent = () =>
    mockSend.mock.calls[0][0] as { html: string; subject: string; to: string };

  it("links to the invitation, naming the player and relationship", async () => {
    await sendHelperInvitationEmail("h@example.com", base);
    expect(mockLoadTemplate).toHaveBeenCalledWith("helper-invitation.html");
    expect(sent().to).toBe("h@example.com");
    expect(sent().subject).toBe(
      "Bea Player asked you to help them on MY Chess Tour",
    );
    expect(sent().html).toContain(
      "Bea Player|carer|https://example.com/helper-invitations/abc_DEF-123|",
    );
  });

  it("escapes the player's name", async () => {
    await sendHelperInvitationEmail("h@example.com", {
      ...base,
      playerName: "<b>Bea</b> & co",
    });
    expect(sent().html).toContain("&lt;b&gt;Bea&lt;/b&gt; &amp; co");
  });

  it("throws when the email can't be sent", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    mockSend.mockResolvedValue({ error: { message: "down" } });
    await expect(sendHelperInvitationEmail("h@example.com", base)).rejects.toThrow(
      "Failed to send helper invitation email: down",
    );
  });
});

describe("sendGuardianshipAgeOutEmail (#721)", () => {
  const base = {
    recipientName: "Gwen",
    playerName: "Sara Child",
    guardianName: "Gwen Guardian",
    turns18On: "5 Dec 2026",
    accessEndsOn: "4 Jan 2027",
  };

  beforeEach(() => {
    vi.clearAllMocks();
    mockLoadTemplate.mockReturnValue(
      "{{headline}}|{{recipientName}}|{{message}}|{{noticeMain}}|{{noticeReason}}|{{ctaUrl}}|{{ctaLabel}}|{{footerReason}}|{{siteUrl}}",
    );
    mockSend.mockResolvedValue({ error: null });
  });

  const sent = () =>
    mockSend.mock.calls[0][0] as { html: string; subject: string; to: string };

  it("tells the guardian the birthday is coming and what they can still do", async () => {
    await sendGuardianshipAgeOutEmail("gwen@example.com", {
      ...base,
      audience: "guardian",
      stage: "upcoming",
    });
    expect(mockLoadTemplate).toHaveBeenCalledWith("guardianship-age-out.html");
    expect(sent().to).toBe("gwen@example.com");
    expect(sent().subject).toBe(
      "Sara Child turns 18 on 5 Dec 2026: hand over their MY Chess Tour record",
    );
    expect(sent().html).toContain("no new registrations or payments");
    expect(sent().html).toContain("Your access ends on 4 Jan 2027");
    expect(sent().html).toContain("/settings/dependents");
  });

  it("tells the guardian their access has ended", async () => {
    await sendGuardianshipAgeOutEmail("gwen@example.com", {
      ...base,
      audience: "guardian",
      stage: "ended",
    });
    expect(sent().subject).toBe(
      "Your access to Sara Child's MY Chess Tour record has ended",
    );
    expect(sent().html).toContain("you no longer manage it");
  });

  it("asks the player to have the record handed over", async () => {
    await sendGuardianshipAgeOutEmail("sara@example.com", {
      ...base,
      recipientName: "Sara",
      audience: "player",
      stage: "turned_18",
    });
    expect(sent().subject).toBe(
      "You've turned 18: take over your MY Chess Tour record",
    );
    expect(sent().html).toContain("Ask Gwen Guardian to hand the record over to you");
  });

  it("throws when Resend refuses", async () => {
    mockSend.mockResolvedValue({ error: { message: "rate limited" } });
    vi.spyOn(console, "error").mockImplementation(() => {});
    await expect(
      sendGuardianshipAgeOutEmail("gwen@example.com", {
        ...base,
        audience: "guardian",
        stage: "turned_18",
      }),
    ).rejects.toThrow("rate limited");
  });
});

describe("sendAccountClaimEmail (#720)", () => {
  const base = {
    playerName: "Ada",
    guardianName: "Gwen Guardian",
    claimUrl: "https://example.com/claim/abc_DEF-123",
  };

  beforeEach(() => {
    vi.clearAllMocks();
    mockLoadTemplate.mockReturnValue(
      "{{playerName}}|{{guardianName}}|{{claimUrl}}|{{siteUrl}}",
    );
    mockSend.mockResolvedValue({ error: null });
  });

  const sent = () =>
    mockSend.mock.calls[0][0] as { html: string; subject: string; to: string };

  it("sends the player the link, naming who is handing the record over", async () => {
    await sendAccountClaimEmail("ada@example.com", base);
    expect(mockLoadTemplate).toHaveBeenCalledWith("account-claim.html");
    expect(sent().to).toBe("ada@example.com");
    expect(sent().subject).toBe(
      "Gwen Guardian is handing your MY Chess Tour record over to you",
    );
    expect(sent().html).toContain(
      "Ada|Gwen Guardian|https://example.com/claim/abc_DEF-123|",
    );
  });

  it("escapes the names", async () => {
    await sendAccountClaimEmail("ada@example.com", {
      ...base,
      guardianName: "<b>Gwen</b>",
    });
    expect(sent().html).toContain("&lt;b&gt;Gwen&lt;/b&gt;");
  });

  it("throws when the email can't be sent", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    mockSend.mockResolvedValue({ error: { message: "down" } });
    await expect(sendAccountClaimEmail("ada@example.com", base)).rejects.toThrow(
      "Failed to send account claim email: down",
    );
  });
});
