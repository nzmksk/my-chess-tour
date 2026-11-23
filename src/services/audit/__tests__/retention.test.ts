import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { mockRpc } = vi.hoisted(() => ({ mockRpc: vi.fn() }));

vi.mock("@/services/supabase/admin", () => ({
  supabaseAdmin: { rpc: mockRpc },
}));

import {
  AUDIT_LOGS_WARN_BYTES,
  AUDIT_PRUNE_BATCH,
  auditPruneMode,
  pruneAuditLogs,
} from "../retention";

const STORAGE = { total_bytes: 2_000_000, estimated_rows: 700 };

function givenRpc(
  prune: unknown[] | { error: { message: string } },
  storage: unknown = [STORAGE],
) {
  mockRpc.mockImplementation(async (fn: string) => {
    if (fn === "prune_audit_logs") {
      return Array.isArray(prune)
        ? { data: prune, error: null }
        : { data: null, ...prune };
    }
    if (fn === "audit_logs_storage") return { data: storage, error: null };
    throw new Error(`unexpected rpc ${fn}`);
  });
}

describe("auditPruneMode", () => {
  afterEach(() => vi.unstubAllEnvs());

  it("is a dry run unless AUDIT_LOG_PRUNE is exactly 'delete'", () => {
    vi.stubEnv("AUDIT_LOG_PRUNE", "");
    expect(auditPruneMode()).toBe("dry_run");
    vi.stubEnv("AUDIT_LOG_PRUNE", "true");
    expect(auditPruneMode()).toBe("dry_run");
    vi.stubEnv("AUDIT_LOG_PRUNE", "delete");
    expect(auditPruneMode()).toBe("delete");
  });
});

describe("pruneAuditLogs", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(console, "error").mockImplementation(() => {});
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });

  it("asks for a dry run by default and reports the per-table counts", async () => {
    givenRpc([
      { audited_table: "registrations", eligible: 12, deleted: 0 },
      { audited_table: "users", eligible: 3, deleted: 0 },
    ]);

    const result = await pruneAuditLogs();

    expect(mockRpc).toHaveBeenCalledWith("prune_audit_logs", {
      p_dry_run: true,
      p_limit: AUDIT_PRUNE_BATCH,
    });
    expect(result).toEqual({
      mode: "dry_run",
      tables: [
        { audited_table: "registrations", eligible: 12, deleted: 0 },
        { audited_table: "users", eligible: 3, deleted: 0 },
      ],
      eligible: 15,
      deleted: 0,
      more: false,
      storage: STORAGE,
    });
  });

  it("deletes when AUDIT_LOG_PRUNE=delete, and says when rows are left for the next call", async () => {
    vi.stubEnv("AUDIT_LOG_PRUNE", "delete");
    givenRpc([
      { audited_table: "registrations", eligible: 7000, deleted: 5000 },
      { audited_table: "users", eligible: 10, deleted: 0 },
    ]);

    const result = await pruneAuditLogs();

    expect(mockRpc).toHaveBeenCalledWith("prune_audit_logs", {
      p_dry_run: false,
      p_limit: AUDIT_PRUNE_BATCH,
    });
    expect(result.mode).toBe("delete");
    expect(result.deleted).toBe(5000);
    expect(result.more).toBe(true);
  });

  it("isn't 'more' once a delete run has cleared everything", async () => {
    vi.stubEnv("AUDIT_LOG_PRUNE", "delete");
    givenRpc([{ audited_table: "users", eligible: 4, deleted: 4 }]);

    expect((await pruneAuditLogs()).more).toBe(false);
  });

  it("throws when the prune call fails", async () => {
    givenRpc({ error: { message: "boom" } });
    await expect(pruneAuditLogs()).rejects.toThrow(
      "Audit-log prune failed: boom",
    );
  });

  it("logs an error, which reaches Sentry, when the table passes the warning size", async () => {
    givenRpc(
      [],
      [{ total_bytes: AUDIT_LOGS_WARN_BYTES + 1, estimated_rows: 1 }],
    );

    await pruneAuditLogs();

    expect(console.error).toHaveBeenCalledWith(
      expect.stringContaining("over the 250 MB warning level"),
    );
  });

  it("stays quiet below the warning size", async () => {
    givenRpc([]);
    await pruneAuditLogs();
    expect(console.error).not.toHaveBeenCalled();
  });

  it("still reports the prune when the size can't be read", async () => {
    givenRpc([{ audited_table: "users", eligible: 1, deleted: 0 }], []);

    const result = await pruneAuditLogs();

    expect(result.eligible).toBe(1);
    expect(result.storage).toBeNull();
    expect(console.error).toHaveBeenCalled();
  });
});
