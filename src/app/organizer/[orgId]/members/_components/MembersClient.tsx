"use client";

import Link from "next/link";

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
}

type Role = "owner" | "admin" | "member";

const ROLE_CONFIG: Record<Role, { label: string; className: string }> = {
  owner: {
    label: "Owner",
    className:
      "bg-gold-ghost text-gold-bright border border-gold-dim",
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
  return ROLE_CONFIG[(role as Role)] ?? ROLE_CONFIG.member;
}

function MemberCard({
  member,
  isCurrentUser,
}: {
  member: Member;
  isCurrentUser: boolean;
}) {
  const fullName = [member.first_name, member.last_name].filter(Boolean).join(" ");
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

  return (
    <div className="card px-5 py-4 flex items-center gap-4">
      <div className="bg-gold-ghost border-2 border-gold-dim font-cinzel text-gold-bright flex h-10 w-10 shrink-0 items-center justify-center rounded-full text-sm font-semibold">
        {initials}
      </div>

      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 flex-wrap">
          <span className="font-lato text-sm font-semibold text-text-primary truncate">
            {fullName || member.email}
          </span>
          {isCurrentUser && (
            <span className="font-cinzel text-xs font-bold tracking-widest uppercase px-1.5 py-0.5 rounded bg-bg-raised text-text-muted border border-border">
              You
            </span>
          )}
        </div>
        <p className="font-lato text-xs text-text-muted mt-0.5 truncate">
          {member.email}
        </p>
        <p className="font-lato text-xs text-text-disabled mt-0.5">
          Joined {joinedDate}
        </p>
      </div>

      <span
        className={`font-cinzel text-xs font-bold tracking-widest uppercase px-2.5 py-1 rounded-md whitespace-nowrap ${roleConfig.className}`}
      >
        {roleConfig.label}
      </span>
    </div>
  );
}

export default function MembersClient({
  orgId,
  orgName,
  members,
  currentUserId,
}: Props) {
  return (
    <div className="max-w-3xl mx-auto px-6 py-8">
      <div className="mb-6">
        <Link
          href={`/organizer/${orgId}/dashboard`}
          className="font-lato text-xs text-text-muted hover:text-text-secondary transition-colors duration-150 inline-flex items-center gap-1 mb-3"
        >
          ← Back to Dashboard
        </Link>
        <h1 className="font-cinzel text-2xl font-bold text-text-primary tracking-wide">
          {orgName}
        </h1>
        <p className="font-lato text-sm text-text-muted mt-1">
          Members · {members.length} {members.length === 1 ? "person" : "people"}
        </p>
      </div>

      {/* Role permissions reference */}
      <div className="rounded-lg bg-bg-raised border border-border px-5 py-4 mb-6">
        <p className="font-cinzel text-xs font-bold tracking-widest uppercase text-gold-muted mb-2">
          Role Permissions
        </p>
        <div className="flex flex-col gap-1.5">
          {(["owner", "admin", "member"] as Role[]).map((role) => {
            const config = ROLE_CONFIG[role];
            const descriptions: Record<Role, string> = {
              owner: "Full control: tournaments, members, payouts, settings.",
              admin: "Create and manage tournaments, view participants and payouts.",
              member: "View tournaments and participants only.",
            };
            return (
              <div key={role} className="flex items-start gap-2">
                <span
                  className={`font-cinzel text-xs font-bold tracking-widest uppercase px-2 py-0.5 rounded shrink-0 ${config.className}`}
                >
                  {config.label}
                </span>
                <span className="font-lato text-xs text-text-muted leading-relaxed">
                  {descriptions[role]}
                </span>
              </div>
            );
          })}
        </div>
      </div>

      {/* Members list */}
      {members.length === 0 ? (
        <div className="text-center py-12 px-5">
          <div className="text-4xl mb-4 opacity-20">♟</div>
          <p className="font-lato text-sm text-text-muted leading-relaxed">
            No members yet.
          </p>
        </div>
      ) : (
        <div className="flex flex-col gap-3">
          {members.map((member) => (
            <MemberCard
              key={member.user_id}
              member={member}
              isCurrentUser={member.user_id === currentUserId}
            />
          ))}
        </div>
      )}
    </div>
  );
}
