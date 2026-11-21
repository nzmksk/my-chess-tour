import { after } from "next/server";
import { flush, type Event } from "@sentry/nextjs";

const FLUSH_TIMEOUT_MS = 2000;

export function flushAfterResponseIntegration() {
  return {
    name: "FlushAfterResponse",
    processEvent(event: Event): Event {
      try {
        after(() => flush(FLUSH_TIMEOUT_MS));
      } catch {}
      return event;
    },
  };
}
