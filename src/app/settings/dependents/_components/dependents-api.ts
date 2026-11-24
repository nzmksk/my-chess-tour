import type { DependentView } from "@/services/guardianship/dependents";

export type ApiResult<T> = { ok: true; data: T } | { ok: false; error: string };

export interface UpcomingRegistration {
  registration_id: string;
  tournament_id: string;
  tournament_name: string;
  start_date: string;
}

export interface RevokeResult {
  upcoming_registrations: UpcomingRegistration[];
  warning: string | null;
}

export type CreatedDependent = DependentView & { reactivated: boolean };

const NETWORK_ERROR = "A network error occurred. Please try again.";

async function send<T>(
  url: string,
  init: RequestInit,
  fallback: string,
): Promise<ApiResult<T>> {
  try {
    const res = await fetch(url, { cache: "no-store", ...init });
    const json = await res.json().catch(() => null);
    if (!res.ok) {
      return { ok: false, error: json?.error?.message ?? fallback };
    }
    return { ok: true, data: json?.data as T };
  } catch {
    return { ok: false, error: NETWORK_ERROR };
  }
}

function jsonBody(method: string, body: unknown): RequestInit {
  return {
    method,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  };
}

export function fetchDependents(): Promise<ApiResult<DependentView[]>> {
  return send("/api/v1/me/dependents", {}, "We couldn't load your dependents.");
}

export function createDependent(
  body: Record<string, unknown>,
): Promise<ApiResult<CreatedDependent>> {
  return send(
    "/api/v1/me/dependents",
    jsonBody("POST", body),
    "The dependent couldn't be added.",
  );
}

export function updateDependent(
  id: string,
  body: Record<string, unknown>,
): Promise<ApiResult<DependentView>> {
  return send(
    `/api/v1/me/dependents/${id}`,
    jsonBody("PATCH", body),
    "The changes couldn't be saved.",
  );
}

export function revokeDependent(id: string): Promise<ApiResult<RevokeResult>> {
  return send(
    `/api/v1/me/dependents/${id}`,
    { method: "DELETE" },
    "The dependent couldn't be removed.",
  );
}
