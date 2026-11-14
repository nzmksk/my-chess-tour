// Fan-out helpers shared by every notification that emails a group of people
// after the action it reports on has committed (payouts, reviews, nominations).

export interface EmailRecipient {
  email: string;
  name: string;
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
