// Client-only key for a dynamically added form row (fee tier, prize,
// restriction). Rows only need to be distinguishable within one wizard
// session; the value is never sent to the API.
//
// This lives at module scope so it is called from event handlers only —
// generating ids in a component body would make render non-idempotent.
export function newRowId(): string {
  return `${Date.now()}-${Math.random()}`;
}
