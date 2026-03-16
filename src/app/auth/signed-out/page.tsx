import Link from "next/link";
import NavBar from "@/components/NavBar";

export const metadata = {
  title: "Signed Out — MY Chess Tour",
  description: "You've been signed out of MY Chess Tour.",
};

export default function SignedOutPage() {
  return (
    <div className="min-h-screen bg-(--color-bg-base)">
      <NavBar />
      <div className="auth-page">
        <div className="centered-col">
          <div className="auth-card card text-center">
            <div
              className="w-14 h-14 rounded-full border border-(--color-border) bg-(--color-bg-raised) flex items-center justify-center mx-auto mb-6 text-[1.375rem]"
              role="img"
              aria-label="Signed out"
            >
              ✔
            </div>
            <h1 className="confirm-title">Signed Out</h1>
            <p className="confirm-body">
              You&apos;ve been signed out of this device successfully. Your
              session has been cleared.
            </p>
            <div className="session-info">
              <div className="session-row">
                <span className="session-key">Session ended</span>
                <span className="session-val">Just now</span>
              </div>
              <div className="session-row">
                <span className="session-key">Device</span>
                <span className="session-val">This device only</span>
              </div>
              <div className="session-row">
                <span className="session-key">Session data</span>
                <span className="session-val">Cleared</span>
              </div>
            </div>
            <div className="confirm-actions">
              <Link href="/login" className="btn-primary">
                Sign Back In
              </Link>
              <Link
                href="/tournaments"
                className="btn-secondary mt-2 block text-center"
              >
                Browse Tournaments
              </Link>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
