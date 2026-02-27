"use client";

import { useActionState } from "react";
import { joinWaitlist } from "@/app/actions";

const initialState = { error: null, submitted: false };

export default function WaitlistForm() {
  const [state, formAction, pending] = useActionState(
    joinWaitlist,
    initialState,
  );
  const success = state.submitted && !pending;

  return (
    <form action={formAction} className="flex w-full max-w-md flex-col gap-3">
      {success ? (
        <p
          className="text-center text-sm"
          style={{ color: "var(--color-gold-bright)" }}
        >
          You&apos;re on the list. We&apos;ll be in touch.
        </p>
      ) : (
        <>
          <div className="flex flex-col gap-2 sm:flex-row">
            <input
              type="email"
              name="email"
              required
              placeholder="your@email.com"
              disabled={pending}
              className="flex-1 rounded border px-4 py-3 text-sm outline-none transition-colors focus:border-(--color-gold-bright) disabled:opacity-50"
              style={{
                background: "var(--color-bg-raised)",
                borderColor: "var(--color-border)",
                color: "var(--color-text-body)",
              }}
            />
            <button
              type="submit"
              disabled={pending}
              className="cursor-pointer rounded px-6 py-3 text-sm font-semibold tracking-widest transition-opacity hover:opacity-90 disabled:opacity-50"
              style={{
                background:
                  "linear-gradient(135deg, var(--color-gold-bright), var(--color-gold-deep))",
                color: "#0e0e0e",
                fontFamily: "var(--font-cinzel)",
                letterSpacing: "0.1em",
              }}
            >
              {pending ? "Joining…" : "Join the Waitlist"}
            </button>
          </div>
          {state.error && (
            <p className="text-center text-xs" style={{ color: "#e87070" }}>
              {state.error}
            </p>
          )}
        </>
      )}
    </form>
  );
}
