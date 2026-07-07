import { redirect } from "next/navigation";
import type { Metadata } from "next";
import NavBar from "@/components/NavBar";
import { createClient } from "@/services/supabase/server";
import { getAuthClaims } from "@/services/supabase/permission";
import { supabaseAdmin } from "@/services/supabase/admin";
import CancellationsClient from "./_components/CancellationsClient";

export const metadata: Metadata = {
  title: "Tournament Cancellations",
  description: "Review organizer requests to cancel published tournaments.",
};

export type RequestStatus = "pending" | "approved" | "rejected";

interface Organization {
  id: string;
  name: string;
}

interface TournamentRef {
  id: string;
  name: string;
  slug: string | null;
  start_date: string;
  organization: Organization | null;
}

interface Requester {
  first_name: string;
  last_name: string;
  email: string;
}

export interface CancellationRequest {
  id: string;
  reason: string;
  status: RequestStatus;
  rejection_reason: string | null;
  created_at: string;
  reviewed_at: string | null;
  tournament: TournamentRef | null;
  requester: Requester | null;
}

export interface CancellationCounts {
  pending: number;
  approved: number;
  rejected: number;
  total: number;
}

// PostgREST embeds a single-FK relation as an object, but the untyped client
// widens it to `object | object[]`; collapse either shape to the first element.
function one<T>(value: T | T[] | null | undefined): T | null {
  if (Array.isArray(value)) return (value[0] as T) ?? null;
  return value ?? null;
}

interface RawTournament {
  id: string;
  name: string;
  slug: string | null;
  start_date: string;
  organization: Organization | Organization[] | null;
}

interface RawRow {
  id: string;
  reason: string;
  status: RequestStatus;
  rejection_reason: string | null;
  created_at: string;
  reviewed_at: string | null;
  tournament: RawTournament | RawTournament[] | null;
  requester: Requester | Requester[] | null;
}

export default async function AdminCancellationsPage() {
  const claims = await getAuthClaims();
  if (!claims) {
    redirect("/auth/login");
  }

  const supabase = await createClient();
  const { data: isAdmin, error: permissionError } = await supabase.rpc(
    "has_global_permission",
    { p_user_id: claims.id, p_permission: "platform.manage" },
  );

  if (permissionError || !isAdmin) {
    redirect("/");
  }

  const { data: rows, error } = await supabaseAdmin
    .from("tournament_cancellation_requests")
    .select(
      `id, reason, status, rejection_reason, created_at, reviewed_at,
       tournament:tournaments(id, name, slug, start_date,
         organization:organizations(id, name)),
       requester:users!requested_by(first_name, last_name, email)`,
    )
    .order("created_at", { ascending: false });

  if (error) {
    redirect("/");
  }

  const requests: CancellationRequest[] = ((rows as RawRow[]) ?? []).map(
    (r) => {
      const t = one(r.tournament);
      return {
        id: r.id,
        reason: r.reason,
        status: r.status,
        rejection_reason: r.rejection_reason,
        created_at: r.created_at,
        reviewed_at: r.reviewed_at,
        tournament: t
          ? {
              id: t.id,
              name: t.name,
              slug: t.slug,
              start_date: t.start_date,
              organization: one(t.organization),
            }
          : null,
        requester: one(r.requester),
      };
    },
  );

  const counts: CancellationCounts = {
    pending: requests.filter((r) => r.status === "pending").length,
    approved: requests.filter((r) => r.status === "approved").length,
    rejected: requests.filter((r) => r.status === "rejected").length,
    total: requests.length,
  };

  return (
    <div className="bg-bg-base min-h-screen">
      <NavBar />
      <CancellationsClient data={{ counts, requests }} />
    </div>
  );
}
