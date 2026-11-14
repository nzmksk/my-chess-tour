// Fan-out helpers shared by every notification that emails a group of people
// after the action it reports on has committed (payouts, reviews, nominations).

export interface EmailRecipient {
  email: string;
  name: string;
}

/**
 * Adds a recipient keyed by lowercased address, keeping the first entry for an
 * address so a person reached two ways (e.g. a member who is also the
 * organization's contact address) is emailed once, by their own name.
 */
export function addRecipient(
  recipients: Map<string, EmailRecipient>,
  email: string | null | undefined,
  name: string | null | undefined,
): void {
  if (!email) return;
  const key = email.toLowerCase();
  if (recipients.has(key)) return;
  recipients.set(key, { email, name: name ?? "there" });
}

/**
 * Sends one email per recipient, best-effort, and logs any that failed. Never
 * throws: the caller's action has already happened.
 */
export async function sendToAll(
  recipients: Map<string, EmailRecipient>,
  send: (recipient: EmailRecipient) => Promise<unknown>,
  context: string,
): Promise<void> {
  const results = await Promise.allSettled([...recipients.values()].map(send));
  const failures = results.flatMap((r) =>
    r.status === "rejected"
      ? [r.reason instanceof Error ? r.reason.message : String(r.reason)]
      : [],
  );
  if (failures.length > 0) {
    console.error(
      `Failed to send ${failures.length}/${recipients.size} ${context}`,
      failures,
    );
  }
}
