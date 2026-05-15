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

  if (success) {
    return (
      <p className="text-sm font-light text-gold-bright">
        You&apos;re on the list. We&apos;ll be in touch.
      </p>
    );
  }

  return (
    <form action={formAction} className="flex w-full flex-col gap-2">
      <input
        type="email"
        name="email"
        required
        placeholder="Your email address"
        disabled={pending}
        className="input disabled:opacity-50"
      />
      <select
        name="user_type"
        defaultValue="player"
        disabled={pending}
        className="input disabled:opacity-50"
      >
        <option value="player">I am a player</option>
        <option value="organizer">I am an organizer</option>
      </select>
      <button
        type="submit"
        disabled={pending}
        className="btn-primary mt-2 disabled:opacity-50"
      >
        {pending ? "Joining…" : "Join the Waitlist"}
      </button>
      {state.error && (
        <p className="text-xs text-danger">{state.error}</p>
      )}
    </form>
  );
}
