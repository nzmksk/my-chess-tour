// The versions of the documents a user or an organization can be bound by, and
// the one place that decides what "current" means.
//
// Acceptance used to be a checkbox and nothing else: the signup form validated
// termsAccepted client-side and threw it away, so there was no record that
// anyone had agreed to anything and no version pinned to the agreement they saw.
// Tolerable for a free signup; not for a document that governs money movement
// and makes a claw-back enforceable.
//
// Every legal surface renders its effective date from the same constant that
// gets written to the database, so the rendered document and the recorded
// version cannot drift apart. Before this module the date was a hardcoded
// literal in four files, which is exactly the drift this prevents.
//
// Bumping a constant IS the re-acceptance mechanism. An organization whose
// agreement_version is older than ORGANIZER_AGREEMENT_VERSION is shown a
// blocking panel, and the payout machinery (Phases 5-6) refuses to move money
// until it matches — a stale agreement stops a payout rather than failing
// silently.
//
// The values are date-stamped rather than semver: a legal document has an
// effective date, not a feature level, and "which wording did they agree to?"
// is answered by a date. varchar(20) in the schema; ISO first so string
// comparison and chronological order agree.
//
// Each document is a HISTORY, not a bare constant, and the current version is
// derived from the newest entry so the two cannot disagree. The history exists
// because "what changed?" is a question about the gap between the version
// someone accepted and the current one — not about whatever the last release
// happened to touch. A notice that hardcodes one release's changes is wrong for
// everyone who skipped a version, and silently rots the moment the next version
// ships.
//
// Both documents are at their FIRST version. Nothing has been published, so
// there is no earlier wording anyone could have agreed to and nothing to diff
// against — the entries below summarise what each document says, which is the
// honest answer to the only question a reader can have today. The second entry
// added to either list is a delta against the one before it.

export interface LegalVersion {
  /** Effective date, ISO. This is the value stored in the database. */
  version: string;
  /**
   * Written for the person who has to read it, not as a commit log.
   *
   * The FIRST version of a document summarises what the document says, because
   * there is nothing to compare it to. Every version after it lists what that
   * version changed relative to the one before.
   */
  changes: readonly string[];
}

/**
 * Terms of Service, newest first. Accepted at signup; stored on
 * users.terms_version.
 */
export const TERMS_HISTORY: readonly LegalVersion[] = [
  {
    version: "2026-08-02",
    changes: [
      "You must be at least 13 years old, or have a parent's consent, and your name must match your MyKad or passport — it is used for official tournament records and FIDE/MCF registration.",
      "Tournaments follow the FIDE Laws of Chess. You agree to abide by the arbiter's decisions, to compete without computer assistance, and to accept results as final unless you appeal within the time the arbiter sets.",
      "Entry fees are collected by MY Chess Tour on the organiser's behalf and paid out to them under a written Organizer Agreement.",
      "Your entry fee pays for running the event — venue, arbiters, equipment and rating fees. It is not a stake, and no part of it is paid out to another player as prize money. Prize money is funded separately by the organiser, a sponsor or a grant.",
      "MY Chess Tour collects a platform service fee of up to 10%. The total you pay is always shown in full before you pay, in Malaysian Ringgit.",
      "If an event is cancelled with our approval, every confirmed player is refunded in full, including the service fee. Refunds outside a cancellation follow the organiser's policy shown at registration.",
      "Organising tournaments requires an approved organization and acceptance of the versioned Organizer Agreement. Nothing in that agreement reduces our obligations to players.",
      "A code of conduct covering respect, harassment, cheating and rating manipulation, enforced by suspension, disqualification, or reporting to the MCF and FIDE.",
      "Platform content is ours or licensed to us, liability is limited as far as Malaysian law permits, and disputes are governed by Malaysian law in the courts of Kuala Lumpur.",
      "Privacy Policy: what we collect (account, player profile, financial, business verification and tournament data), how long we keep it, and your rights under the PDPA.",
      "Privacy Policy: how your data is protected. It is transmitted over HTTPS, held on encrypted storage with row-level access control, and bank numbers are masked in our change logs — but individual fields are not separately encrypted, and we would rather say so plainly than overstate it.",
      "Privacy Policy: who your data is shared with — FIDE and the MCF for rating and registration, organisers for pairing, and CHIP as our payment processor. Business verification documents are not shared with third parties.",
    ],
  },
];

/**
 * Organizer Agreement, newest first. Accepted when applying to organize and
 * again whenever a new version is published; stored on
 * organizations.agreement_version.
 */
export const ORGANIZER_AGREEMENT_HISTORY: readonly LegalVersion[] = [
  {
    version: "2026-08-02",
    changes: [
      "Entry fees are an administration fee for running the event. They never fund prizes, and every declared prize must name an external source — a sponsor, a grant, or your own funds.",
      "Commission is up to 10%, and you choose per tournament how much your organization absorbs against how much is added to the player's price.",
      "Payouts are your net revenue in full, disbursed automatically three days after the tournament's final scheduled session in the venue's timezone. MYR only, minimum RM 10.",
      "Early payouts are capped at 50% of net revenue, limited to two per tournament, available only after registration closes, and granted at the platform's discretion.",
      "Early payouts are advances: if a tournament is later cancelled or refunded, the shortfall is repayable.",
      "You may nominate another approved organization to receive a payout, but you remain fully liable regardless of who is paid.",
      "On an approved cancellation, every confirmed player is refunded in full including commission, and your revenue for that tournament goes to zero.",
      "Entry fees and prizes lock once a player has paid; everything else locks at tournament start.",
      "Bank details and verification documents are your responsibility, and failed transfers caused by wrong details are your cost.",
    ],
  },
];

/** The version currently in force. Derived, so it cannot drift from the history. */
export const TERMS_VERSION = TERMS_HISTORY[0].version;

/** The version currently in force. Derived, so it cannot drift from the history. */
export const ORGANIZER_AGREEMENT_VERSION =
  ORGANIZER_AGREEMENT_HISTORY[0].version;

/**
 * What changed between the version someone accepted and the current one.
 *
 * Takes the version they are ON, and returns the changes from every version
 * published since — so a reader who skipped two versions is told about both,
 * and a reader who is already current is told nothing. A null `acceptedVersion`
 * (accepted before we recorded versions, or never accepted) returns the whole
 * history, which is the honest answer to "what am I agreeing to?".
 *
 * Newest changes first, matching the order of the history itself.
 */
export function changesSince(
  history: readonly LegalVersion[],
  acceptedVersion: string | null,
): string[] {
  const relevant =
    acceptedVersion === null
      ? history
      : // ISO dates compare correctly as strings, which is why the format is ISO.
        history.filter((entry) => entry.version > acceptedVersion);

  return relevant.flatMap((entry) => [...entry.changes]);
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

/**
 * Renders a version constant as the human date shown under a document's title —
 * "2026-08-02" becomes "2 August 2026".
 *
 * Deliberately not Intl.DateTimeFormat: these strings are calendar dates, not
 * instants, and parsing one into a Date would read it in the server's zone and
 * can shift the day. Returns the input unchanged if it isn't date-shaped, so a
 * malformed constant shows up in the page rather than throwing during render.
 */
export function formatLegalVersion(version: string): string {
  const match = LEGAL_VERSION_PATTERN.exec(version);
  if (!match) return version;

  const [, year, month, day] = match;
  const monthName = MONTHS[Number(month) - 1];
  if (!monthName) return version;

  return `${Number(day)} ${monthName} ${year}`;
}
