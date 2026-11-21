export interface EmailRecipient {
  email: string;
  name: string;
}

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
