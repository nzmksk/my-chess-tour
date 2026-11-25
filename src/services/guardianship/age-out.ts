import { supabaseAdmin } from "@/services/supabase/admin";
import { sendGuardianshipAgeOutEmail } from "@/services/email/email";
import {
  AGE_OUT_GRACE_DAYS,
  AGE_OUT_NOTICE_DAYS,
} from "@/lib/guardianship/age-out";
import {
  addCalendarDays,
  formatCalendarDate,
} from "@/lib/tournaments/datetime";

type AgeOutStage = "upcoming" | "turned_18" | "ended";

interface AgeOutRow {
  stage: AgeOutStage;
  guardianship_id: string;
  guardian_user_id: string;
  dependent_user_id: string;
  turns_18_on: string;
  access_ends_on: string;
}

interface Person {
  id: string;
  email: string | null;
  contact_email: string | null;
  first_name: string | null;
  last_name: string | null;
}

export interface AgeOutRunStats {
  ended: number;
  notices: number;
  emailed: number;
  failed: number;
}

export async function runGuardianshipAgeOuts(): Promise<AgeOutRunStats> {
  const ended = await supabaseAdmin.rpc("end_aged_out_minor_guardianships", {
    p_grace_days: AGE_OUT_GRACE_DAYS,
  });
  if (ended.error) {
    throw new Error(
      `end_aged_out_minor_guardianships failed: ${ended.error.message}`,
    );
  }
  const due = await supabaseAdmin.rpc("claim_guardianship_age_out_notices", {
    p_notice_days: AGE_OUT_NOTICE_DAYS,
    p_grace_days: AGE_OUT_GRACE_DAYS,
  });
  if (due.error) {
    throw new Error(
      `claim_guardianship_age_out_notices failed: ${due.error.message}`,
    );
  }

  const endedRows = (ended.data ?? []) as Omit<
    AgeOutRow,
    "stage" | "access_ends_on"
  >[];
  const rows: AgeOutRow[] = [
    ...endedRows.map((r) => ({
      ...r,
      stage: "ended" as const,
      access_ends_on: addCalendarDays(r.turns_18_on, AGE_OUT_GRACE_DAYS),
    })),
    ...((due.data ?? []) as AgeOutRow[]),
  ];
  const stats: AgeOutRunStats = {
    ended: endedRows.length,
    notices: rows.length - endedRows.length,
    emailed: 0,
    failed: 0,
  };
  if (rows.length === 0) return stats;

  const ids = [
    ...new Set(rows.flatMap((r) => [r.guardian_user_id, r.dependent_user_id])),
  ];
  const { data, error } = await supabaseAdmin
    .from("users")
    .select("id, email, contact_email, first_name, last_name")
    .in("id", ids);
  if (error) {
    console.error(
      "Guardianship age-outs: failed to load the people to email",
      error.message,
    );
    stats.failed = rows.length;
    return stats;
  }
  const people = new Map(((data ?? []) as Person[]).map((p) => [p.id, p]));

  const sends: Promise<void>[] = [];
  for (const row of rows) {
    const guardian = people.get(row.guardian_user_id);
    const player = people.get(row.dependent_user_id);
    const playerName =
      [player?.first_name, player?.last_name].filter(Boolean).join(" ") ||
      "Your dependent";
    const guardianName =
      [guardian?.first_name, guardian?.last_name].filter(Boolean).join(" ") ||
      "Your guardian";
    const base = {
      stage: row.stage,
      playerName,
      guardianName,
      turns18On: formatCalendarDate(row.turns_18_on),
      accessEndsOn: formatCalendarDate(row.access_ends_on),
    };
    if (guardian?.email) {
      sends.push(
        sendGuardianshipAgeOutEmail(guardian.email, {
          ...base,
          audience: "guardian",
          recipientName: guardian.first_name || "there",
        }),
      );
    }
    if (player?.contact_email) {
      sends.push(
        sendGuardianshipAgeOutEmail(player.contact_email, {
          ...base,
          audience: "player",
          recipientName: player.first_name || "there",
        }),
      );
    }
  }

  const results = await Promise.allSettled(sends);
  for (const result of results) {
    if (result.status === "fulfilled") stats.emailed++;
    else {
      stats.failed++;
      console.error(
        "Guardianship age-outs: an email failed",
        result.reason instanceof Error ? result.reason.message : result.reason,
      );
    }
  }
  return stats;
}
