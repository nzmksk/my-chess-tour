"use client";

import { useState, useSyncExternalStore } from "react";
import Link from "next/link";

const DISMISS_KEY = "mct.profileNudgeDismissed";

// Read the per-browser dismissal flag via useSyncExternalStore so there's no
// setState-in-effect and no hydration mismatch (the server snapshot is "not
// dismissed"; the real value is read on the client after hydration).
function subscribe(callback: () => void) {
  window.addEventListener("storage", callback);
  return () => window.removeEventListener("storage", callback);
}
function getSnapshot() {
  try {
    return window.localStorage.getItem(DISMISS_KEY) === "1";
  } catch {
    return false;
  }
}
function getServerSnapshot() {
  return false;
}

/**
 * Dismissible banner nudging signed-in players with an incomplete profile to fill
 * it in. Only mounted by the server when the profile is actually incomplete; the
 * dismissal is remembered per-browser.
 */
export default function ProfileNudge() {
  const storedDismissed = useSyncExternalStore(
    subscribe,
    getSnapshot,
    getServerSnapshot,
  );
  // The "storage" event doesn't fire in the tab that wrote it, so track the
  // current-tab dismissal locally for an immediate hide.
  const [justDismissed, setJustDismissed] = useState(false);

  if (storedDismissed || justDismissed) return null;

  function dismiss() {
    try {
      window.localStorage.setItem(DISMISS_KEY, "1");
    } catch {
      // Ignore unavailable storage — worst case the banner returns next visit.
    }
    setJustDismissed(true);
  }

  return (
    <div className="card card--featured flex items-center gap-4 p-4 my-4">
      <p className="font-lato text-text-secondary flex-1 text-sm">
        Complete your player profile to speed up tournament registration and
        unlock age, rated, and category entries.{" "}
        <Link
          href="/settings"
          className="text-gold-bright whitespace-nowrap hover:underline"
        >
          Complete profile →
        </Link>
      </p>
      <button
        type="button"
        onClick={dismiss}
        aria-label="Dismiss"
        className="text-text-muted hover:text-text-secondary shrink-0 text-lg leading-none transition-colors"
      >
        ×
      </button>
    </div>
  );
}
