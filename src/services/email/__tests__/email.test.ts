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
  sendCancellationReviewEmail,
  sendPasswordResetEmail,
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
