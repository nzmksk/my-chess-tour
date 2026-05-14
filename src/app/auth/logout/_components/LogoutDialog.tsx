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
        <div className="auth-card card mx-auto text-center">
          <div className="confirm-icon" role="img" aria-label="Sign out">
            <svg
              xmlns="http://www.w3.org/2000/svg"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.5"
              strokeLinecap="round"
              strokeLinejoin="round"
              aria-hidden="true"
              width="1em"
              height="1em"
            >
              {/* Door panel */}
              <path d="M15 3H5a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10" />
              {/* Arrow pointing out to the right */}
              <polyline points="17 8 22 12 17 16" />
              <line x1="22" y1="12" x2="9" y2="12" />
            </svg>
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
              className="btn-secondary w-full"
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
