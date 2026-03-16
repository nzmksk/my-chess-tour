"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { logout } from "../_actions/logout";

export default function LogoutDialog() {
  const [pending, startTransition] = useTransition();
  const router = useRouter();

  function handleLogout() {
    startTransition(async () => {
      await logout();
    });
  }

  function handleCancel() {
    if (window.history.length > 1) {
      router.back();
    } else {
      router.push("/tournaments");
    }
  }

  return (
    <div className="auth-page">
      <div className="centered-col">
        <div className="auth-card card confirm-card mx-auto text-center">
          <div className="confirm-icon" role="img" aria-label="Sign out">
            ↪
          </div>
          <h1 className="confirm-title">Sign Out?</h1>
          <p className="confirm-body">
            You&apos;re signing out of your MY Chess Tour account on this
            device. Any unsaved changes will be lost.
          </p>
          <div className="confirm-actions">
            <button
              className="btn-danger"
              onClick={handleLogout}
              disabled={pending}
              aria-disabled={pending}
            >
              {pending ? "Signing Out\u2026" : "Yes, Sign Out"}
            </button>
            <button
              type="button"
              className="btn-secondary mt-2 w-full"
              onClick={handleCancel}
              disabled={pending}
            >
              Cancel
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
