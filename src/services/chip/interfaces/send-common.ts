interface ChipSendPagination {
  current_page: number;
  prev_page: number | null;
  next_page: number | null;
  total_pages: number;
  total_count: number;
}

export interface ChipSendList<T> {
  results: T[];
  meta: { pagination: ChipSendPagination };
}

export type ChipSendCurrency = "MYR";
export type ChipSendFeeType = "flat" | "percentage";
