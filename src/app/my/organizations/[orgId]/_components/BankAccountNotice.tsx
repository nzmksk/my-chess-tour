import Link from "next/link";

export type BankAccountStatus = "pending" | "verified" | "rejected";

interface Props {
  organizationId: string;
  /** NULL when the organization has no active bank account at all. */
  bankAccount: { status: BankAccountStatus; rejection_reason: string | null } | null;
}

/**
 * Tells an organizer whether their payout destination is actually usable.
 *
 * Three distinct states, deliberately, rather than one "not verified" warning:
 * verification is performed by CHIP Send (Phase 4, #519), so until that ships
 * every account sits at 'pending' indefinitely. A single warning would nag
 * every organizer about a thing none of them can fix, and would train them to
 * ignore the one case that IS actionable.
 *
 *   missing  — actionable, warning. No payout can be made at all.
 *   pending  — informational. Nothing to do but wait.
 *   rejected — actionable, warning, with the reason.
 *   verified — renders nothing.
 *
 * Rendered on the dashboard beneath the agreement gate, the other thing that
 * silently stops money.
 */
export default function BankAccountNotice({
  organizationId,
  bankAccount,
}: Props) {
  if (bankAccount?.status === "verified") return null;

  const settingsHref = `/my/organizations/${organizationId}/settings`;

  if (!bankAccount) {
    return (
      <section className="border-warning/40 bg-warning/10 mb-8 rounded-md border p-5">
        <h2 className="font-cinzel text-text-primary mb-2 text-base font-bold tracking-wide">
          No payout bank account
        </h2>
        <p className="font-lato text-text-secondary mb-4 text-sm">
          This organization has no bank account on file, so its entry-fee
          revenue cannot be paid out.
        </p>
        <Link href={settingsHref} className="btn-primary rounded-md">
          Add bank account
        </Link>
      </section>
    );
  }

  if (bankAccount.status === "rejected") {
    return (
      <section className="border-danger-border bg-danger-bg mb-8 rounded-md border p-5">
        <h2 className="font-cinzel text-text-primary mb-2 text-base font-bold tracking-wide">
          Payout bank account rejected
        </h2>
        <p className="font-lato text-text-secondary mb-4 text-sm">
          {bankAccount.rejection_reason ||
            "Your bank details could not be verified. Check them against your bank's records and save them again."}
        </p>
        <Link href={settingsHref} className="btn-primary rounded-md">
          Update bank account
        </Link>
      </section>
    );
  }

  return (
    <section className="border-border bg-bg-raised mb-8 rounded-md border p-5">
      <p className="font-lato text-text-secondary text-sm">
        Your payout bank account is awaiting verification. Nothing is needed
        from you — we&apos;ll confirm it before your first payout is due.{" "}
        <Link href={settingsHref} className="modal-trigger-link">
          Review the details
        </Link>
      </p>
    </section>
  );
}
