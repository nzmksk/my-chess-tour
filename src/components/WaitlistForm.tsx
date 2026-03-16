"use client";

import { useActionState } from "react";
import { joinWaitlist } from "@/app/_actions/joinWaitlist";

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
        <p className="text-center text-sm text-(--color-gold-bright)">
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
              className="flex-1 rounded border px-4 py-3 text-sm outline-none transition-colors focus:border-(--color-gold-bright) disabled:opacity-50 bg-(--color-bg-raised) border-(--color-border) text-(--color-text-body)"
            />
            <button
              type="submit"
              disabled={pending}
              className="cursor-pointer rounded px-6 py-3 text-sm font-semibold transition-opacity hover:opacity-90 disabled:opacity-50 btn-gold"
            >
              {pending ? "Joining…" : "Join the Waitlist"}
            </button>
          </div>
          {state.error && (
            <p className="text-center text-xs text-(--color-error)">
              {state.error}
            </p>
          )}
        </>
      )}
    </form>
  );
}
