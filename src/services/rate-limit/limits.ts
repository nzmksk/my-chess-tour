export interface RateLimitRule {
  windowSeconds: number;
  perUser?: number;
  perIp?: number;
  perIpSignedOut?: number;
  failClosed?: boolean;
  message: string;
}

const MINUTE = 60;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

export const RATE_LIMITS = {
  api: {
    windowSeconds: MINUTE,
    perUser: 120,
    message: "You're making requests too quickly.",
  },

  signup: {
    windowSeconds: 10 * MINUTE,
    perIp: 30,
    failClosed: true,
    message: "Too many attempts.",
  },

  memberInvite: {
    windowSeconds: HOUR,
    perUser: 30,
    perIp: 60,
    message: "You've sent a lot of invitations in a short time.",
  },
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

  checkout: {
    windowSeconds: 10 * MINUTE,
    perUser: 10,
    perIp: 30,
    message: "You've tried to register several times in a short time.",
  },
  fideLookup: {
    windowSeconds: HOUR,
    perUser: 10,
    message: "You've looked up several FIDE IDs in a short time.",
  },
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
