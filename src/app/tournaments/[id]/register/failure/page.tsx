import Link from "next/link";
import type { Metadata } from "next";
import NavBar from "@/components/NavBar";

export const metadata: Metadata = {
  title: "Payment Failed | MY Chess Tour",
};

export default async function PaymentFailurePage({
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
            <div className="confirm-icon confirm-icon--danger">✗</div>
            <h2 className="confirm-title">Payment Failed</h2>
            <p className="confirm-body">
              Your payment could not be processed. Please try again or contact
              support if the problem persists.
            </p>
            {/* TODO: This link is temporary and will be replaced once the payment gateway is integrated */}
            <Link
              href={`/tournaments/${id}/register`}
              className="btn-primary rounded-md text-center mt-2"
            >
              Try Again
            </Link>
            <Link
              href={`/tournaments/${id}`}
              className="btn-secondary rounded-md text-center mt-4"
            >
              Back to Tournament
            </Link>
          </div>
        </div>
      </main>
    </div>
  );
}
