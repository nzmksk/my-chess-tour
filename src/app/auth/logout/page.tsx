"use client";

import Link from "next/link";
import NavBar from "@/components/NavBar";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";

export default function SignedOutPage() {
  const router = useRouter();
  const [seconds, setSeconds] = useState(10);

  useEffect(() => {
    if (seconds === 0) {
      router.push("/tournaments");
      return;
    }
    const timer = setTimeout(() => setSeconds((s) => s - 1), 1000);
    return () => clearTimeout(timer);
  }, [seconds, router]);

  return (
    <div className="bg-bg-base min-h-screen">
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
              <Link href="/tournaments" className="btn-secondary">
                Browse Tournaments
              </Link>
            </div>
            <p className="confirm-body mt-4 mb-0 text-sm opacity-60">
              Redirecting to tournaments in {seconds}s…
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
