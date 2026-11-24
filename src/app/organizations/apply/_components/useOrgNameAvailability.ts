"use client";

import { useEffect, useState } from "react";

export type NameAvailability =
  | "idle"
  | "checking"
  | "available"
  | "taken"
  | "unknown";

export const NAME_CHECK_DELAY_MS = 400;

interface CheckResult {
  name: string;
  availability: NameAvailability;
}

export function useOrgNameAvailability(name: string): NameAvailability {
  const trimmed = name.trim();
  const [result, setResult] = useState<CheckResult | null>(null);

  useEffect(() => {
    if (trimmed === "") return;

    const controller = new AbortController();
    const timer = setTimeout(async () => {
      try {
        const res = await fetch(
          `/api/v1/organizations/name-availability?name=${encodeURIComponent(trimmed)}`,
          { signal: controller.signal },
        );
        const json = res.ok ? await res.json() : null;
        const available = json?.data?.available;
        setResult({
          name: trimmed,
          availability:
            available === true
              ? "available"
              : available === false
                ? "taken"
                : "unknown",
        });
      } catch {
        if (!controller.signal.aborted) {
          setResult({ name: trimmed, availability: "unknown" });
        }
      }
    }, NAME_CHECK_DELAY_MS);

    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [trimmed]);

  if (trimmed === "") return "idle";
  return result?.name === trimmed ? result.availability : "checking";
}
