export const MAX_DEPENDENT_NAME_LENGTH = 100;

export const CONTACT_EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export const GUARDIANSHIP_RELATIONSHIPS = [
  "parent",
  "legal_guardian",
  "carer",
  "coach",
  "other",
] as const;
export type GuardianshipRelationship =
  (typeof GUARDIANSHIP_RELATIONSHIPS)[number];

export const MINOR_RELATIONSHIPS: readonly GuardianshipRelationship[] = [
  "parent",
  "legal_guardian",
];

export const ADULT_HELPER_RELATIONSHIPS: readonly GuardianshipRelationship[] = [
  "carer",
  "parent",
  "coach",
  "other",
];

export const RELATIONSHIP_LABELS: Record<GuardianshipRelationship, string> = {
  parent: "Parent",
  legal_guardian: "Legal guardian",
  carer: "Carer",
  coach: "Coach",
  other: "Other",
};

export const GUARDIANSHIP_BASES = ["minor", "authorised", "appointed"] as const;
export type GuardianshipBasis = (typeof GUARDIANSHIP_BASES)[number];
