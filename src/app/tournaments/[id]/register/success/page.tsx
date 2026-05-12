import Link from "next/link";
import type { Metadata } from "next";
import NavBar from "@/components/NavBar";

export const metadata: Metadata = {
  title: "Payment Successful | MY Chess Tour",
};

export default async function PaymentSuccessPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;

  return (
    <div className="min-h-screen bg-bg-base">
      <NavBar />
      <main className="max-w-2xl mx-auto px-6 md:px-10 py-10">
        <div className="max-w-lg mx-auto">
          <div className="card card--featured p-8 flex flex-col text-center">
            <div className="confirm-icon">✓</div>
            <h2 className="confirm-title">Payment Successful</h2>
            <p className="confirm-body">
              Your payment has been confirmed. Your registration is now active.
              We look forward to seeing you at the tournament.
            </p>
            <Link
              href={`/tournaments/${id}`}
              className="btn-secondary rounded-md text-center mt-2"
            >
              Back to Tournament
            </Link>
          </div>
        </div>
      </main>
    </div>
  );
}
