import { AsyncLocalStorage } from "node:async_hooks";

/**
 * Who caused a database write, and why — for `audit_logs` (#470).
 *
 * The audit trigger can only see a JWT `sub` when a user's own session makes the
 * write, and almost every write here goes through the service-role client,
 * which has none. So the server names the actor and the reason itself, on each
 * request `supabaseAdmin` sends to PostgREST, as two headers:
 *
 *   x-audit-actor    the `public.users.id` of the signed-in user whose request
 *                    caused the write (omitted when nobody is signed in: a
 *                    webhook, a cron job)
 *   x-audit-context  a short label for what was done
 *
 * `audit_trigger_func` trusts them only on a service-role request
 * (supabase/migrations/20261120042837_audit_actor_and_context.sql), so a client
 * sending them with the public key changes nothing.
 *
 * The scope is per request (AsyncLocalStorage), so nothing has to be threaded
 * through the services a route calls: open it once with `withAuditContext` on
 * the route handler, and every `supabaseAdmin` write underneath, including work
 * scheduled with `afterResponse` (Next binds those callbacks to the request's
 * async context), is labelled. The actor is filled in by `getAuthClaims` the
 * first time the route resolves the session (`noteAuditActor`), so routes don't
 * pass it either.
 *
 * Context labels are `area.action`, lower-case with dots and hyphens:
 * `tournament.publish`, `admin.payout.review`, `webhook.chip`, `cron.refunds`.
 * The column holds 100 characters.
 */
type AuditScope = {
  readonly context: string;
  actorId: string | null;
};

const scopes = new AsyncLocalStorage<AuditScope>();

/**
 * Runs `fn` with every `supabaseAdmin` request inside it labelled `context`.
 * Pass `actorId` when the caller already knows who acted and may never resolve
 * the session itself (a page helper given the user's id). Without it, the first
 * `getAuthClaims` call inside the scope supplies it.
 *
 * `fn`'s result is awaited inside the scope. A Supabase query builder is lazy:
 * it sends nothing until something awaits it, so `() => supabaseAdmin.rpc(...)`
 * returned un-awaited would otherwise run after the scope had closed, with no
 * audit headers.
 */
export function runWithAuditContext<T>(
  context: string,
  fn: () => T | PromiseLike<T>,
  actorId: string | null = null,
): Promise<T> {
  return scopes.run({ context, actorId }, async () => await fn());
}

/**
 * Wraps a route handler so its whole request runs in an audit scope:
 *
 * ```ts
 * async function publishTournament(request: NextRequest, ctx: Ctx) { ... }
 * export const POST = withAuditContext("tournament.publish", publishTournament);
 * ```
 *
 * The wrapper has the handler's exact signature, so Next's route type checks
 * and the route tests see no difference.
 */
export function withAuditContext<A extends unknown[], R>(
  context: string,
  handler: (...args: A) => Promise<R>,
): (...args: A) => Promise<R> {
  return (...args: A) => runWithAuditContext(context, () => handler(...args));
}

/**
 * Records the signed-in user as the actor of the current scope, unless one is
 * already set. Called by `getAuthClaims`; a no-op outside a scope.
 */
export function noteAuditActor(userId: string): void {
  const scope = scopes.getStore();
  if (scope && scope.actorId === null) scope.actorId = userId;
}

/**
 * `init` with the current scope's audit headers added, for the service-role
 * client's `fetch`. Outside a scope it returns `init` unchanged, and the
 * trigger falls back to context 'trigger' with no actor, as before #470.
 */
export function withAuditHeaders(init?: RequestInit): RequestInit | undefined {
  const scope = scopes.getStore();
  if (!scope) return init;

  const headers = new Headers(init?.headers);
  headers.set("x-audit-context", scope.context);
  if (scope.actorId) headers.set("x-audit-actor", scope.actorId);
  return { ...init, headers };
}
