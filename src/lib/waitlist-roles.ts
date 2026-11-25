export const WAITLIST_ROLES = [
  { value: "player", label: "Player" },
  { value: "organizer", label: "Organizer / Chess club / Chess academy" },
  { value: "parent", label: "Parent" },
  { value: "coach", label: "Coach" },
  { value: "arbiter", label: "Arbiter" },
  { value: "other", label: "Other" },
] as const;

export type WaitlistRole = (typeof WAITLIST_ROLES)[number]["value"];

export function isWaitlistRole(value: unknown): value is WaitlistRole {
  return WAITLIST_ROLES.some((role) => role.value === value);
}
