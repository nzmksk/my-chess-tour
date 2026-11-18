import Link from "next/link";
import type { Metadata } from "next";
import NavBar from "@/components/NavBar";

export const metadata: Metadata = {
  title: "Prize Fund Payment | MY Chess Tour",
};

// Where CHIP returns a sponsor after paying into a platform-distributed prize
// pool (#523). The sponsor usually has no account here, and the payment's
// outcome is recorded by the CHIP webhook, not by this page, so it only says
// what happens next. CHIP emails its own receipt.
export default async function PrizeFundingThankYouPage({
  searchParams,
}: {
  searchParams: Promise<{ status?: string }>;
}) {
  const { status } = await searchParams;
  const failed = status === "failed";

  return (
    <div className="bg-bg-base min-h-screen">
      <NavBar />
      <main className="mx-auto max-w-2xl px-6 py-10 md:px-10">
        <div className="mx-auto max-w-lg">
          <div className="card card--featured flex flex-col p-8 text-center">
            {failed ? (
              <>
                <h1 className="confirm-title">Payment not completed</h1>
                <p className="confirm-body">
                  Your payment to the prize fund didn&apos;t go through, and
                  nothing was charged. You can try again from the same link, or
                  ask the organizer for a new one.
                </p>
              </>
            ) : (
              <>
                <h1 className="confirm-title">Thank you for funding the prizes</h1>
                <p className="confirm-body">
                  Once your payment clears it is held by MY Chess Tour in the
                  tournament&apos;s prize pool, separate from the organizer&apos;s
                  money, and paid only to the winners. A receipt is on its way
                  to your email. Anything not awarded is returned to you.
                </p>
              </>
            )}
            <Link href="/tournaments" className="btn-primary mt-2 rounded-md text-center">
              Browse Tournaments
            </Link>
          </div>
        </div>
      </main>
    </div>
  );
}
