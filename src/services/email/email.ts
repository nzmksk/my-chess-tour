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

// Notifies an organization owner/admin of CHIP Send's verdict on their payout
// bank account — verified, or could not be verified (with the reason and a link
// to fix the details). One function with a boolean branch, like
// sendCancellationReviewEmail.
//
// Only the last 4 digits of the account number are ever passed in or rendered:
// an email is a copy of the data we no longer control.
export async function sendBankVerificationEmail(
  email: string,
  params: {
    recipientName: string;
    orgName: string;
    orgId: string;
    bankName: string;
    accountLast4: string;
    verified: boolean;
    rejectionReason?: string;
  },
) {
  const siteUrl = process.env.NEXT_PUBLIC_SITE_URL ?? "http://localhost:3000";
  const settingsUrl = `${siteUrl}/my/organizations/${encodeURIComponent(params.orgId)}/settings`;

  const template = params.verified
    ? "bank-account-verified.html"
    : "bank-account-verification-failed.html";

  // Defence in depth: whatever a caller passes, render at most 4 digits.
  const last4 = params.accountLast4.replace(/\D/g, "").slice(-4);

  let html = loadTemplate(template)
    .replace(/\{\{recipientName\}\}/g, escapeHtml(params.recipientName))
    .replace(/\{\{orgName\}\}/g, escapeHtml(params.orgName))
    .replace(/\{\{bankName\}\}/g, escapeHtml(params.bankName))
    .replace(/\{\{accountLast4\}\}/g, last4)
    .replace(/\{\{settingsUrl\}\}/g, settingsUrl);

  if (!params.verified) {
    html = html.replace(
      /\{\{rejectionReason\}\}/g,
      escapeHtml(params.rejectionReason ?? ""),
    );
  }

  const subject = params.verified
    ? `Your payout account for ${params.orgName} is verified`
    : `Action needed: we couldn't verify the payout account for ${params.orgName}`;

  const { error } = await resend.emails.send({
    from: FROM_ADDRESS,
    to: email,
    subject,
    html,
  });

  if (error) {
    console.error("Failed to send bank verification email:", error);
    throw new Error(`Failed to send bank verification email: ${error.message}`);
  }
}

function formatRinggit(cents: number): string {
  return `RM ${(cents / 100).toLocaleString("en-MY", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}

// CHIP's receipt link comes from a webhook body, so it only becomes a link if it
// really is an https URL.
function safeHttpsUrl(value: string | null | undefined): string | null {
  if (!value) return null;
  try {
    return new URL(value).protocol === "https:" ? value : null;
  } catch {
    return null;
  }
}

// Tells an organization its payout has been sent. Shared by automatic and early
// payouts, which differ only in the subject. Only the last 4 digits of the account
// number are ever passed in or rendered.
export async function sendPayoutProcessedEmail(
  email: string,
  params: {
    recipientName: string;
    tournamentName: string;
    amountCents: number;
    accountLast4: string;
    receiptUrl?: string | null;
    early?: boolean;
  },
) {
  const siteUrl = process.env.NEXT_PUBLIC_SITE_URL ?? "http://localhost:3000";
  const dashboardUrl = `${siteUrl}/my/organizations`;
  const receiptUrl = safeHttpsUrl(params.receiptUrl);
  // Defence in depth: whatever a caller passes, render at most 4 digits.
  const last4 = params.accountLast4.replace(/\D/g, "").slice(-4);

  const html = loadTemplate("payout-processed.html")
    .replace(/\{\{recipientName\}\}/g, escapeHtml(params.recipientName))
    .replace(/\{\{tournamentName\}\}/g, escapeHtml(params.tournamentName))
    .replace(/\{\{amount\}\}/g, formatRinggit(params.amountCents))
    .replace(/\{\{accountLast4\}\}/g, last4)
    .replace(/\{\{ctaUrl\}\}/g, escapeHtml(receiptUrl ?? dashboardUrl))
    .replace(/\{\{ctaLabel\}\}/g, receiptUrl ? "View Receipt" : "View Payouts")
    .replace(/\{\{dashboardUrl\}\}/g, dashboardUrl);

  const subject = params.early
    ? `Your early payout for ${params.tournamentName} has been sent`
    : `Your payout for ${params.tournamentName} has been sent`;

  const { error } = await resend.emails.send({
    from: FROM_ADDRESS,
    to: email,
    subject,
    html,
  });

  if (error) {
    console.error("Failed to send payout processed email:", error);
    throw new Error(`Failed to send payout processed email: ${error.message}`);
  }
}

// Tells an organization its payout failed, in plain language (see
// describePayoutFailure) with a prompt to check bank details or contact support.
export async function sendPayoutFailedEmail(
  email: string,
  params: {
    recipientName: string;
    tournamentName: string;
    amountCents: number;
    failureReason: string;
  },
) {
  const siteUrl = process.env.NEXT_PUBLIC_SITE_URL ?? "http://localhost:3000";

  const html = loadTemplate("payout-failed.html")
    .replace(/\{\{recipientName\}\}/g, escapeHtml(params.recipientName))
    .replace(/\{\{tournamentName\}\}/g, escapeHtml(params.tournamentName))
    .replace(/\{\{amount\}\}/g, formatRinggit(params.amountCents))
    .replace(/\{\{failureReason\}\}/g, escapeHtml(params.failureReason))
    .replace(/\{\{dashboardUrl\}\}/g, `${siteUrl}/my/organizations`);

  const { error } = await resend.emails.send({
    from: FROM_ADDRESS,
    to: email,
    subject: `Action needed: your payout for ${params.tournamentName} failed`,
    html,
  });

  if (error) {
    console.error("Failed to send payout failed email:", error);
    throw new Error(`Failed to send payout failed email: ${error.message}`);
  }
}

// Tells an organization the outcome of its early payout request. Approval means
// the transfer is being sent, not that it has landed: sendPayoutProcessedEmail
// follows once it settles. One function with a boolean branch, like
// sendCancellationReviewEmail.
export async function sendPayoutReviewEmail(
  email: string,
  params: {
    recipientName: string;
    tournamentName: string;
    amountCents: number;
    approved: boolean;
    rejectionReason?: string;
  },
) {
  const siteUrl = process.env.NEXT_PUBLIC_SITE_URL ?? "http://localhost:3000";

  const template = params.approved
    ? "payout-request-approved.html"
    : "payout-request-rejected.html";

  let html = loadTemplate(template)
    .replace(/\{\{recipientName\}\}/g, escapeHtml(params.recipientName))
    .replace(/\{\{tournamentName\}\}/g, escapeHtml(params.tournamentName))
    .replace(/\{\{amount\}\}/g, formatRinggit(params.amountCents))
    .replace(/\{\{dashboardUrl\}\}/g, `${siteUrl}/my/organizations`);

  if (!params.approved) {
    html = html.replace(
      /\{\{rejectionReason\}\}/g,
      escapeHtml(params.rejectionReason ?? ""),
    );
  }

  const subject = params.approved
    ? `Your early payout request for ${params.tournamentName} was approved`
    : `Your early payout request for ${params.tournamentName} was declined`;

  const { error } = await resend.emails.send({
    from: FROM_ADDRESS,
    to: email,
    subject,
    html,
  });

  if (error) {
    console.error("Failed to send payout review email:", error);
    throw new Error(`Failed to send payout review email: ${error.message}`);
  }
}

/**
 * What a platform admin is being alerted to:
 *   early_request    an organizer filed an early payout request to review
 *   awaiting_budget  a payout is parked until a CHIP Send budget request is approved
 */
export type AdminPayoutAlert = "early_request" | "awaiting_budget";

const ADMIN_ALERTS: Record<
  AdminPayoutAlert,
  { headline: string; intro: string; subject: string; ctaLabel: string }
> = {
  early_request: {
    headline: "Early Payout Request",
    intro: "An organizer has asked for an early payout. It is waiting for your review.",
    subject: "Early payout request to review",
    ctaLabel: "Review Request",
  },
  awaiting_budget: {
    headline: "Payout Awaiting Budget",
    intro:
      "A payout could not be sent because the CHIP Send balance is too low. A budget increase has been requested; the payout goes out on the next run once it is approved.",
    subject: "Payout waiting on CHIP Send budget",
    ctaLabel: "View Payouts",
  },
};

// Alerts a platform admin to a payout that needs a person. `path` is where the
// button leads, relative to the site (e.g. /admin/payouts/<id>).
export async function sendAdminPayoutAlertEmail(
  email: string,
  params: {
    alert: AdminPayoutAlert;
    recipientName: string;
    tournamentName: string;
    organizationName: string;
    amountCents: number;
    detail?: string;
    path: string;
  },
) {
  const siteUrl = process.env.NEXT_PUBLIC_SITE_URL ?? "http://localhost:3000";
  const copy = ADMIN_ALERTS[params.alert];

  const html = loadTemplate("admin-payout-alert.html")
    .replace(/\{\{headline\}\}/g, copy.headline)
    .replace(/\{\{intro\}\}/g, copy.intro)
    .replace(/\{\{recipientName\}\}/g, escapeHtml(params.recipientName))
    .replace(/\{\{tournamentName\}\}/g, escapeHtml(params.tournamentName))
    .replace(/\{\{organizationName\}\}/g, escapeHtml(params.organizationName))
    .replace(/\{\{amount\}\}/g, formatRinggit(params.amountCents))
    .replace(/\{\{detail\}\}/g, escapeHtml(params.detail ?? ""))
    .replace(/\{\{ctaUrl\}\}/g, escapeHtml(`${siteUrl}${params.path}`))
    .replace(/\{\{ctaLabel\}\}/g, copy.ctaLabel)
    .replace(/\{\{siteUrl\}\}/g, siteUrl);

  const { error } = await resend.emails.send({
    from: FROM_ADDRESS,
    to: email,
    subject: `${copy.subject}: ${params.tournamentName}`,
    html,
  });

  if (error) {
    console.error("Failed to send admin payout alert email:", error);
    throw new Error(`Failed to send admin payout alert email: ${error.message}`);
  }
}

// Asks a nominated organization to accept a tournament's payout. Sent to the
// NOMINEE: nothing is redirected until one of its payout managers accepts on the
// dashboard this links to.
export async function sendBeneficiaryNominationEmail(
  email: string,
  params: {
    recipientName: string;
    nomineeOrgId: string;
    nomineeName: string;
    organizerName: string;
    tournamentName: string;
  },
) {
  const siteUrl = process.env.NEXT_PUBLIC_SITE_URL ?? "http://localhost:3000";
  const dashboardUrl = `${siteUrl}/my/organizations/${encodeURIComponent(params.nomineeOrgId)}`;

  const html = loadTemplate("beneficiary-nomination.html")
    .replace(/\{\{recipientName\}\}/g, escapeHtml(params.recipientName))
    .replace(/\{\{nomineeName\}\}/g, escapeHtml(params.nomineeName))
    .replace(/\{\{organizerName\}\}/g, escapeHtml(params.organizerName))
    .replace(/\{\{tournamentName\}\}/g, escapeHtml(params.tournamentName))
    .replace(/\{\{dashboardUrl\}\}/g, dashboardUrl);

  const { error } = await resend.emails.send({
    from: FROM_ADDRESS,
    to: email,
    subject: `${params.organizerName} nominated ${params.nomineeName} to receive a tournament payout`,
    html,
  });

  if (error) {
    console.error("Failed to send beneficiary nomination email:", error);
    throw new Error(`Failed to send beneficiary nomination email: ${error.message}`);
  }
}

// Tells an organizer applicant the outcome of their organization application —
// approved (they are now its owner) or declined, with the admin's reason and a
// link back to their applications so they can apply again. One function with a
// boolean branch, like sendCancellationReviewEmail.
export async function sendOrganizerApplicationReviewEmail(
  email: string,
  params: {
    recipientName: string;
    organizationName: string;
    orgId: string;
    approved: boolean;
    rejectionReason?: string;
  },
) {
  const siteUrl = process.env.NEXT_PUBLIC_SITE_URL ?? "http://localhost:3000";

  const template = params.approved
    ? "organizer-application-approved.html"
    : "organizer-application-rejected.html";

  let html = loadTemplate(template)
    .replace(/\{\{recipientName\}\}/g, escapeHtml(params.recipientName))
    .replace(/\{\{organizationName\}\}/g, escapeHtml(params.organizationName))
    .replace(
      /\{\{dashboardUrl\}\}/g,
      `${siteUrl}/my/organizations/${encodeURIComponent(params.orgId)}`,
    )
    .replace(/\{\{applicationsUrl\}\}/g, `${siteUrl}/my/organizations/applications`)
    .replace(/\{\{siteUrl\}\}/g, siteUrl);

  if (!params.approved) {
    html = html.replace(
      /\{\{rejectionReason\}\}/g,
      escapeHtml(params.rejectionReason ?? ""),
    );
  }

  const subject = params.approved
    ? `${params.organizationName} is approved on MY Chess Tour`
    : `Your application for ${params.organizationName} was declined`;

  const { error } = await resend.emails.send({
    from: FROM_ADDRESS,
    to: email,
    subject,
    html,
  });

  if (error) {
    console.error("Failed to send organizer application review email:", error);
    throw new Error(
      `Failed to send organizer application review email: ${error.message}`,
    );
  }
}

// Tells a player the outcome of their OKU card review — verified, or rejected
// with the admin's reason and a link back to settings to upload a new copy. One
// function with a boolean branch, like sendCancellationReviewEmail.
export async function sendOkuReviewEmail(
  email: string,
  params: {
    recipientName: string;
    verified: boolean;
    rejectionReason?: string;
  },
) {
  const siteUrl = process.env.NEXT_PUBLIC_SITE_URL ?? "http://localhost:3000";

  const template = params.verified ? "oku-verified.html" : "oku-rejected.html";

  let html = loadTemplate(template)
    .replace(/\{\{recipientName\}\}/g, escapeHtml(params.recipientName))
    .replace(/\{\{settingsUrl\}\}/g, `${siteUrl}/settings`)
    .replace(/\{\{browseUrl\}\}/g, `${siteUrl}/tournaments`);

  if (!params.verified) {
    html = html.replace(
      /\{\{rejectionReason\}\}/g,
      escapeHtml(params.rejectionReason ?? ""),
    );
  }

  const subject = params.verified
    ? "Your OKU status is verified"
    : "We couldn't verify your OKU card";

  const { error } = await resend.emails.send({
    from: FROM_ADDRESS,
    to: email,
    subject,
    html,
  });

  if (error) {
    console.error("Failed to send OKU review email:", error);
    throw new Error(`Failed to send OKU review email: ${error.message}`);
  }
}
