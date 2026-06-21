export type ApprovalStatus = "pending" | "approved" | "rejected";

export interface OrgApplication {
  id: string;
  name: string;
  approval_status: ApprovalStatus;
  rejection_reason: string | null;
  created_at: string;
  reviewed_at: string | null;
}
