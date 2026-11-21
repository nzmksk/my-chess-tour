import { AsyncLocalStorage } from "node:async_hooks";

type AuditScope = {
  readonly context: string;
  actorId: string | null;
};

const scopes = new AsyncLocalStorage<AuditScope>();

export function runWithAuditContext<T>(
  context: string,
  fn: () => T | PromiseLike<T>,
  actorId: string | null = null,
): Promise<T> {
  return scopes.run({ context, actorId }, async () => await fn());
}

export function withAuditContext<A extends unknown[], R>(
  context: string,
  handler: (...args: A) => Promise<R>,
): (...args: A) => Promise<R> {
  return (...args: A) => runWithAuditContext(context, () => handler(...args));
}

export function noteAuditActor(userId: string): void {
  const scope = scopes.getStore();
  if (scope && scope.actorId === null) scope.actorId = userId;
}

export function withAuditHeaders(init?: RequestInit): RequestInit | undefined {
  const scope = scopes.getStore();
  if (!scope) return init;

  const headers = new Headers(init?.headers);
  headers.set("x-audit-context", scope.context);
  if (scope.actorId) headers.set("x-audit-actor", scope.actorId);
  return { ...init, headers };
}
