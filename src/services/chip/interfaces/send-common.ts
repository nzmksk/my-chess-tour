// Types shared by the CHIP Send payloads. Source of truth:
// https://docs.chip-in.asia/openapi/chip-send.yaml — CHIP Send is a different
// API from Collect (different host, three-header auth, HMAC webhooks), so none
// of the Collect types in common.ts apply here.

/** Pagination block on CHIP Send list responses (`meta.pagination`). */
export interface ChipSendPagination {
  current_page: number;
  prev_page: number | null;
  next_page: number | null;
  total_pages: number;
  total_count: number;
}

/** Envelope of every CHIP Send list endpoint. */
export interface ChipSendList<T> {
  results: T[];
  meta: { pagination: ChipSendPagination };
}

export type ChipSendCurrency = "MYR";
export type ChipSendFeeType = "flat" | "percentage";
