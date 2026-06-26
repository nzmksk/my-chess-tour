import Link from "next/link";
import type { Metadata } from "next";
import NavBar from "@/components/NavBar";
import { getAuthClaims } from "@/services/supabase/permission";
import { resolvePaymentState } from "../_lib/resolvePaymentState";
import PaymentStatusView from "../_components/PaymentStatusView";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Payment | MY Chess Tour",
};

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <div className="bg-bg-base min-h-screen">
      <NavBar />
      <main className="mx-auto max-w-2xl px-6 py-10 md:px-10">{children}</main>
    </div>
  );
}

export default async function PaymentSuccessPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;

  const claims = await getAuthClaims();

  if (!claims) {
    return (
      <Shell>
        <div className="mx-auto max-w-lg">
          <div className="card card--featured flex flex-col p-8 text-center">
            <h2 className="confirm-title">Sign in to view your registration</h2>
            <p className="confirm-body">
              Sign in to check the status of your payment and registration.
            </p>
            <Link
              href={`/auth/login?next=/tournaments/${id}`}
              className="btn-primary mt-2 rounded-md text-center"
            >
              Sign In
            </Link>
          </div>
        </div>
      </Shell>
    );
  }

  const { state, registration } = await resolvePaymentState(id, claims.id);

  return (
    <Shell>
      <PaymentStatusView
        state={state}
        registration={registration}
        tournamentId={id}
      />
    </Shell>
  );
}
