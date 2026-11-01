/**
 * Body of `POST /send/send_instructions` (send money to a registered account).
 *
 * ⚠️ LANDMINE: `amount` is a **string** here, whereas a send limit's `amount`
 * is a JSON **number**. Build this through `createChipSendInstruction`, which
 * takes cents and formats the string — never construct it by hand.
 */
export interface ChipSendInstructionRequest {
  /** The integer id from `POST /send/bank_accounts`. */
  bank_account_id: number;
  /** Decimal string, max 2 dp — e.g. "150.00". */
  amount: string;
  /** Recipient email; receives the receipt if `send_recipient_receipt`. */
  email: string;
  /** 1–140 chars, shown on the recipient's receipt. */
  description: string;
  /**
   * 1–40 chars. Idempotency key — a duplicate returns the existing instruction
   * rather than paying twice, so it must be deterministic per payout.
   */
  reference: string;
  send_recipient_receipt?: boolean;
}

export type ChipSendInstructionState =
  | "received"
  | "enquiring"
  | "executing"
  | "reviewing"
  | "accepted"
  | "completed"
  | "rejected"
  | "deleted";

/** A send instruction (create/retrieve response). */
export interface ChipSendInstruction {
  /** Must be stored — it is the handle for retrieval and webhook correlation. */
  id: number;
  bank_account_id: number;
  /** String, like the request — see the landmine on the request type. */
  amount: string;
  state: ChipSendInstructionState;
  email: string;
  description: string;
  reference: string;
  receipt_url: string;
  slug: string;
  created_at: string;
  updated_at: string;
  send_recipient_receipt: boolean;
}
