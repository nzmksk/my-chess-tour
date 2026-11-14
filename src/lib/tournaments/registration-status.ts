/**
 * Registration open/closed derivation.
 *
 * `registration_closed_at` is the effective moment registration closes. It is
 * populated at publish with the value of `registration_deadline` and only moved
 * *earlier* when the organizer manually closes registration early. Drafts have
 * it NULL, so callers pass the deadline as the fallback.
 *
 * Because a defaulted `registration_closed_at` always equals the deadline, the
 * "was it closed early?" question is derived — `closed_at < deadline` — rather
 * than "is it non-null?". Keep this the single source of that logic so the many
 * read-sites (public detail, checkout, organizer manage, close guard) stay
 * consistent.
 */

export interface RegistrationStatus {
  /** The instant registration closes — `closedAt` if set, else the deadline. */
  effectiveClose: Date;
  /** True once `now` has reached (or passed) the effective close time. */
  isClosed: boolean;
  /** True only when the organizer closed early, i.e. `closedAt < deadline`. */
  closedEarly: boolean;
}

export function registrationStatus(
  closedAt: string | null | undefined,
  deadline: string,
  now: Date = new Date(),
): RegistrationStatus {
  const deadlineDate = new Date(deadline);
  const effectiveClose = closedAt ? new Date(closedAt) : deadlineDate;
  const closedEarly = closedAt != null && new Date(closedAt) < deadlineDate;

  return {
    effectiveClose,
    isClosed: now >= effectiveClose,
    closedEarly,
  };
}
