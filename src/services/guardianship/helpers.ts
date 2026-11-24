import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/services/supabase/admin";
import { internalErrorResponse } from "@/lib/http/internal-error";
import {
  INVITATION_TOKEN_RE,
  hashInvitationToken,
  invitationState,
  personName,
  type InvitationState,
} from "@/services/organizations/invitations";
import type { HelperRelationship } from "@/lib/guardianship/helper-relationships";

export function helperInvitationUrl(token: string): string {
  const siteUrl = process.env.NEXT_PUBLIC_SITE_URL ?? "http://localhost:3000";
  return `${siteUrl}/helper-invitations/${token}`;
}

const HOUR_MS = 60 * 60 * 1000;

function hoursUntil(expiresAt: string, now: Date = new Date()): number {
  return Math.max(
    0,
    Math.ceil((new Date(expiresAt).getTime() - now.getTime()) / HOUR_MS),
  );
}

type Person = { first_name: string | null; last_name: string | null } | null;

export interface HelperInvitationView {
  id: string;
  email: string;
  relationship: HelperRelationship;
  state: InvitationState;
  expiresAt: string;
  hoursLeft: number;
  playerName: string | null;
}

interface HelperInvitationRow {
  id: string;
  email: string;
  relationship: HelperRelationship;
  status: "pending" | "accepted" | "declined" | "revoked";
  expires_at: string;
  player: Person;
}

export async function getHelperInvitationByToken(
  token: string,
): Promise<HelperInvitationView | null> {
  if (!INVITATION_TOKEN_RE.test(token)) return null;

  const { data, error } = await supabaseAdmin
    .from("helper_invitations")
    .select(
      "id, email, relationship, status, expires_at, player:users!player_user_id(first_name, last_name)",
    )
    .eq("token_hash", hashInvitationToken(token))
    .maybeSingle();

  if (error) {
    throw new Error(`Failed to load helper invitation: ${error.message}`);
  }
  if (!data) return null;

  const row = data as unknown as HelperInvitationRow;
  return {
    id: row.id,
    email: row.email,
    relationship: row.relationship,
    state: invitationState(row.status, row.expires_at),
    expiresAt: row.expires_at,
    hoursLeft: hoursUntil(row.expires_at),
    playerName: personName(row.player),
  };
}

export interface HelperView {
  guardianship_id: string;
  name: string | null;
  relationship: string;
  authorisation_method: string | null;
  since: string;
}

export interface PendingHelperInvitation {
  id: string;
  email: string;
  relationship: HelperRelationship;
  expires_at: string;
  state: "pending" | "expired";
}

export interface HelpersOverview {
  can_invite: boolean;
  helpers: HelperView[];
  invitations: PendingHelperInvitation[];
  helping: HelperView[];
}

interface GuardianshipRow {
  id: string;
  relationship: string;
  authorisation_method: string | null;
  created_at: string;
  terms_accepted_at: string;
  person: (NonNullable<Person> & { account_type?: string }) | null;
}

function toHelperView(row: GuardianshipRow): HelperView {
  return {
    guardianship_id: row.id,
    name: personName(row.person),
    relationship: row.relationship,
    authorisation_method: row.authorisation_method,
    since: row.terms_accepted_at ?? row.created_at,
  };
}

export async function loadHelpersOverview(
  userId: string,
  canInvite: boolean,
): Promise<
  { ok: true; data: HelpersOverview } | { ok: false; error: unknown }
> {
  const [helpersRes, invitationsRes, helpingRes] = await Promise.all([
    supabaseAdmin
      .from("guardianships")
      .select(
        "id, relationship, authorisation_method, created_at, terms_accepted_at, person:users!guardian_user_id(first_name, last_name)",
      )
      .eq("dependent_user_id", userId)
      .eq("status", "active")
      .order("created_at", { ascending: true }),
    supabaseAdmin
      .from("helper_invitations")
      .select("id, email, relationship, status, expires_at")
      .eq("player_user_id", userId)
      .eq("status", "pending")
      .order("created_at", { ascending: false }),
    supabaseAdmin
      .from("guardianships")
      .select(
        "id, relationship, authorisation_method, created_at, terms_accepted_at, person:users!dependent_user_id(first_name, last_name, account_type)",
      )
      .eq("guardian_user_id", userId)
      .eq("status", "active")
      .order("created_at", { ascending: true }),
  ]);

  const error = helpersRes.error ?? invitationsRes.error ?? helpingRes.error;
  if (error) return { ok: false, error };

  const invitations = (
    (invitationsRes.data ?? []) as unknown as HelperInvitationRow[]
  ).map((row) => ({
    id: row.id,
    email: row.email,
    relationship: row.relationship,
    expires_at: row.expires_at,
    state:
      invitationState(row.status, row.expires_at) === "expired"
        ? ("expired" as const)
        : ("pending" as const),
  }));

  return {
    ok: true,
    data: {
      can_invite: canInvite,
      helpers: ((helpersRes.data ?? []) as unknown as GuardianshipRow[]).map(
        toHelperView,
      ),
      invitations,
      helping: ((helpingRes.data ?? []) as unknown as GuardianshipRow[])
        .filter((row) => row.person?.account_type === "self")
        .map(toHelperView),
    },
  };
}

export function helperErrorResponse(
  error: { code?: string; message: string },
  action: string,
): NextResponse {
  const respond = (code: string, message: string, status: number) =>
    NextResponse.json({ error: { code, message } }, { status });
  const is = (sentinel: string) => error.message.startsWith(sentinel);

  if (is("INVITATION_NOT_FOUND")) {
    return respond("NOT_FOUND", "Invitation not found", 404);
  }
  if (is("INVITATION_WRONG_ACCOUNT")) {
    return respond(
      "WRONG_ACCOUNT",
      "This invitation was sent to a different email address. Sign in with that address to accept it.",
      403,
    );
  }
  if (is("INVITATION_EXPIRED")) {
    return respond("INVITATION_EXPIRED", "This invitation has expired", 410);
  }
  if (is("INVITATION_CLOSED")) {
    return respond(
      "INVITATION_CLOSED",
      "This invitation is no longer open",
      409,
    );
  }
  if (is("HELPER_NOT_FOUND")) {
    return respond("NOT_FOUND", "Helper not found", 404);
  }
  if (is("HELPER_SELF")) {
    return respond(
      "VALIDATION_ERROR",
      "You can't be your own helper. Invite someone else's email address.",
      400,
    );
  }
  if (is("HELPER_ALREADY_ACTIVE")) {
    return respond(
      "HELPER_ALREADY_ACTIVE",
      "This person already helps with this account.",
      409,
    );
  }
  if (is("HELPER_INVITE_NOT_ALLOWED")) {
    return respond(
      "FORBIDDEN",
      "Only players aged 18 or over who sign in to their own account can invite a helper.",
      403,
    );
  }
  if (is("HELPER_NOT_ELIGIBLE")) {
    return respond(
      "FORBIDDEN",
      "A helper must sign in to their own account and be 18 or over.",
      403,
    );
  }
  if (is("GUARDIANSHIP_LIMIT_REACHED")) {
    return respond(
      "HELPER_LIMIT_REACHED",
      "You already act for the most players allowed (10). Step down for one before accepting.",
      422,
    );
  }
  if (is("INVALID_HELPER_INVITATION")) {
    return respond(
      "VALIDATION_ERROR",
      "Some of the invitation's details are missing or invalid.",
      400,
    );
  }
  return internalErrorResponse(`Helpers: unexpected error ${action}`, error);
}
