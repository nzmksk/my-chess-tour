import fs from "fs";
import path from "path";
import { Resend } from "resend";
import { SUPPORT_EMAIL } from "@/lib/reference/contact";

const resend = new Resend(process.env.RESEND_API_KEY!);
const FROM_ADDRESS = process.env.RESEND_FROM_EMAIL!;

function loadTemplate(name: string): string {
  return fs.readFileSync(
    path.join(process.cwd(), "src/services/email/templates", name),
    "utf-8",
  );
}

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
  params: {
    recipientName: string;
    tournamentName: string;
    aboutPlayer?: string | null;
  },
) {
  const siteUrl = process.env.NEXT_PUBLIC_SITE_URL ?? "http://localhost:3000";
  const about = params.aboutPlayer ?? null;
  const html = loadTemplate("tournament-cancellation.html")
    .replace(
      /\{\{lead\}\}/g,
      escapeHtml(
        about
          ? `We're sorry to let you know that ${about}'s tournament`
          : "We're sorry to let you know that",
      ),
    )
    .replace(
      /\{\{footerReason\}\}/g,
      escapeHtml(
        about
          ? `You received this email because ${about} was registered for`
          : "You received this email because you were registered for",
      ),
    )
    .replace(/\{\{recipientName\}\}/g, escapeHtml(params.recipientName))
    .replace(/\{\{tournamentName\}\}/g, escapeHtml(params.tournamentName))
    .replace(/\{\{browseUrl\}\}/g, `${siteUrl}/`);

  const { error } = await resend.emails.send({
    from: FROM_ADDRESS,
    to: email,
    subject: about
      ? `${params.tournamentName}, which ${about} entered, has been cancelled`
      : `${params.tournamentName} has been cancelled`,
    html,
  });

  if (error) {
    console.error("Failed to send tournament cancellation email:", error);
    throw new Error(
      `Failed to send tournament cancellation email: ${error.message}`,
    );
  }
}

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

function safeHttpsUrl(value: string | null | undefined): string | null {
  if (!value) return null;
  try {
    return new URL(value).protocol === "https:" ? value : null;
  } catch {
    return null;
  }
}

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

export async function sendPrizeAwardedEmail(
  email: string,
  params: {
    recipientName: string;
    tournamentName: string;
    prizeName: string;
    amountCents: number;
    accountLast4: string | null;
    accountRejected?: boolean;
    aboutPlayer?: string | null;
    canActInSettings?: boolean;
  },
) {
  const siteUrl = process.env.NEXT_PUBLIC_SITE_URL ?? "http://localhost:3000";
  const settingsUrl = `${siteUrl}/settings`;
  const last4 = params.accountLast4?.replace(/\D/g, "").slice(-4) || null;
  const about = params.aboutPlayer ?? null;
  const selfService = !about && params.canActInSettings !== false;

  const bankLine = !selfService
    ? last4
      ? `It will be sent to the account ending in ${last4}.`
      : "We will contact you about where to send the prize."
    : params.accountRejected
      ? "Your bank account couldn't be verified. Please check your bank details in Settings so we can send your prize."
      : last4
        ? `It will be sent to your account ending in ${last4}.`
        : "Please add your bank details in Settings so we can send your prize.";
  const needsAction = selfService && (params.accountRejected || !last4);

  const html = loadTemplate("prize-awarded.html")
    .replace(
      /\{\{lead\}\}/g,
      escapeHtml(
        about
          ? `Congratulations! ${about} has been awarded`
          : "Congratulations! You have been awarded",
      ),
    )
    .replace(
      /\{\{footerReason\}\}/g,
      escapeHtml(
        about
          ? `You received this email because ${about} won a prize in a tournament`
          : "You received this email because you won a prize in a tournament",
      ),
    )
    .replace(/\{\{recipientName\}\}/g, escapeHtml(params.recipientName))
    .replace(/\{\{tournamentName\}\}/g, escapeHtml(params.tournamentName))
    .replace(/\{\{prizeName\}\}/g, escapeHtml(params.prizeName))
    .replace(/\{\{amount\}\}/g, formatRinggit(params.amountCents))
    .replace(/\{\{bankLine\}\}/g, escapeHtml(bankLine))
    .replace(/\{\{ctaUrl\}\}/g, escapeHtml(settingsUrl))
    .replace(/\{\{ctaLabel\}\}/g, needsAction ? "Add Bank Details" : "View Settings")
    .replace(/\{\{settingsUrl\}\}/g, settingsUrl);

  const subject = about
    ? `${about} has been awarded a prize at ${params.tournamentName}`
    : needsAction
      ? `Action needed: add your bank details to receive your prize from ${params.tournamentName}`
      : `You've been awarded a prize at ${params.tournamentName}`;

  const { error } = await resend.emails.send({
    from: FROM_ADDRESS,
    to: email,
    subject,
    html,
  });

  if (error) {
    console.error("Failed to send prize awarded email:", error);
    throw new Error(`Failed to send prize awarded email: ${error.message}`);
  }
}

export async function sendPrizePaidEmail(
  email: string,
  params: {
    recipientName: string;
    tournamentName: string;
    prizeName: string;
    amountCents: number;
    accountLast4: string;
    receiptUrl?: string | null;
    aboutPlayer?: string | null;
  },
) {
  const siteUrl = process.env.NEXT_PUBLIC_SITE_URL ?? "http://localhost:3000";
  const settingsUrl = `${siteUrl}/settings`;
  const receiptUrl = safeHttpsUrl(params.receiptUrl);
  const last4 = params.accountLast4.replace(/\D/g, "").slice(-4);
  const about = params.aboutPlayer ?? null;

  const html = loadTemplate("prize-paid.html")
    .replace(/\{\{lead\}\}/g, escapeHtml(about ? `${about}'s prize for` : "Your prize for"))
    .replace(
      /\{\{footerReason\}\}/g,
      escapeHtml(
        about
          ? `You received this email because ${about} won a prize in a tournament`
          : "You received this email because you won a prize in a tournament",
      ),
    )
    .replace(/\{\{recipientName\}\}/g, escapeHtml(params.recipientName))
    .replace(/\{\{tournamentName\}\}/g, escapeHtml(params.tournamentName))
    .replace(/\{\{prizeName\}\}/g, escapeHtml(params.prizeName))
    .replace(/\{\{amount\}\}/g, formatRinggit(params.amountCents))
    .replace(/\{\{accountLast4\}\}/g, last4)
    .replace(/\{\{ctaUrl\}\}/g, escapeHtml(receiptUrl ?? settingsUrl))
    .replace(/\{\{ctaLabel\}\}/g, receiptUrl ? "View Receipt" : "View Settings")
    .replace(/\{\{settingsUrl\}\}/g, settingsUrl);

  const { error } = await resend.emails.send({
    from: FROM_ADDRESS,
    to: email,
    subject: about
      ? `${about}'s prize from ${params.tournamentName} has been sent`
      : `Your prize from ${params.tournamentName} has been sent`,
    html,
  });

  if (error) {
    console.error("Failed to send prize paid email:", error);
    throw new Error(`Failed to send prize paid email: ${error.message}`);
  }
}

export async function sendPrizeFundingRequestEmail(
  email: string,
  params: {
    funderName: string;
    organizerName: string;
    tournamentName: string;
    amountCents: number;
    prizeList: string;
    checkoutUrl: string;
  },
) {
  const checkoutUrl = safeHttpsUrl(params.checkoutUrl);
  if (!checkoutUrl) {
    throw new Error("Prize funding request email: the checkout link is not an https URL");
  }
  const siteUrl = process.env.NEXT_PUBLIC_SITE_URL ?? "http://localhost:3000";

  const html = loadTemplate("prize-funding-request.html")
    .replace(/\{\{funderName\}\}/g, escapeHtml(params.funderName))
    .replace(/\{\{organizerName\}\}/g, escapeHtml(params.organizerName))
    .replace(/\{\{tournamentName\}\}/g, escapeHtml(params.tournamentName))
    .replace(/\{\{amount\}\}/g, formatRinggit(params.amountCents))
    .replace(/\{\{prizeList\}\}/g, escapeHtml(params.prizeList))
    .replace(/\{\{checkoutUrl\}\}/g, escapeHtml(checkoutUrl))
    .replace(/\{\{siteUrl\}\}/g, siteUrl);

  const { error } = await resend.emails.send({
    from: FROM_ADDRESS,
    to: email,
    subject: `Prize fund payment for ${params.tournamentName}`,
    html,
  });

  if (error) {
    console.error("Failed to send prize funding request email:", error);
    throw new Error(`Failed to send prize funding request email: ${error.message}`);
  }
}

export async function sendTournamentListedEmail(
  email: string,
  params: {
    recipientName: string;
    orgName: string;
    tournamentName: string;
    tournamentUrl: string | null;
    fundedCents: number;
  },
) {
  const siteUrl = process.env.NEXT_PUBLIC_SITE_URL ?? "http://localhost:3000";

  const html = loadTemplate("tournament-listed.html")
    .replace(/\{\{recipientName\}\}/g, escapeHtml(params.recipientName))
    .replace(/\{\{orgName\}\}/g, escapeHtml(params.orgName))
    .replace(/\{\{tournamentName\}\}/g, escapeHtml(params.tournamentName))
    .replace(/\{\{amount\}\}/g, formatRinggit(params.fundedCents))
    .replace(/\{\{ctaUrl\}\}/g, escapeHtml(params.tournamentUrl ?? `${siteUrl}/my/organizations`))
    .replace(/\{\{siteUrl\}\}/g, siteUrl);

  const { error } = await resend.emails.send({
    from: FROM_ADDRESS,
    to: email,
    subject: `${params.tournamentName} is now open for registration`,
    html,
  });

  if (error) {
    console.error("Failed to send tournament listed email:", error);
    throw new Error(`Failed to send tournament listed email: ${error.message}`);
  }
}

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

export type AdminPayoutAlert = "early_request" | "awaiting_budget" | "prize_review";

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
  prize_review: {
    headline: "Prize Winners to Review",
    intro:
      "An organizer has entered prize winners for a tournament whose prizes MY Chess Tour distributes. No money moves until you approve each award.",
    subject: "Prize winners to review",
    ctaLabel: "Review Prizes",
  },
};

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

export type MemberInvitationRole = "admin" | "member";

const MEMBER_ROLE_COPY: Record<
  MemberInvitationRole,
  { label: string; summary: string }
> = {
  admin: {
    label: "an admin",
    summary:
      "create and edit tournaments, view registrations and payments, handle refunds and invite new members",
  },
  member: {
    label: "a member",
    summary: "view the organization's tournaments and registrations",
  },
};

export async function sendMemberInvitationEmail(
  email: string,
  params: {
    recipientName: string;
    inviterName: string;
    organizationName: string;
    role: MemberInvitationRole;
    invitationUrl: string;
  },
) {
  const siteUrl = process.env.NEXT_PUBLIC_SITE_URL ?? "http://localhost:3000";
  const role = MEMBER_ROLE_COPY[params.role];

  const html = loadTemplate("member-invitation.html")
    .replace(/\{\{recipientName\}\}/g, escapeHtml(params.recipientName))
    .replace(/\{\{inviterName\}\}/g, escapeHtml(params.inviterName))
    .replace(/\{\{organizationName\}\}/g, escapeHtml(params.organizationName))
    .replace(/\{\{roleLabel\}\}/g, role.label)
    .replace(/\{\{roleSummary\}\}/g, escapeHtml(role.summary))
    .replace(/\{\{invitationUrl\}\}/g, escapeHtml(params.invitationUrl))
    .replace(/\{\{siteUrl\}\}/g, siteUrl);

  const { error } = await resend.emails.send({
    from: FROM_ADDRESS,
    to: email,
    subject: `${params.inviterName} invited you to join ${params.organizationName} on MY Chess Tour`,
    html,
  });

  if (error) {
    console.error("Failed to send member invitation email:", error);
    throw new Error(`Failed to send member invitation email: ${error.message}`);
  }
}

export async function sendInvitationResponseEmail(
  email: string,
  params: {
    recipientName: string;
    inviteeName: string;
    inviteeEmail: string;
    organizationName: string;
    orgId: string;
    role: MemberInvitationRole;
    accepted: boolean;
  },
) {
  const siteUrl = process.env.NEXT_PUBLIC_SITE_URL ?? "http://localhost:3000";

  const html = loadTemplate(
    params.accepted ? "invitation-accepted.html" : "invitation-declined.html",
  )
    .replace(/\{\{recipientName\}\}/g, escapeHtml(params.recipientName))
    .replace(/\{\{inviteeName\}\}/g, escapeHtml(params.inviteeName))
    .replace(/\{\{inviteeEmail\}\}/g, escapeHtml(params.inviteeEmail))
    .replace(/\{\{organizationName\}\}/g, escapeHtml(params.organizationName))
    .replace(/\{\{roleLabel\}\}/g, MEMBER_ROLE_COPY[params.role].label)
    .replace(
      /\{\{membersUrl\}\}/g,
      `${siteUrl}/my/organizations/${encodeURIComponent(params.orgId)}/members`,
    )
    .replace(/\{\{siteUrl\}\}/g, siteUrl);

  const subject = params.accepted
    ? `${params.inviteeName} joined ${params.organizationName}`
    : `${params.inviteeName} declined your invitation to ${params.organizationName}`;

  const { error } = await resend.emails.send({
    from: FROM_ADDRESS,
    to: email,
    subject,
    html,
  });

  if (error) {
    console.error("Failed to send invitation response email:", error);
    throw new Error(`Failed to send invitation response email: ${error.message}`);
  }
}

export async function sendHelperInvitationEmail(
  email: string,
  params: {
    playerName: string;
    relationshipLabel: string;
    invitationUrl: string;
  },
) {
  const siteUrl = process.env.NEXT_PUBLIC_SITE_URL ?? "http://localhost:3000";

  const html = loadTemplate("helper-invitation.html")
    .replace(/\{\{playerName\}\}/g, escapeHtml(params.playerName))
    .replace(/\{\{relationshipLabel\}\}/g, escapeHtml(params.relationshipLabel))
    .replace(/\{\{invitationUrl\}\}/g, escapeHtml(params.invitationUrl))
    .replace(/\{\{siteUrl\}\}/g, siteUrl);

  const { error } = await resend.emails.send({
    from: FROM_ADDRESS,
    to: email,
    subject: `${params.playerName} asked you to help them on MY Chess Tour`,
    html,
  });

  if (error) {
    console.error("Failed to send helper invitation email:", error);
    throw new Error(`Failed to send helper invitation email: ${error.message}`);
  }
}

export async function sendOkuReviewEmail(
  email: string,
  params: {
    recipientName: string;
    verified: boolean;
    rejectionReason?: string;
    aboutPlayer?: string | null;
    canActInSettings?: boolean;
  },
) {
  const siteUrl = process.env.NEXT_PUBLIC_SITE_URL ?? "http://localhost:3000";
  const about = params.aboutPlayer ?? null;
  const selfService = !about && params.canActInSettings !== false;

  const template = params.verified ? "oku-verified.html" : "oku-rejected.html";

  const lead = params.verified
    ? about
      ? `We have checked ${about}'s OKU card, and their OKU status is now verified.`
      : "We have checked the OKU card you uploaded, and your OKU status is now verified."
    : about
      ? `We were unable to verify ${about}'s OKU card.`
      : "We were unable to verify the OKU card you uploaded.";

  let html = loadTemplate(template)
    .replace(/\{\{lead\}\}/g, escapeHtml(lead))
    .replace(
      /\{\{retryLine\}\}/g,
      escapeHtml(
        selfService
          ? "You can upload a new copy of your card from your settings and we will review it again."
          : `To send a new copy of ${about ? `${about}'s` : "your"} card, email ${SUPPORT_EMAIL} and we will review it again.`,
      ),
    )
    .replace(
      /\{\{ctaUrl\}\}/g,
      selfService ? `${siteUrl}/settings` : `mailto:${SUPPORT_EMAIL}`,
    )
    .replace(
      /\{\{ctaLabel\}\}/g,
      selfService ? "Upload Again" : "Contact Support",
    )
    .replace(
      /\{\{footerReason\}\}/g,
      escapeHtml(
        about
          ? `You received this email because an OKU card for ${about} was submitted for verification`
          : "You received this email because you submitted an OKU card for verification",
      ),
    )
    .replace(/\{\{recipientName\}\}/g, escapeHtml(params.recipientName))
    .replace(/\{\{settingsUrl\}\}/g, `${siteUrl}/settings`)
    .replace(/\{\{browseUrl\}\}/g, `${siteUrl}/`);

  if (!params.verified) {
    html = html.replace(
      /\{\{rejectionReason\}\}/g,
      escapeHtml(params.rejectionReason ?? ""),
    );
  }

  const subject = params.verified
    ? about
      ? `${about}'s OKU status is verified`
      : "Your OKU status is verified"
    : about
      ? `We couldn't verify ${about}'s OKU card`
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

export async function sendRegistrationConfirmationEmail(
  email: string,
  params: {
    recipientName: string;
    tournamentName: string;
    tournamentSlug: string | null;
    tournamentDates: string;
    venue: string;
    feePaidCents: number;
    aboutPlayer?: string | null;
  },
) {
  const about = params.aboutPlayer ?? null;
  const siteUrl = process.env.NEXT_PUBLIC_SITE_URL ?? "http://localhost:3000";
  const tournamentUrl = params.tournamentSlug
    ? `${siteUrl}/tournaments/${encodeURIComponent(params.tournamentSlug)}`
    : `${siteUrl}/`;

  const html = loadTemplate("registration-confirmed.html")
    .replace(
      /\{\{lead\}\}/g,
      escapeHtml(about ? `${about} is registered for` : "You are registered for"),
    )
    .replace(
      /\{\{footerReason\}\}/g,
      escapeHtml(
        about
          ? `You received this email because you look after ${about}'s entries`
          : "You received this email because you registered for a tournament",
      ),
    )
    .replace(/\{\{recipientName\}\}/g, escapeHtml(params.recipientName))
    .replace(/\{\{tournamentName\}\}/g, escapeHtml(params.tournamentName))
    .replace(/\{\{tournamentDates\}\}/g, escapeHtml(params.tournamentDates))
    .replace(/\{\{venue\}\}/g, escapeHtml(params.venue))
    .replace(
      /\{\{feePaid\}\}/g,
      params.feePaidCents > 0 ? formatRinggit(params.feePaidCents) : "Free",
    )
    .replace(/\{\{tournamentUrl\}\}/g, tournamentUrl)
    .replace(/\{\{siteUrl\}\}/g, siteUrl);

  const { error } = await resend.emails.send({
    from: FROM_ADDRESS,
    to: email,
    subject: about
      ? `${about} is registered for ${params.tournamentName}`
      : `You're registered for ${params.tournamentName}`,
    html,
  });

  if (error) {
    console.error("Failed to send registration confirmation email:", error);
    throw new Error(
      `Failed to send registration confirmation email: ${error.message}`,
    );
  }
}

export async function sendRefundOutcomeEmail(
  email: string,
  params: {
    recipientName: string;
    tournamentName: string;
    amountCents: number;
    paymentMethod: string;
    completed: boolean;
    aboutPlayer?: string | null;
  },
) {
  const siteUrl = process.env.NEXT_PUBLIC_SITE_URL ?? "http://localhost:3000";
  const about = params.aboutPlayer ?? null;
  const amount = formatRinggit(params.amountCents);

  const lead = params.completed
    ? about
      ? `The refund for ${about}'s entry to`
      : "Your refund for"
    : about
      ? `We tried to refund ${amount} for ${about}'s entry to`
      : `We tried to refund ${amount} for`;

  const html = loadTemplate(
    params.completed ? "refund-completed.html" : "refund-failed.html",
  )
    .replace(/\{\{lead\}\}/g, escapeHtml(lead))
    .replace(
      /\{\{footerReason\}\}/g,
      escapeHtml(
        about
          ? `You received this email because you paid for ${about}'s entry to`
          : "You received this email because you were registered for",
      ),
    )
    .replace(/\{\{recipientName\}\}/g, escapeHtml(params.recipientName))
    .replace(/\{\{tournamentName\}\}/g, escapeHtml(params.tournamentName))
    .replace(/\{\{amount\}\}/g, formatRinggit(params.amountCents))
    .replace(/\{\{paymentMethod\}\}/g, escapeHtml(params.paymentMethod))
    .replace(/\{\{dashboardUrl\}\}/g, `${siteUrl}/my`)
    .replace(/\{\{siteUrl\}\}/g, siteUrl);

  const subject = params.completed
    ? about
      ? `The refund for ${about}'s entry to ${params.tournamentName} is on its way`
      : `Your refund for ${params.tournamentName} is on its way`
    : about
      ? `Action needed: the refund for ${about}'s entry to ${params.tournamentName} was not completed`
      : `Action needed: your refund for ${params.tournamentName} was not completed`;

  const { error } = await resend.emails.send({
    from: FROM_ADDRESS,
    to: email,
    subject,
    html,
  });

  if (error) {
    console.error("Failed to send refund outcome email:", error);
    throw new Error(`Failed to send refund outcome email: ${error.message}`);
  }
}

export async function sendNominationResponseEmail(
  email: string,
  params: {
    recipientName: string;
    organizerOrgId: string;
    tournamentId: string;
    nomineeName: string;
    tournamentName: string;
    accepted: boolean;
  },
) {
  const siteUrl = process.env.NEXT_PUBLIC_SITE_URL ?? "http://localhost:3000";
  const tournamentUrl = `${siteUrl}/my/organizations/${encodeURIComponent(params.organizerOrgId)}/tournaments/${encodeURIComponent(params.tournamentId)}`;

  const html = loadTemplate(
    params.accepted ? "nomination-accepted.html" : "nomination-declined.html",
  )
    .replace(/\{\{recipientName\}\}/g, escapeHtml(params.recipientName))
    .replace(/\{\{nomineeName\}\}/g, escapeHtml(params.nomineeName))
    .replace(/\{\{tournamentName\}\}/g, escapeHtml(params.tournamentName))
    .replace(/\{\{tournamentUrl\}\}/g, tournamentUrl);

  const subject = params.accepted
    ? `${params.nomineeName} accepted the payout nomination for ${params.tournamentName}`
    : `${params.nomineeName} declined the payout nomination for ${params.tournamentName}`;

  const { error } = await resend.emails.send({
    from: FROM_ADDRESS,
    to: email,
    subject,
    html,
  });

  if (error) {
    console.error("Failed to send nomination response email:", error);
    throw new Error(`Failed to send nomination response email: ${error.message}`);
  }
}
