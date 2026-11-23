import { supabaseAdmin } from "@/services/supabase/admin";

export const AUDIT_PRUNE_BATCH = 5000;

export const AUDIT_LOGS_WARN_BYTES = 250 * 1024 * 1024;

type AuditPruneMode = "dry_run" | "delete";

interface AuditPruneTable {
  audited_table: string;
  eligible: number;
  deleted: number;
}

interface AuditLogsStorage {
  total_bytes: number;
  estimated_rows: number;
}

interface AuditPruneResult {
  mode: AuditPruneMode;
  tables: AuditPruneTable[];
  eligible: number;
  deleted: number;
  more: boolean;
  storage: AuditLogsStorage | null;
}

export function auditPruneMode(): AuditPruneMode {
  return process.env.AUDIT_LOG_PRUNE === "delete" ? "delete" : "dry_run";
}

async function loadStorage(): Promise<AuditLogsStorage | null> {
  const { data, error } = await supabaseAdmin.rpc("audit_logs_storage");
  const row = (data as AuditLogsStorage[] | null)?.[0];
  if (error || !row) {
    console.error(
      "Audit-log prune: couldn't read the table size",
      error?.message,
    );
    return null;
  }
  const storage = {
    total_bytes: Number(row.total_bytes),
    estimated_rows: Number(row.estimated_rows),
  };
  if (storage.total_bytes > AUDIT_LOGS_WARN_BYTES) {
    console.error(
      `audit_logs is ${Math.round(storage.total_bytes / 1024 / 1024)} MB (about ${storage.estimated_rows} rows), over the ${AUDIT_LOGS_WARN_BYTES / 1024 / 1024} MB warning level`,
    );
  }
  return storage;
}

export async function pruneAuditLogs(): Promise<AuditPruneResult> {
  const mode = auditPruneMode();

  const { data, error } = await supabaseAdmin.rpc("prune_audit_logs", {
    p_dry_run: mode === "dry_run",
    p_limit: AUDIT_PRUNE_BATCH,
  });
  if (error) {
    throw new Error(
      `Audit-log prune failed: ${error.message ?? String(error)}`,
    );
  }

  const tables = ((data as AuditPruneTable[] | null) ?? []).map((t) => ({
    audited_table: t.audited_table,
    eligible: Number(t.eligible),
    deleted: Number(t.deleted),
  }));
  const eligible = tables.reduce((sum, t) => sum + t.eligible, 0);
  const deleted = tables.reduce((sum, t) => sum + t.deleted, 0);

  return {
    mode,
    tables,
    eligible,
    deleted,
    more: mode === "delete" && eligible > deleted,
    storage: await loadStorage(),
  };
}
