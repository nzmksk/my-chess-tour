import { createHash, randomBytes } from "crypto";
import { supabaseAdmin } from "@/services/supabase/admin";
import type { MemberInvitationRole } from "@/services/email/email";

// Organization invitations (organization_invitations, functions in 003). The
// emailed link carries a random token; the database only ever sees its SHA-256,
// so a leaked table row can't be turned back into a working link.

/** 32 random bytes, base64url: always 43 characters from [A-Za-z0-9_-]. */
export const INVITATION_TOKEN_RE = /^[A-Za-z0-9_-]{43}$/;

export function generateInvitationToken(): string {
  return randomBytes(32).toString("base64url");
}

export function hashInvitationToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

/** The page the invitation email links to. An outbound link: NEXT_PUBLIC_SITE_URL. */
export function invitationUrl(token: string): string {
  const siteUrl = process.env.NEXT_PUBLIC_SITE_URL ?? "http://localhost:3000";
  return `${siteUrl}/invitations/${token}`;
}

/**
 * Where an invitation stands for whoever holds its link. `expired` is derived:
 * the row is still pending but expires_at has passed, which is exactly when the
 * accept and decline functions start refusing it.
 */
export type InvitationState =
  | "pending"
  | "expired"
  | "accepted"
  | "declined"
  | "revoked";

export interface InvitationView {
  id: string;
  email: string;
  role: MemberInvitationRole;
  state: InvitationState;
  expiresAt: string;
  /** Whole days until expiry, rounded up; 0 once expired. */
  daysLeft: number;
  organization: { id: string; name: string; available: boolean };
  inviterName: string | null;
}

interface InvitationRow {
  id: string;
  email: string;
  status: "pending" | "accepted" | "declined" | "revoked";
  expires_at: string;
  roles: { name: string } | null;
  organizations: {
    id: string;
    name: string;
    approval_status: string;
    deleted_at: string | null;
  } | null;
  inviter: { first_name: string | null; last_name: string | null } | null;
}

export function invitationState(
  status: InvitationRow["status"],
  expiresAt: string,
  now: Date = new Date(),
): InvitationState {
  if (status === "pending" && new Date(expiresAt) <= now) return "expired";
  return status;
}

const DAY_MS = 24 * 60 * 60 * 1000;

export function daysUntil(expiresAt: string, now: Date = new Date()): number {
  return Math.max(0, Math.ceil((new Date(expiresAt).getTime() - now.getTime()) / DAY_MS));
}

export function personName(
  person: { first_name: string | null; last_name: string | null } | null,
): string | null {
  const name = [person?.first_name, person?.last_name]
    .filter((part) => part && part.trim())
    .join(" ")
    .trim();
  return name || null;
}

const INVITATION_VIEW_SELECT = `id, email, status, expires_at,
  roles(name),
  organizations(id, name, approval_status, deleted_at),
  inviter:users!invited_by(first_name, last_name)`;

function toInvitationView(row: InvitationRow): InvitationView | null {
  if (!row.organizations || !row.roles) return null;

  return {
    id: row.id,
    email: row.email,
    role: row.roles.name as MemberInvitationRole,
    state: invitationState(row.status, row.expires_at),
    expiresAt: row.expires_at,
    daysLeft: daysUntil(row.expires_at),
    organization: {
      id: row.organizations.id,
      name: row.organizations.name,
      available:
        row.organizations.approval_status === "approved" &&
        row.organizations.deleted_at === null,
    },
    inviterName: personName(row.inviter),
  };
}

/**
 * Looks up the invitation a link's token belongs to. Null for a malformed token
 * or one that matches nothing; throws on a database error so the caller can
 * tell "no such invitation" from "couldn't check".
 */
export async function getInvitationByToken(
  token: string,
): Promise<InvitationView | null> {
  if (!INVITATION_TOKEN_RE.test(token)) return null;

  const { data, error } = await supabaseAdmin
    .from("organization_invitations")
    .select(INVITATION_VIEW_SELECT)
    .eq("token_hash", hashInvitationToken(token))
    .maybeSingle();

  if (error) {
    throw new Error(`Failed to load invitation: ${error.message}`);
  }
  if (!data) return null;

  return toInvitationView(data as unknown as InvitationRow);
}

/**
 * The invitations a signed-in user can answer right now: pending, not expired,
 * addressed to their account's email, from an organization that can still take
 * members. Newest first. Matched on users.email, the same address
 * accept_organization_invitation_by_id checks. Throws on a database error.
 */
export async function listInvitationsForUser(
  userId: string,
): Promise<InvitationView[]> {
  const { data: user, error: userError } = await supabaseAdmin
    .from("users")
    .select("email")
    .eq("id", userId)
    .is("deleted_at", null)
    .maybeSingle();

  if (userError) {
    throw new Error(`Failed to load user for invitations: ${userError.message}`);
  }
  const email = (user as { email: string | null } | null)?.email;
  if (!email) return [];

  const { data, error } = await supabaseAdmin
    .from("organization_invitations")
    .select(INVITATION_VIEW_SELECT)
    .eq("email", email.toLowerCase())
    .eq("status", "pending")
    .gt("expires_at", new Date().toISOString())
    .order("created_at", { ascending: false });

  if (error) {
    throw new Error(`Failed to load invitations: ${error.message}`);
  }

  return (data as unknown as InvitationRow[])
    .map(toInvitationView)
    .filter(
      (view): view is InvitationView =>
        view !== null && view.state === "pending" && view.organization.available,
    );
}
