import { formatRinggit, parseSentinel } from "@/services/payouts/format";

const NOT_ALLOWED: Record<string, string> = {
  not_platform_distributed:
    "This tournament's winners are paid by the organizer, not through MY Chess Tour.",
  tournament_not_published: "The tournament isn't published.",
  tournament_cancelled: "The tournament has been cancelled.",
  cancellation_pending: "A cancellation request for this tournament is under review.",
  tournament_not_finished: "Winners can be entered from the last day of play.",
  winner_not_registered: "The winner must be a confirmed participant of this tournament.",
  prize_not_declared: "That prize isn't one this tournament declares.",
  pool_not_funded: "The prize pool isn't fully funded yet.",
  winner_missing: "The winner's account no longer exists.",
};

export function describePrizeAwardRefusal(message: string | null | undefined): string | null {
  const parsed = parseSentinel(message);
  if (!parsed) return null;
  const detail = parsed.detail.trim();
  switch (parsed.sentinel) {
    case "PRIZE_AWARD_NOT_ALLOWED":
      return NOT_ALLOWED[detail] ?? "This prize award isn't allowed now.";
    case "PRIZE_AWARD_EXCEEDS_PRIZE": {
      const m = detail.match(/^(\d+) cents requested, (-?\d+) cents of this prize is left$/);
      return m
        ? `Only ${formatRinggit(Math.max(0, Number(m[2])))} of this prize is left to award.`
        : "That is more than this prize is worth.";
    }
    case "PRIZE_AWARD_EXCEEDS_POOL": {
      const m = detail.match(/^(\d+) cents requested, (\d+) cents of the collected pool is uncommitted$/);
      return m
        ? `This award is ${formatRinggit(Number(m[1]))}, but only ${formatRinggit(Number(m[2]))} of the collected pool is uncommitted.`
        : "This award is more than the collected pool can cover.";
    }
    case "PRIZE_AWARD_ALREADY_REVIEWED":
      return "This award has already been reviewed.";
    default:
      return null;
  }
}

export function prizeAwardStateLabel(award: {
  approval: string;
  status: string;
}): string {
  if (award.approval === "rejected") return "Rejected";
  if (award.approval === "pending") return "Awaiting review";
  switch (award.status) {
    case "paid":
      return "Paid";
    case "failed":
      return "Failed";
    case "processing":
      return "Sending";
    default:
      return "Approved";
  }
}
