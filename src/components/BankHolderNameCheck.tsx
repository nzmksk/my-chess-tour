import Link from "next/link";
import type { HolderNameCheck } from "@/services/payouts/holder-name";

const CHECK_CONFIG: Record<
  HolderNameCheck,
  { label: string; className: string }
> = {
  match: { label: "Matches", className: "text-success" },
  mismatch: { label: "Doesn't match", className: "text-danger" },
  not_recorded: { label: "Not recorded", className: "text-text-muted" },
};

export default function BankHolderNameCheck({
  bankHolderName,
  check,
  underReview = false,
}: {
  bankHolderName: string | null;
  check: HolderNameCheck;
  underReview?: boolean;
}) {
  const config = CHECK_CONFIG[check];
  return (
    <span>
      {bankHolderName && <>{bankHolderName} </>}
      <span className={config.className}>
        {bankHolderName ? `(${config.label.toLowerCase()})` : config.label}
      </span>
      {underReview && (
        <>
          {" "}
          <Link
            href="/admin/bank-accounts"
            className="text-gold-bright hover:underline"
          >
            Review →
          </Link>
        </>
      )}
    </span>
  );
}
