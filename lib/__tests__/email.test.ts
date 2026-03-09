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
  Resend: vi.fn(function () { return { emails: { send: mockSend } }; }),
}));

import { sendPasswordResetEmail, sendVerificationEmail } from "../email";

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
      "utf-8"
    );
  });

  it("loads the template from the email-templates directory", async () => {
    await sendVerificationEmail("player@example.com", "ABC123");

    const [filePath] = mockReadFileSync.mock.calls[0];
    expect(filePath).toMatch(/email-templates/);
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
      expect.objectContaining({ to: "player@example.com" })
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
      sendVerificationEmail("player@example.com", "ABC123")
    ).rejects.toThrow(/sending failed/i);
  });

  it("resolves without a value when send succeeds", async () => {
    await expect(
      sendVerificationEmail("player@example.com", "ABC123")
    ).resolves.toBeUndefined();
  });
});

describe("sendPasswordResetEmail", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockReadFileSync.mockReturnValue('<html><a href="{{resetLink}}">reset</a>{{resetLink}}</html>');
    mockSend.mockResolvedValue({ error: null });
  });

  // --- Template loading -----------------------------------------------------

  it("loads the reset-password.html template from the filesystem", async () => {
    await sendPasswordResetEmail("player@example.com", "https://example.com/reset");

    expect(mockReadFileSync).toHaveBeenCalledOnce();
    expect(mockReadFileSync).toHaveBeenCalledWith(
      expect.stringContaining("reset-password.html"),
      "utf-8"
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
    await sendPasswordResetEmail("player@example.com", "https://example.com/reset");

    expect(mockSend).toHaveBeenCalledWith(
      expect.objectContaining({ to: "player@example.com" })
    );
  });

  it("includes a subject mentioning reset (case-insensitive)", async () => {
    await sendPasswordResetEmail("player@example.com", "https://example.com/reset");

    const { subject } = mockSend.mock.calls[0][0];
    expect(subject).toMatch(/reset/i);
  });

  // --- Error handling -------------------------------------------------------

  it("throws when Resend returns an error", async () => {
    mockSend.mockResolvedValue({ error: { message: "Sending failed" } });

    await expect(
      sendPasswordResetEmail("player@example.com", "https://example.com/reset")
    ).rejects.toThrow(/sending failed/i);
  });

  it("resolves without a value when send succeeds", async () => {
    await expect(
      sendPasswordResetEmail("player@example.com", "https://example.com/reset")
    ).resolves.toBeUndefined();
  });
});
