export interface RegistrationStatus {
  effectiveClose: Date;
  isClosed: boolean;
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
