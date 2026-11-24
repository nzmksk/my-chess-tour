import { supabaseAdmin } from "@/services/supabase/admin";
import { addRecipient, type EmailRecipient } from "@/services/email/recipients";

export interface ParticipantRecipients {
  participantName: string;
  recipients: Map<string, EmailRecipient>;
  participantAddresses: Set<string>;
}

interface ParticipantRow {
  email: string | null;
  contact_email: string | null;
  first_name: string | null;
  last_name: string | null;
  account_type: "self" | "managed";
}

interface GuardianRow {
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

export async function loadParticipantRecipients(
  participantId: string,
): Promise<ParticipantRecipients | null> {
  const [participant, guardians] = await Promise.all([
    supabaseAdmin
      .from("users")
      .select("email, contact_email, first_name, last_name, account_type")
      .eq("id", participantId)
      .maybeSingle(),
    supabaseAdmin
      .from("guardianships")
      .select("guardian:users!guardian_user_id(email, first_name)")
      .eq("dependent_user_id", participantId)
      .eq("status", "active"),
  ]);
  if (participant.error || guardians.error || !participant.data) {
    console.error(
      `User ${participantId}: failed to load who to email`,
      participant.error?.message ?? guardians.error?.message,
    );
    return null;
  }

  const row = participant.data as ParticipantRow;
  const recipients = new Map<string, EmailRecipient>();
  for (const { guardian } of (guardians.data ??
    []) as unknown as GuardianRow[]) {
    addRecipient(recipients, guardian?.email, guardian?.first_name);
  }

  const participantAddresses = new Set<string>();
  const ownAddresses =
    row.account_type === "managed" ? [row.contact_email] : [row.email];
  for (const address of ownAddresses) {
    if (!address || recipients.has(address.toLowerCase())) continue;
    addRecipient(recipients, address, row.first_name);
    participantAddresses.add(address.toLowerCase());
  }

  return { participantName: fullName(row), recipients, participantAddresses };
}
