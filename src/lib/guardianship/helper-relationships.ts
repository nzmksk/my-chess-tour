export const HELPER_RELATIONSHIPS = [
  "carer",
  "parent",
  "coach",
  "other",
] as const;
export type HelperRelationship = (typeof HELPER_RELATIONSHIPS)[number];

export const HELPER_RELATIONSHIP_LABELS: Record<HelperRelationship, string> = {
  carer: "carer",
  parent: "parent",
  coach: "coach",
  other: "helper",
};

export function isHelperRelationship(
  value: unknown,
): value is HelperRelationship {
  return (
    typeof value === "string" &&
    (HELPER_RELATIONSHIPS as readonly string[]).includes(value)
  );
}
