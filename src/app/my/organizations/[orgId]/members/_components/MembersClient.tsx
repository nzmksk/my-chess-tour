"use client";

import Link from "next/link";
import { useState, type FormEvent } from "react";

interface Member {
  user_id: string;
  email: string;
  first_name: string;
  last_name: string;
  avatar_url: string | null;
  role: string;
  joined_at: string;
}

interface Props {
  orgId: string;
  orgName: string;
  members: Member[];
  currentUserId: string;
  isOrgCreator: boolean;
}

type Role = "owner" | "admin" | "member";

const ROLE_CONFIG: Record<Role, { label: string; className: string }> = {
  owner: {
    label: "Owner",
    className: "bg-gold-ghost text-gold-bright border border-gold-dim",
  },
  admin: {
    label: "Admin",
    className: "bg-info-bg text-info border border-info-border",
  },
  member: {
    label: "Member",
    className: "bg-bg-raised text-text-secondary border border-border",
  },
};

function getRoleConfig(role: string) {
  return ROLE_CONFIG[role as Role] ?? ROLE_CONFIG.member;
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

function InviteBar({ orgId }: { orgId: string }) {
  const [email, setEmail] = useState("");
  const [role, setRole] = useState<"admin" | "member">("member");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError(null);
    setSuccessMsg(null);

    try {
      const res = await fetch(`/api/v1/organizations/${orgId}/members/invite`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, role }),
      });

      const json = await res.json();

      if (!res.ok) {
        setError(json.error?.message ?? "Failed to send invitation");
      } else {
        const msg =
          json.data.status === "pending"
            ? `Invitation sent to ${json.data.email}`
            : `${json.data.email} has been added as a member`;
        setSuccessMsg(msg);
        setEmail("");
        setRole("member");
      }
    } catch {
      setError("An unexpected error occurred. Please try again.");
    } finally {
      setLoading(false);
    }
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
    </div>
  );
}

export default function MembersClient({
  orgId,
  orgName,
  members,
  currentUserId,
  isOrgCreator,
}: Props) {
  const [memberList, setMemberList] = useState<Member[]>(members);
  const [removeError, setRemoveError] = useState<string | null>(null);

  const currentMember = memberList.find((m) => m.user_id === currentUserId);
  const isOwner = isOrgCreator || currentMember?.role === "owner";

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
          href={`/organizations/${orgId}/dashboard`}
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

      {isOwner && <InviteBar orgId={orgId} />}

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
