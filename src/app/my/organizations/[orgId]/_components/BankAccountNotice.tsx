import type { JSX } from "react";
import Link from "next/link";
import type { BankAccountStatus } from "@/services/payouts/bank-account";

interface Props {
  organizationId: string;
  bankAccount: { status: BankAccountStatus; rejection_reason: string | null } | null;
}

export default function BankAccountNotice({
  organizationId,
  bankAccount,
}: Props): JSX.Element | null {
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

  switch (bankAccount.status) {
    case "verified":
      return null;

    case "rejected":
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

    case "name_mismatch":
      return (
        <section className="border-warning/40 bg-warning/10 mb-8 rounded-md border p-5">
          <h2 className="font-cinzel text-text-primary mb-2 text-base font-bold tracking-wide">
            Payout bank account under review
          </h2>
          <p className="font-lato text-text-secondary mb-4 text-sm">
            Your bank holds this account under a different name from your
            organization&apos;s registered name. Our team is checking it, and
            payouts wait until then. If the account isn&apos;t in your
            organization&apos;s name, change it to one that is.
          </p>
          <Link href={settingsHref} className="btn-primary rounded-md">
            Review bank account
          </Link>
        </section>
      );

    case "pending":
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
}
