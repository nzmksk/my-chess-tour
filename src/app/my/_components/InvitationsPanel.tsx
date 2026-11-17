"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { ROLE_CONFIG } from "@/lib/auth/roles";
import type { InvitationView } from "@/services/organizations/invitations";

// The signed-in user's open organization invitations, at the top of their
// dashboard, so an invitation isn't only reachable through the email. Renders
// nothing when there are none.
export default function InvitationsPanel({
  invitations,
}: {
  invitations: InvitationView[];
}) {
  const router = useRouter();
  const [list, setList] = useState(invitations);
  const [busy, setBusy] = useState<string | null>(null);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [declined, setDeclined] = useState<string | null>(null);

  if (list.length === 0 && !declined) return null;

  async function respond(invitation: InvitationView, action: "accept" | "decline") {
    setBusy(invitation.id);
    setDeclined(null);
    setErrors((prev) => {
      const next = { ...prev };
      delete next[invitation.id];
      return next;
    });
    try {
      const res = await fetch(`/api/v1/me/invitations/${invitation.id}/${action}`, {
        method: "POST",
      });
      const json = await res.json();
      if (!res.ok) {
        setErrors((prev) => ({
          ...prev,
          [invitation.id]:
            json.error?.message ?? "Something went wrong. Please try again.",
        }));
        return;
      }
      if (action === "accept") {
        router.push(`/my/organizations/${json.data.organization_id}`);
        router.refresh();
      } else {
        setList((prev) => prev.filter((i) => i.id !== invitation.id));
        setDeclined(invitation.organization.name);
      }
    } catch {
      setErrors((prev) => ({
        ...prev,
        [invitation.id]: "Network error. Please try again.",
      }));
    } finally {
      setBusy(null);
    }
  }

  return (
    <section aria-labelledby="invitations-heading" className="px-6 pt-6">
      <h2
        id="invitations-heading"
        className="font-cinzel text-gold-muted mb-3 text-xs font-bold tracking-widest uppercase"
      >
        Organization Invitations
      </h2>

      {declined && (
        <p role="status" className="font-lato text-text-muted mb-3 text-xs">
          You declined the invitation to join {declined}.
        </p>
      )}

      <div className="flex flex-col gap-3">
        {list.map((invitation) => {
          const role = ROLE_CONFIG[invitation.role].label.toLowerCase();
          const expiry =
            invitation.daysLeft <= 1
              ? "Expires within a day"
              : `Expires in ${invitation.daysLeft} days`;
          const isBusy = busy === invitation.id;
          return (
            <div
              key={invitation.id}
              className="card flex flex-wrap items-center gap-4 px-5 py-4"
            >
              <div className="min-w-0 flex-1">
                <p className="font-lato text-text-primary text-sm">
                  {invitation.inviterName ?? "Someone"} invited you to join{" "}
                  <strong>{invitation.organization.name}</strong> as{" "}
                  {role === "admin" ? "an" : "a"} {role}.
                </p>
                <p className="font-lato text-text-disabled mt-0.5 text-xs">{expiry}</p>
                {errors[invitation.id] && (
                  <p role="alert" className="font-lato mt-1 text-xs text-red-400">
                    {errors[invitation.id]}
                  </p>
                )}
              </div>
              <div className="flex shrink-0 items-center gap-2">
                <button
                  type="button"
                  onClick={() => respond(invitation, "accept")}
                  disabled={busy !== null}
                  className="font-cinzel bg-gold-ghost border-gold-dim text-gold-bright hover:bg-gold-dim hover:text-bg-base rounded-md border px-3 py-1.5 text-xs font-bold tracking-widest uppercase transition-colors duration-150 disabled:cursor-not-allowed disabled:opacity-40"
                >
                  {isBusy ? "Working…" : "Accept"}
                </button>
                <button
                  type="button"
                  onClick={() => respond(invitation, "decline")}
                  disabled={busy !== null}
                  className="font-lato rounded-md border border-red-900/40 px-3 py-1.5 text-xs text-red-400 transition-colors duration-150 hover:border-red-400/60 hover:text-red-300 disabled:cursor-not-allowed disabled:opacity-40"
                >
                  Decline
                </button>
              </div>
            </div>
          );
        })}
      </div>
    </section>
  );
}
