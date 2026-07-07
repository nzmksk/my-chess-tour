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

// Notifies an organization member (owner/admin) of the outcome of the
// cancellation request they can act on — approved (tournament cancelled) or
// declined (tournament stays live, with the admin's reason).
export async function sendCancellationReviewEmail(
  email: string,
  params: {
    recipientName: string;
    tournamentName: string;
    approved: boolean;
    rejectionReason?: string;
  },
) {
  const siteUrl = process.env.NEXT_PUBLIC_SITE_URL ?? "http://localhost:3000";
  const dashboardUrl = `${siteUrl}/my/organizations`;

  const template = params.approved
    ? "tournament-cancellation-approved.html"
    : "tournament-cancellation-rejected.html";

  let html = loadTemplate(template)
    .replace(/\{\{recipientName\}\}/g, escapeHtml(params.recipientName))
    .replace(/\{\{tournamentName\}\}/g, escapeHtml(params.tournamentName))
    .replace(/\{\{dashboardUrl\}\}/g, dashboardUrl);

  if (!params.approved) {
    html = html.replace(
      /\{\{rejectionReason\}\}/g,
      escapeHtml(params.rejectionReason ?? ""),
    );
  }

  const subject = params.approved
    ? `Your cancellation request for ${params.tournamentName} was approved`
    : `Your cancellation request for ${params.tournamentName} was declined`;

  const { error } = await resend.emails.send({
    from: FROM_ADDRESS,
    to: email,
    subject,
    html,
  });

  if (error) {
    console.error("Failed to send cancellation review email:", error);
    throw new Error(
      `Failed to send cancellation review email: ${error.message}`,
    );
  }
}
