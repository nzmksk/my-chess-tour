import fs from "fs";
import path from "path";
import { Resend } from "resend";

const resend = new Resend(process.env.RESEND_API_KEY!);
const FROM_ADDRESS = process.env.RESEND_FROM_EMAIL!;

function loadTemplate(name: string): string {
  return fs.readFileSync(
    path.join(process.cwd(), "src/services/email/templates", name),
    "utf-8",
  );
}

// Escapes user-supplied values before they are interpolated into an HTML email
// template, so a player name or tournament title can't inject markup.
function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

export async function sendVerificationEmail(email: string, code: string) {
  const html = loadTemplate("verification.html").replace("{{code}}", code);

  const { error } = await resend.emails.send({
    from: FROM_ADDRESS,
    to: email,
    subject: "Your MY Chess Tour verification code",
    html,
  });

  if (error) {
    console.log("Failed to send verification email:", error);
    throw new Error(`Failed to send verification email: ${error.message}`);
  }
}

export async function sendPasswordResetEmail(email: string, resetLink: string) {
  const html = loadTemplate("reset-password.html").replace(
    /\{\{resetLink\}\}/g,
    resetLink,
  );

  const { error } = await resend.emails.send({
    from: FROM_ADDRESS,
    to: email,
    subject: "Reset your MY Chess Tour password",
    html,
  });

  if (error) {
    console.error("Failed to send password reset email:", error);
    throw new Error(`Failed to send password reset email: ${error.message}`);
  }
}

export async function sendTournamentCancellationEmail(
  email: string,
  params: { playerName: string; tournamentName: string },
) {
  const siteUrl = process.env.NEXT_PUBLIC_SITE_URL ?? "http://localhost:3000";
  const html = loadTemplate("tournament-cancellation.html")
    .replace(/\{\{playerName\}\}/g, escapeHtml(params.playerName))
    .replace(/\{\{tournamentName\}\}/g, escapeHtml(params.tournamentName))
    .replace(/\{\{browseUrl\}\}/g, `${siteUrl}/tournaments`);

  const { error } = await resend.emails.send({
    from: FROM_ADDRESS,
    to: email,
    subject: `${params.tournamentName} has been cancelled`,
    html,
  });

  if (error) {
    console.error("Failed to send tournament cancellation email:", error);
    throw new Error(
      `Failed to send tournament cancellation email: ${error.message}`,
    );
  }
}
