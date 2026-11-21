import { ChipSendError } from "@/services/chip/send";

export function redactDigits(text: string): string {
  return text.replace(/\d{6,}/g, "[redacted]");
}

export function describeSendError(err: unknown): string {
  if (err instanceof ChipSendError) {
    return `CHIP Send ${err.status}: ${redactDigits(err.body)}`;
  }
  return err instanceof Error ? redactDigits(err.message) : String(err);
}

export function describeDbError(error: { code?: string; message: string }): string {
  return error.code ? `${error.code}: ${error.message}` : error.message;
}

export function isRetryableStatus(status: number): boolean {
  return status === 401 || status === 408 || status === 429 || status >= 500;
}

export function isRefusedBeforeSending(status: number): boolean {
  return status === 401 || status === 429;
}
