export interface LegalVersion {
  version: string;
  changes: readonly string[];
}

export const TERMS_HISTORY: readonly LegalVersion[] = [
  {
    version: "2026-11-24",
    changes: [
      "Accounts you hold yourself are for people aged 18 and over. Someone under 18 takes part only as a dependent of a parent or legal guardian, who accepts these terms for them and is responsible for their use of the platform, including payments. An adult player may authorise a helper to act as their agent, and stays the party to these terms. A legally appointed guardian may act for an adult who lacks capacity. Your name must match your MyKad or passport — it is used for official tournament records and FIDE/MCF registration.",
      "Tournaments follow the FIDE Laws of Chess. You agree to abide by the arbiter's decisions, to compete without computer assistance, and to accept results as final unless you appeal within the time the arbiter sets.",
      "Entry fees are collected by MY Chess Tour on the organiser's behalf and paid out to them under a written Organizer Agreement.",
      "Your entry fee pays for running the event — venue, arbiters, equipment and rating fees. It is not a stake, and no part of it is paid out to another player as prize money.",
      "Prizes are set by the organiser, shown on the event page and funded by the organiser, a sponsor or a grant. They are awarded on the arbiter's certified results, and a disqualified player, or one who entered a category on inaccurate profile details, is not entitled to one. The organiser pays its own winners unless it appoints MY Chess Tour, in which case the pool is fully funded before the event is listed and we pay winners by bank transfer. A prize won by a player under 18 is paid to their parent or legal guardian; an adult's is paid to their own bank account, even when someone acts for them. A prize we distribute that is unclaimed twelve months after the event is forfeited and returned to its funders. Prizes are paid in Malaysian Ringgit, and any tax due on them is yours.",
      "MY Chess Tour collects a platform service fee of up to 10%. The total you pay is always shown in full before you pay, in Malaysian Ringgit.",
      "If an event is cancelled with our approval, every confirmed player is refunded in full, including the service fee. Refunds outside a cancellation follow the organiser's policy shown at registration.",
      "Organising tournaments requires an approved organization and acceptance of the versioned Organizer Agreement. Nothing in that agreement reduces our obligations to players.",
      "A code of conduct covering respect, harassment, cheating and rating manipulation, enforced by suspension, disqualification, or reporting to the MCF and FIDE.",
      "Platform content is ours or licensed to us, liability is limited as far as Malaysian law permits, and disputes are governed by Malaysian law and heard in the courts of Malaysia.",
      "Privacy Policy: what we collect (account, player profile, financial, business verification and tournament data), how long we keep it, and your rights under the PDPA. Your date of birth is asked for when you sign up, to confirm you are 18 or over. Change history is deleted after 1 year (for a registration never paid, 30 days after the tournament's registration closes), except where it concerns money, which is kept for 7 years.",
      "Privacy Policy: your OKU card (health data) and your bank details (financial data) are each collected only with their own explicit consent, a separate checkbox shown when you give us that data and never part of accepting these terms. You can withdraw either at any time in Settings, which deletes the OKU card or removes the bank details.",
      "Privacy Policy: a guardian or helper who gives us someone else's data, such as their date of birth, disability status or OKU card, confirms they have the authority to. A child's data is provided and managed by their parent or legal guardian, who gives any separate consent and exercises the child's PDPA rights for them.",
      "Privacy Policy: how your data is protected. All of it, your bank details and documents included, is encrypted in transit (HTTPS) and at rest, with access controlled row by row. Once saved, your full bank account number is never shown again — only its last 4 digits — and it is masked in our change logs.",
      "Privacy Policy: who your data is shared with — FIDE and the MCF for rating and registration, the organisers of tournaments you enter (your name, title, FIDE/MCF IDs and ratings, gender, date of birth, nationality and whether you are verified OKU — never your OKU card or contact details) for pairing, categories and special prizes, CHIP as our payment processor, Sentry for error monitoring (servers in the United States; reports deleted after 30 days), and PostHog for usage analytics (no cookies, not linked to your account; servers in the United States; deleted after 1 year). Business verification documents are not shared with third parties.",
    ],
  },
];

export const ORGANIZER_AGREEMENT_HISTORY: readonly LegalVersion[] = [
  {
    version: "2026-11-20",
    changes: [
      "Entry fees are an administration fee for running the event. They never fund prizes, and every declared prize must name an external source — a sponsor, a grant, or your own funds.",
      "Commission is up to 10%, and you choose per tournament how much your organization absorbs against how much is added to the player's price.",
      "Payouts are your net revenue in full, disbursed automatically three days after the tournament's final scheduled session in the venue's timezone. MYR only, minimum RM 10.",
      "Early payouts are capped at 50% of net revenue, limited to two per tournament, available even while registration is still open, and granted at the platform's discretion.",
      "Early payouts are advances: if a tournament is later cancelled or refunded, the shortfall is repayable, and if a significant amount is not repaid on demand we may take legal action to recover it.",
      "You may nominate another approved organization to receive a payout, but you remain fully liable regardless of who is paid.",
      "If you appoint MY Chess Tour to distribute a sponsor-funded prize pool, each funder is sent a payment request when you publish, the tournament is listed and opens for registration only once the pool is fully funded, each winner you enter is reviewed before payment, and anything not awarded is returned to the funders pro rata.",
      "On an approved cancellation, every confirmed player is refunded in full including commission, and your revenue for that tournament goes to zero.",
      "Entry fees and prizes lock once a player has paid; everything else locks at tournament start.",
      "Bank details and verification documents are your responsibility, and failed transfers caused by wrong details are your cost.",
    ],
  },
];

export const TERMS_VERSION = TERMS_HISTORY[0].version;

export const ORGANIZER_AGREEMENT_VERSION =
  ORGANIZER_AGREEMENT_HISTORY[0].version;

export function changesSince(
  history: readonly LegalVersion[],
  acceptedVersion: string | null,
): string[] {
  const relevant =
    acceptedVersion === null
      ? history
      : history.filter((entry) => entry.version > acceptedVersion);

  return relevant.flatMap((entry) => [...entry.changes]);
}

export type SensitiveDataCategory = "health" | "financial";

export interface ConsentVersion {
  version: string;
  statement: string;
}

export const SENSITIVE_DATA_CONSENT_HISTORY: Readonly<
  Record<SensitiveDataCategory, readonly ConsentVersion[]>
> = {
  health: [
    {
      version: "2026-11-19",
      statement:
        "I consent to MY Chess Tour processing my OKU card and disability status to verify me for OKU fee tiers, categories and special prizes. Only platform reviewers see my card. Organisers of tournaments I enter see only that I am verified OKU. I can withdraw this consent at any time, which deletes my card and removes my OKU verification.",
    },
  ],
  financial: [
    {
      version: "2026-11-19",
      statement:
        "I consent to MY Chess Tour storing my bank name, account holder name and account number to pay me prizes, and sharing them with CHIP, its payment processor, to verify the account and make the transfer. Organisers never see them. I can withdraw this consent at any time by removing my bank details, which deletes them. For an account a prize was sent to, only the bank, account holder name and last 4 digits are kept, for 7 years, as the law requires.",
    },
  ],
};

export function currentConsent(
  category: SensitiveDataCategory,
): ConsentVersion {
  return SENSITIVE_DATA_CONSENT_HISTORY[category][0];
}

export type ConsentBasis = "minor" | "authorised" | "appointed";

export const ON_BEHALF_CONSENT_HISTORY: Readonly<
  Record<
    SensitiveDataCategory,
    Readonly<Record<ConsentBasis, readonly ConsentVersion[]>>
  >
> = {
  health: {
    minor: [
      {
        version: "2026-11-24",
        statement:
          "As this player's parent or legal guardian, I consent on their behalf to MY Chess Tour processing their OKU card and disability status to verify them for OKU fee tiers, categories and special prizes. Only platform reviewers see the card. Organisers of tournaments they enter see only that they are verified OKU. I can withdraw this consent at any time, which deletes the card and removes their OKU verification.",
      },
    ],
    authorised: [
      {
        version: "2026-11-24",
        statement:
          "This player has agreed to MY Chess Tour processing their OKU card and disability status to verify them for OKU fee tiers, categories and special prizes, and has asked me to record that for them. Only platform reviewers see the card. Organisers of tournaments they enter see only that they are verified OKU. They can withdraw this consent at any time, themselves or through me, which deletes the card and removes their OKU verification.",
      },
    ],
    appointed: [
      {
        version: "2026-11-24",
        statement:
          "As this player's legally appointed guardian, I consent on their behalf to MY Chess Tour processing their OKU card and disability status to verify them for OKU fee tiers, categories and special prizes. Only platform reviewers see the card. Organisers of tournaments they enter see only that they are verified OKU. I can withdraw this consent at any time, which deletes the card and removes their OKU verification.",
      },
    ],
  },
  financial: {
    minor: [
      {
        version: "2026-11-24",
        statement:
          "As this player's parent or legal guardian, I consent on their behalf to MY Chess Tour storing the bank name, account holder name and account number I give for their prizes, and sharing them with CHIP, its payment processor, to verify the account and make the transfer. Organisers never see them. I can withdraw this consent at any time by removing the bank details, which deletes them. For an account a prize was sent to, only the bank, account holder name and last 4 digits are kept, for 7 years, as the law requires.",
      },
    ],
    authorised: [
      {
        version: "2026-11-24",
        statement:
          "This player has agreed to MY Chess Tour storing their bank name, account holder name and account number to pay them prizes, and sharing them with CHIP, its payment processor, to verify the account and make the transfer, and has asked me to record that for them. Organisers never see them. They can withdraw this consent at any time, themselves or through me, by removing the bank details, which deletes them. For an account a prize was sent to, only the bank, account holder name and last 4 digits are kept, for 7 years, as the law requires.",
      },
    ],
    appointed: [
      {
        version: "2026-11-24",
        statement:
          "As this player's legally appointed guardian, I consent on their behalf to MY Chess Tour storing their bank name, account holder name and account number to pay them prizes, and sharing them with CHIP, its payment processor, to verify the account and make the transfer. Organisers never see them. I can withdraw this consent at any time by removing the bank details, which deletes them. For an account a prize was sent to, only the bank, account holder name and last 4 digits are kept, for 7 years, as the law requires.",
      },
    ],
  },
};

export function onBehalfConsent(
  category: SensitiveDataCategory,
  basis: ConsentBasis,
): ConsentVersion {
  return ON_BEHALF_CONSENT_HISTORY[category][basis][0];
}

export function isSensitiveDataCategory(
  value: unknown,
): value is SensitiveDataCategory {
  return value === "health" || value === "financial";
}

const LEGAL_VERSION_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/;

const MONTHS = [
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December",
] as const;

export function formatLegalVersion(version: string): string {
  const match = LEGAL_VERSION_PATTERN.exec(version);
  if (!match) return version;

  const [, year, month, day] = match;
  const monthName = MONTHS[Number(month) - 1];
  if (!monthName) return version;

  return `${Number(day)} ${monthName} ${year}`;
}
