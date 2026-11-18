/**
 * Every per-route rate limit, in one place so they are easy to tune (#613).
 *
 * A rule counts each request in a fixed window against every bucket that
 * applies to it, and refuses it with 429 once any bucket is over:
 * - `perUser`        keyed by the signed-in user's id
 * - `perIp`          keyed by client IP, signed in or not
 * - `perIpSignedOut` keyed by client IP, only when nobody is signed in (a
 *                    signed-out caller can't be told apart from the next one)
 * Sensitive routes set both a user and an IP budget, so neither a fresh
 * account nor a fresh IP buys a fresh allowance on its own.
 *
 * A Redis outage lets requests through (logged to Sentry) unless the rule says
 * `failClosed`: the auth routes, where an unlimited endpoint is the bigger risk.
 *
 * Not limited here: /api/v1/webhooks/* (CHIP calls those) and /api/v1/cron/*
 * (bearer-authenticated with CRON_SECRET).
 */
export interface RateLimitRule {
  windowSeconds: number;
  perUser?: number;
  perIp?: number;
  perIpSignedOut?: number;
  failClosed?: boolean;
  /** Shown to the user; "Please try again in …" is appended. */
  message: string;
}

const MINUTE = 60;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

export const RATE_LIMITS = {
  // ── Auth ──────────────────────────────────────────────────────────────────
  // Signup and verification-code requests, per IP: generous enough for bulk
  // signups behind one shared IP, low enough to make probing which emails are
  // registered impractical.
  signup: {
    windowSeconds: 10 * MINUTE,
    perIp: 30,
    failClosed: true,
    message: "Too many attempts.",
  },

  // ── Email to addresses a user typed in ────────────────────────────────────
  // Each of these sends real mail from our domain, so an unlimited route would
  // let one account spam any inbox and burn our sender reputation.
  memberInvite: {
    windowSeconds: HOUR,
    perUser: 30,
    perIp: 60,
    message: "You've sent a lot of invitations in a short time.",
  },
  // Prize funders' payment links: saving contacts on a tournament that is
  // already asking for money, and the organizer's Retry, share this bucket.
  funderLinks: {
    windowSeconds: HOUR,
    perUser: 30,
    perIp: 60,
    message: "You've sent a lot of payment links in a short time.",
  },
  payoutNomination: {
    windowSeconds: HOUR,
    perUser: 20,
    perIp: 40,
    message: "You've changed payout nominations several times in a short time.",
  },

  // ── Costly side effects ───────────────────────────────────────────────────
  // Every checkout creates a CHIP purchase and holds a seat.
  checkout: {
    windowSeconds: 10 * MINUTE,
    perUser: 10,
    perIp: 30,
    message: "You've tried to register several times in a short time.",
  },
  // A new FIDE ID is looked up on fide.com.
  fideLookup: {
    windowSeconds: HOUR,
    perUser: 10,
    message: "You've looked up several FIDE IDs in a short time.",
  },
  // Profile and organization saves, which also record uploaded avatars.
  profileSave: {
    windowSeconds: 10 * MINUTE,
    perUser: 30,
    message: "You've saved your profile several times in a short time.",
  },
  organizationSave: {
    windowSeconds: 10 * MINUTE,
    perUser: 30,
    message: "You've saved these settings several times in a short time.",
  },
  okuDocument: {
    windowSeconds: DAY,
    perUser: 5,
    message: "You've submitted several OKU documents today.",
  },
  organizerApplication: {
    windowSeconds: DAY,
    perUser: 5,
    perIp: 10,
    message: "You've submitted several applications today.",
  },
  // In-app bug reports (#616) become public issues on GitHub, so this fails
  // closed: a briefly unavailable form beats an unlimited one.
  feedback: {
    windowSeconds: HOUR,
    perUser: 5,
    perIp: 10,
    perIpSignedOut: 3,
    failClosed: true,
    message: "You've sent several reports in a short time.",
  },
} as const satisfies Record<string, RateLimitRule>;

export type RateLimitName = keyof typeof RATE_LIMITS;
