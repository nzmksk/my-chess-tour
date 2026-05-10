import Link from "next/link";
import NavBar from "@/components/NavBar";

export const metadata = {
  title: "Signed Out — MY Chess Tour",
  description: "You've been signed out of MY Chess Tour.",
};

export default function SignedOutPage() {
  return (
    <div className="min-h-screen bg-bg-base">
      <NavBar />
      <div className="auth-page">
        <div className="centered-col">
          <div className="auth-card card text-center">
            <div
              className="confirm-icon text-gold-bright"
              role="img"
              aria-label="Signed out"
            >
              ♔
            </div>
            <h1 className="confirm-title">Signed Out</h1>
            <p className="confirm-body">
              Your session has ended. You&apos;ve been signed out of this
              device.
            </p>
            <div className="session-info">
              <div className="session-row">
                <span className="session-key">Signed out</span>
                <span className="session-val">Just now</span>
              </div>
              <div className="session-row">
                <span className="session-key">Scope</span>
                <span className="session-val">This device only</span>
              </div>
              <div className="session-row">
                <span className="session-key">Session</span>
                <span className="session-val">Cleared</span>
              </div>
            </div>
            <div className="confirm-actions">
              <Link href="/auth/login" className="btn-primary">
                Sign Back In
              </Link>
              <Link
                href="/tournaments"
                className="btn-secondary"
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
