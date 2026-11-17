"use client";

import Link from "next/link";
import { useState, type FormEvent } from "react";
import { ROLE_CONFIG, getRoleConfig, type Role } from "@/lib/auth/roles";

interface Member {
  user_id: string;
  email: string;
  first_name: string;
  last_name: string;
  avatar_url: string | null;
  role: string;
  joined_at: string;
}

export interface PendingInvitation {
  id: string;
  email: string;
  role: string;
  invited_at: string;
  expires_at: string;
  days_left: number;
  expired: boolean;
  invited_by: string | null;
}

interface Props {
  orgId: string;
  orgName: string;
  members: Member[];
  invitations?: PendingInvitation[];
  currentUserId: string;
}

// The shape POST .../members/invite answers with.
interface InviteResponse {
  id: string;
  email: string;
  role: string;
  invited_at: string;
  expires_at: string;
  days_left: number;
  resent: boolean;
  email_sent: boolean;
}

async function sendInvite(
  orgId: string,
  email: string,
  role: string,
): Promise<{ ok: true; data: InviteResponse } | { ok: false; message: string }> {
  try {
    const res = await fetch(`/api/v1/organizations/${orgId}/members/invite`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email, role }),
    });
    const json = await res.json();
    if (!res.ok) {
      return { ok: false, message: json.error?.message ?? "Failed to send invitation" };
    }
    return { ok: true, data: json.data };
  } catch {
    return { ok: false, message: "An unexpected error occurred. Please try again." };
  }
}

function toPending(data: InviteResponse, invitedBy: string | null): PendingInvitation {
  return {
    id: data.id,
    email: data.email,
    role: data.role,
    invited_at: data.invited_at,
    expires_at: data.expires_at,
    days_left: data.days_left,
    expired: false,
    invited_by: invitedBy,
  };
}

function PendingInvitationRow({
  invitation,
  onResend,
  onRevoke,
}: {
  invitation: PendingInvitation;
  onResend: (invitation: PendingInvitation) => Promise<string | null>;
  onRevoke: (invitation: PendingInvitation) => Promise<string | null>;
}) {
  const [busy, setBusy] = useState<"resend" | "revoke" | null>(null);
  const [message, setMessage] = useState<{ text: string; error: boolean } | null>(
    null,
  );
  const roleConfig = getRoleConfig(invitation.role);
  const invitedDate = new Date(invitation.invited_at).toLocaleDateString("en-MY", {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
  const expiry = invitation.expired
    ? "Expired"
    : invitation.days_left <= 1
      ? "Expires within a day"
      : `Expires in ${invitation.days_left} days`;

  async function run(action: "resend" | "revoke") {
    setBusy(action);
    setMessage(null);
    const problem =
      action === "resend" ? await onResend(invitation) : await onRevoke(invitation);
    if (problem) setMessage({ text: problem, error: true });
    setBusy(null);
  }

  return (
    <div className="card flex flex-wrap items-center gap-4 px-5 py-3">
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2">
          <span className="font-lato text-text-primary truncate text-sm font-semibold">
            {invitation.email}
          </span>
          <span
            className={`font-cinzel rounded px-1.5 py-0.5 text-xs font-bold tracking-widest uppercase ${roleConfig.className}`}
          >
            {roleConfig.label}
          </span>
        </div>
        <p className="font-lato text-text-disabled mt-0.5 text-xs">
          Invited {invitedDate}
          {invitation.invited_by ? ` by ${invitation.invited_by}` : ""} ·{" "}
          <span className={invitation.expired ? "text-amber-400" : undefined}>
            {expiry}
          </span>
        </p>
        {message && (
          <p
            role={message.error ? "alert" : "status"}
            className={`font-lato mt-1 text-xs ${message.error ? "text-red-400" : "text-amber-400"}`}
          >
            {message.text}
          </p>
        )}
      </div>
      <div className="flex shrink-0 items-center gap-2">
        <button
          type="button"
          onClick={() => run("resend")}
          disabled={busy !== null}
          className="font-lato border-border text-text-secondary hover:border-gold-dim hover:text-gold-bright rounded-md border px-2 py-1 text-xs transition-colors duration-150 disabled:cursor-not-allowed disabled:opacity-40"
        >
          {busy === "resend" ? "Sending…" : "Resend"}
        </button>
        <button
          type="button"
          onClick={() => run("revoke")}
          disabled={busy !== null}
          className="font-lato rounded-md border border-red-900/40 px-2 py-1 text-xs text-red-400 transition-colors duration-150 hover:border-red-400/60 hover:text-red-300 disabled:cursor-not-allowed disabled:opacity-40"
        >
          {busy === "revoke" ? "Revoking…" : "Revoke"}
        </button>
      </div>
    </div>
  );
}

function MemberCard({
  member,
  isCurrentUser,
  canManage,
  onRoleChange,
  onRemove,
}: {
  member: Member;
  isCurrentUser: boolean;
  canManage: boolean;
  onRoleChange: (userId: string, newRole: "admin" | "member") => Promise<void>;
  onRemove: (userId: string) => void;
}) {
  const [roleLoading, setRoleLoading] = useState(false);
  const [roleError, setRoleError] = useState<string | null>(null);

  const fullName = [member.first_name, member.last_name]
    .filter(Boolean)
    .join(" ");
  const initials =
    `${member.first_name[0] ?? ""}${member.last_name[0] ?? ""}`.toUpperCase() ||
    member.email[0]?.toUpperCase() ||
    "?";

  const joinedDate = new Date(member.joined_at).toLocaleDateString("en-MY", {
    day: "numeric",
    month: "short",
    year: "numeric",
  });

  const roleConfig = getRoleConfig(member.role);

  async function handleRoleSelect(newRole: "admin" | "member") {
    if (newRole === member.role) return;
    setRoleLoading(true);
    setRoleError(null);
    try {
      await onRoleChange(member.user_id, newRole);
    } catch (err) {
      setRoleError(
        err instanceof Error ? err.message : "Failed to update role",
      );
    } finally {
      setRoleLoading(false);
    }
  }

  return (
    <div className="card flex flex-wrap items-center gap-4 px-5 py-4">
      <div className="bg-gold-ghost border-gold-dim font-cinzel text-gold-bright flex h-10 w-10 shrink-0 items-center justify-center rounded-full border-2 text-sm font-semibold">
        {initials}
      </div>

      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2">
          <span className="font-lato text-text-primary truncate text-sm font-semibold">
            {fullName || member.email}
          </span>
          {isCurrentUser && (
            <span className="font-cinzel bg-bg-raised text-text-muted border-border rounded border px-1.5 py-0.5 text-xs font-bold tracking-widest uppercase">
              You
            </span>
          )}
        </div>
        <p className="font-lato text-text-muted mt-0.5 truncate text-xs">
          {member.email}
        </p>
        <p className="font-lato text-text-disabled mt-0.5 text-xs">
          Joined {joinedDate}
        </p>
        {roleError && (
          <p className="font-lato mt-1 text-xs text-red-400">{roleError}</p>
        )}
      </div>

      {canManage ? (
        <div className="flex shrink-0 items-center gap-2">
          <select
            value={member.role as "admin" | "member"}
            onChange={(e) =>
              handleRoleSelect(e.target.value as "admin" | "member")
            }
            disabled={roleLoading}
            className="border-border bg-bg-base font-cinzel text-text-secondary focus:border-gold-dim rounded-md border px-2 py-1 text-xs font-bold tracking-widest uppercase focus:outline-none disabled:opacity-50"
          >
            <option value="admin">Admin</option>
            <option value="member">Member</option>
          </select>
          <button
            onClick={() => onRemove(member.user_id)}
            disabled={roleLoading}
            className="font-lato rounded-md border border-red-900/40 px-2 py-1 text-xs text-red-400 transition-colors duration-150 hover:border-red-400/60 hover:text-red-300 disabled:cursor-not-allowed disabled:opacity-40"
          >
            Remove
          </button>
        </div>
      ) : (
        <span
          className={`font-cinzel rounded-md px-2.5 py-1 text-xs font-bold tracking-widest whitespace-nowrap uppercase ${roleConfig.className}`}
        >
          {roleConfig.label}
        </span>
      )}
    </div>
  );
}

function InviteBar({
  orgId,
  onInvited,
}: {
  orgId: string;
  onInvited: (data: InviteResponse) => void;
}) {
  const [email, setEmail] = useState("");
  const [role, setRole] = useState<"admin" | "member">("member");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);
  const [warningMsg, setWarningMsg] = useState<string | null>(null);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError(null);
    setSuccessMsg(null);
    setWarningMsg(null);

    const result = await sendInvite(orgId, email, role);
    if (!result.ok) {
      setError(result.message);
    } else {
      const { data } = result;
      onInvited(data);
      // The invitation stands either way; email_sent says whether it reached
      // them. Resend from the pending list tries the email again.
      if (data.email_sent === false) {
        setWarningMsg(
          `Invitation saved for ${data.email}, but the email couldn't be sent. Use Resend below to try again.`,
        );
      } else {
        setSuccessMsg(
          data.resent
            ? `Invitation re-sent to ${data.email}`
            : `Invitation sent to ${data.email}`,
        );
      }
      setEmail("");
      setRole("member");
    }
    setLoading(false);
  }

  return (
    <div className="bg-bg-raised border-border mb-6 rounded-lg border px-5 py-4">
      <p className="font-cinzel text-gold-muted mb-3 text-xs font-bold tracking-widest uppercase">
        Invite Member
      </p>
      <form
        onSubmit={handleSubmit}
        className="flex flex-col gap-3 sm:flex-row sm:items-end"
      >
        <div className="min-w-0 flex-1">
          <label
            htmlFor="invite-email"
            className="font-lato text-text-muted mb-1 block text-xs"
          >
            Email address
          </label>
          <input
            id="invite-email"
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="colleague@example.com"
            required
            disabled={loading}
            className="border-border bg-bg-base font-lato text-text-primary placeholder:text-text-disabled focus:border-gold-dim w-full rounded-md border px-3 py-2 text-sm focus:outline-none disabled:opacity-50"
          />
        </div>

        <div className="sm:w-36">
          <label
            htmlFor="invite-role"
            className="font-lato text-text-muted mb-1 block text-xs"
          >
            Role
          </label>
          <select
            id="invite-role"
            value={role}
            onChange={(e) => setRole(e.target.value as "admin" | "member")}
            disabled={loading}
            className="border-border bg-bg-base font-lato text-text-primary focus:border-gold-dim w-full rounded-md border px-3 py-2 text-sm focus:outline-none disabled:opacity-50"
          >
            <option value="admin">Admin</option>
            <option value="member">Member</option>
          </select>
        </div>

        <button
          type="submit"
          disabled={loading || !email.trim()}
          className="font-cinzel bg-gold-ghost border-gold-dim text-gold-bright hover:bg-gold-dim hover:text-bg-base rounded-md border px-4 py-2 text-xs font-bold tracking-widest whitespace-nowrap uppercase transition-colors duration-150 disabled:cursor-not-allowed disabled:opacity-40"
        >
          {loading ? "Sending…" : "Send Invite"}
        </button>
      </form>

      {error && <p className="font-lato mt-2 text-xs text-red-400">{error}</p>}
      {successMsg && (
        <p className="font-lato mt-2 text-xs text-green-400">{successMsg}</p>
      )}
      {warningMsg && (
        <p role="status" className="font-lato mt-2 text-xs text-amber-400">
          {warningMsg}
        </p>
      )}
    </div>
  );
}

export default function MembersClient({
  orgId,
  orgName,
  members,
  invitations = [],
  currentUserId,
}: Props) {
  const [memberList, setMemberList] = useState<Member[]>(members);
  const [invitationList, setInvitationList] =
    useState<PendingInvitation[]>(invitations);
  const [removeError, setRemoveError] = useState<string | null>(null);

  const currentMember = memberList.find((m) => m.user_id === currentUserId);
  const isOwner = currentMember?.role === "owner";
  const currentUserName = currentMember
    ? [currentMember.first_name, currentMember.last_name].filter(Boolean).join(" ") ||
      null
    : null;

  // An address has at most one pending invitation, and inviting it again
  // refreshes that one, so the list is keyed by address.
  function upsertInvitation(data: InviteResponse) {
    setInvitationList((prev) => [
      toPending(data, currentUserName),
      ...prev.filter((i) => i.email !== data.email),
    ]);
  }

  async function handleResend(invitation: PendingInvitation): Promise<string | null> {
    const result = await sendInvite(orgId, invitation.email, invitation.role);
    if (!result.ok) return result.message;
    upsertInvitation(result.data);
    return result.data.email_sent ? null : "The invitation email couldn't be sent. Try again.";
  }

  async function handleRevoke(invitation: PendingInvitation): Promise<string | null> {
    try {
      const res = await fetch(
        `/api/v1/organizations/${orgId}/invitations/${invitation.id}`,
        { method: "DELETE" },
      );
      if (!res.ok) {
        const json = await res.json().catch(() => ({}));
        return json.error?.message ?? "Failed to revoke invitation";
      }
      setInvitationList((prev) => prev.filter((i) => i.id !== invitation.id));
      return null;
    } catch {
      return "An unexpected error occurred. Please try again.";
    }
  }

  async function handleRoleChange(userId: string, newRole: "admin" | "member") {
    const res = await fetch(
      `/api/v1/organizations/${orgId}/members/${userId}`,
      {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ role: newRole }),
      },
    );

    const json = await res.json();
    if (!res.ok) {
      throw new Error(json.error?.message ?? "Failed to update role");
    }

    setMemberList((prev) =>
      prev.map((m) => (m.user_id === userId ? { ...m, role: newRole } : m)),
    );
  }

  function handleRemove(userId: string) {
    const member = memberList.find((m) => m.user_id === userId);
    const name = member
      ? [member.first_name, member.last_name].filter(Boolean).join(" ") ||
        member.email
      : "this member";

    if (!confirm(`Remove ${name} from the organization?`)) return;

    setRemoveError(null);
    fetch(`/api/v1/organizations/${orgId}/members/${userId}`, {
      method: "DELETE",
    })
      .then((res) => {
        if (res.status === 204 || res.ok) {
          setMemberList((prev) => prev.filter((m) => m.user_id !== userId));
          return;
        }
        return res.json().then((j: { error?: { message?: string } }) => {
          setRemoveError(j.error?.message ?? "Failed to remove member");
        });
      })
      .catch(() => {
        setRemoveError("An unexpected error occurred. Please try again.");
      });
  }

  return (
    <div className="mx-auto max-w-3xl px-6 py-8">
      <div className="mb-6">
        <Link
          href={`/my/organizations/${orgId}`}
          className="font-lato text-text-muted hover:text-text-secondary mb-3 inline-flex items-center gap-1 text-xs transition-colors duration-150"
        >
          ← Back to Dashboard
        </Link>
        <h1 className="font-cinzel text-text-primary text-2xl font-bold tracking-wide">
          {orgName}
        </h1>
        <p className="font-lato text-text-muted mt-1 text-sm">
          Members · {memberList.length}{" "}
          {memberList.length === 1 ? "person" : "people"}
        </p>
      </div>

      {isOwner && <InviteBar orgId={orgId} onInvited={upsertInvitation} />}

      {isOwner && invitationList.length > 0 && (
        <div className="mb-6">
          <p className="font-cinzel text-gold-muted mb-3 text-xs font-bold tracking-widest uppercase">
            Pending Invitations · {invitationList.length}
          </p>
          <div className="flex flex-col gap-2">
            {invitationList.map((invitation) => (
              <PendingInvitationRow
                key={invitation.id}
                invitation={invitation}
                onResend={handleResend}
                onRevoke={handleRevoke}
              />
            ))}
          </div>
        </div>
      )}

      {removeError && (
        <div className="mb-4 rounded-md border border-red-900/40 bg-red-950/40 px-4 py-2">
          <p className="font-lato text-xs text-red-400">{removeError}</p>
        </div>
      )}

      {/* Role permissions reference */}
      <div className="bg-bg-raised border-border mb-6 rounded-lg border px-5 py-4">
        <p className="font-cinzel text-gold-muted mb-2 text-xs font-bold tracking-widest uppercase">
          Role Permissions
        </p>
        <div className="flex flex-col gap-1.5">
          {(["owner", "admin", "member"] as Role[]).map((role) => {
            const config = ROLE_CONFIG[role];
            const descriptions: Record<Role, string> = {
              owner: "Full control: tournaments, members, payouts, settings.",
              admin:
                "Create and manage tournaments, view participants and payouts.",
              member: "View tournaments and participants only.",
            };
            return (
              <div key={role} className="flex items-start gap-2">
                <span
                  className={`font-cinzel shrink-0 rounded px-2 py-0.5 text-xs font-bold tracking-widest uppercase ${config.className}`}
                >
                  {config.label}
                </span>
                <span className="font-lato text-text-muted text-xs leading-relaxed">
                  {descriptions[role]}
                </span>
              </div>
            );
          })}
        </div>
      </div>

      {/* Members list */}
      {memberList.length === 0 ? (
        <div className="px-5 py-12 text-center">
          <div className="mb-4 text-4xl opacity-20">♟</div>
          <p className="font-lato text-text-muted text-sm leading-relaxed">
            No members yet.
          </p>
        </div>
      ) : (
        <div className="flex flex-col gap-3">
          {memberList.map((member) => {
            const isCurrentUser = member.user_id === currentUserId;
            const canManage =
              isOwner && !isCurrentUser && member.role !== "owner";
            return (
              <MemberCard
                key={member.user_id}
                member={member}
                isCurrentUser={isCurrentUser}
                canManage={canManage}
                onRoleChange={handleRoleChange}
                onRemove={handleRemove}
              />
            );
          })}
        </div>
      )}
    </div>
  );
}
