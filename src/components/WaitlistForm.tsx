"use client";

import { useActionState } from "react";
import { joinWaitlist } from "@/app/_actions/joinWaitlist";
import { WAITLIST_ROLES } from "@/lib/waitlist-roles";

const initialState = { error: null, submitted: false };

export default function WaitlistForm() {
  const [state, formAction, pending] = useActionState(
    joinWaitlist,
    initialState,
  );
  const success = state.submitted && !pending;

  if (success) {
    return (
      <p className="text-gold-bright text-sm font-light">
        You&apos;re on the list. We&apos;ll be in touch.
      </p>
    );
  }

  return (
    <>
      <form action={formAction} className="flex w-full flex-col gap-4">
        <input
          type="email"
          name="email"
          required
          placeholder="Your email address"
          disabled={pending}
          className="input disabled:opacity-50"
          autoComplete="email"
        />
        <select
          name="user_type"
          aria-label="Your role"
          required
          defaultValue=""
          disabled={pending}
          className="input disabled:opacity-50"
        >
          <option value="" disabled>
            Your role
          </option>
          {WAITLIST_ROLES.map((role) => (
            <option key={role.value} value={role.value}>
              {role.label}
            </option>
          ))}
        </select>
        <button
          type="submit"
          disabled={pending}
          className="btn-primary disabled:opacity-50"
        >
          {pending ? "Joining…" : "Join the Waitlist"}
        </button>
      </form>
      <p className="text--meta mt-2 sm:text-center">
        No spam. We will only reach out when the platform is ready — or to ask
        for your feedback before launch.
      </p>
      {state.error && (
        <p className="text-danger text-xs sm:text-center">{state.error}</p>
      )}
    </>
  );
}
