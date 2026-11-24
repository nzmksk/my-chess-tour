import { supabaseAdmin } from "@/services/supabase/admin";
import { addRecipient, type EmailRecipient } from "@/services/email/recipients";

export interface ParticipantRecipients {
  participantName: string;
  recipients: Map<string, EmailRecipient>;
  participantAddresses: Set<string>;
}

interface ParticipantRow {
  id: string;
  email: string | null;
  contact_email: string | null;
  first_name: string | null;
  last_name: string | null;
  account_type: "self" | "managed";
}

interface GuardianRow {
  dependent_user_id: string;
  guardian: { email: string | null; first_name: string | null } | null;
}

export function fullName(
  person: { first_name: string | null; last_name: string | null } | null,
): string {
  return (
    [person?.first_name, person?.last_name].filter(Boolean).join(" ") ||
    "your player"
  );
}

export function nameForRecipient(
  contacts: ParticipantRecipients,
  recipient: EmailRecipient,
): string | null {
  return contacts.participantAddresses.has(recipient.email.toLowerCase())
    ? null
    : contacts.participantName;
}

function recipientsFor(
  participant: ParticipantRow,
  guardians: GuardianRow[],
): ParticipantRecipients {
  const recipients = new Map<string, EmailRecipient>();
  for (const { guardian } of guardians) {
    addRecipient(recipients, guardian?.email, guardian?.first_name);
  }

  const participantAddresses = new Set<string>();
  const own =
    participant.account_type === "managed"
      ? participant.contact_email
      : participant.email;
  if (own && !recipients.has(own.toLowerCase())) {
    addRecipient(recipients, own, participant.first_name);
    participantAddresses.add(own.toLowerCase());
  }

  return {
    participantName: fullName(participant),
    recipients,
    participantAddresses,
  };
}

export async function loadParticipantRecipientsFor(
  participantIds: string[],
): Promise<Map<string, ParticipantRecipients> | null> {
  const ids = [...new Set(participantIds)];
  if (ids.length === 0) return new Map();

  const [participants, guardians] = await Promise.all([
    supabaseAdmin
      .from("users")
      .select("id, email, contact_email, first_name, last_name, account_type")
      .in("id", ids),
    supabaseAdmin
      .from("guardianships")
      .select(
        "dependent_user_id, guardian:users!guardian_user_id(email, first_name)",
      )
      .in("dependent_user_id", ids)
      .eq("status", "active"),
  ]);
  if (participants.error || guardians.error) {
    console.error(
      "Failed to load who to email about these players",
      participants.error?.message ?? guardians.error?.message,
    );
    return null;
  }

  const guardiansOf = new Map<string, GuardianRow[]>();
  for (const row of (guardians.data ?? []) as unknown as GuardianRow[]) {
    const list = guardiansOf.get(row.dependent_user_id) ?? [];
    list.push(row);
    guardiansOf.set(row.dependent_user_id, list);
  }

  const result = new Map<string, ParticipantRecipients>();
  for (const participant of (participants.data ?? []) as ParticipantRow[]) {
    result.set(
      participant.id,
      recipientsFor(participant, guardiansOf.get(participant.id) ?? []),
    );
  }
  return result;
}

export async function loadParticipantRecipients(
  participantId: string,
): Promise<ParticipantRecipients | null> {
  const contacts = (await loadParticipantRecipientsFor([participantId]))?.get(
    participantId,
  );
  if (!contacts) {
    console.error(`User ${participantId}: failed to load who to email`);
    return null;
  }
  return contacts;
}
