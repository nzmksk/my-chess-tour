import { ChipSendError } from "@/services/chip/send";

// How a CHIP Send failure is described and classified. Shared by every money-out
// path that sends an instruction: organizer payouts (execute.ts) and prize awards
// (src/services/prizes/execute.ts), so they retry, release and fail on exactly
// the same answers.

/**
 * CHIP error bodies can echo the submitted account number; keep long digit runs
 * out of the logs and out of failure_reason, which organizers and admins read.
 */
export function redactDigits(text: string): string {
  return text.replace(/\d{6,}/g, "[redacted]");
}

export function describeSendError(err: unknown): string {
  if (err instanceof ChipSendError) {
    return `CHIP Send ${err.status}: ${redactDigits(err.body)}`;
  }
  return err instanceof Error ? redactDigits(err.message) : String(err);
}

/** A PostgREST error's SQLSTATE says more than its message alone. */
export function describeDbError(error: { code?: string; message: string }): string {
  return error.code ? `${error.code}: ${error.message}` : error.message;
}

/**
 * A 4xx usually means CHIP refused the transfer, which is terminal. These don't:
 * a 401 is our credentials or clock, and a 408/429 is timing. None of them says
 * anything about the transfer, so failing it would email someone about a problem
 * that is ours, and re-sending later is safe because `reference` dedupes.
 */
export function isRetryableStatus(status: number): boolean {
  return status === 401 || status === 408 || status === 429 || status >= 500;
}

/**
 * Of the retryable failures, the ones where CHIP certainly created nothing: it
 * rejected our signature (401) or turned us away before reading the request
 * (429). A timeout, a 5xx or a dropped connection may have reached CHIP, so the
 * claim has to stay.
 */
export function isRefusedBeforeSending(status: number): boolean {
  return status === 401 || status === 429;
}
