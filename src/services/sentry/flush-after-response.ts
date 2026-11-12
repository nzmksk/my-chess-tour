import { after } from "next/server";
import { flush, type Event } from "@sentry/nextjs";

const FLUSH_TIMEOUT_MS = 2000;

/**
 * Keep the serverless function alive until captured events are sent.
 *
 * Sentry queues events and sends them in the background. It only forces a
 * flush before a function freezes on Vercel and Cloudflare; on Netlify's Node
 * functions it does not, so an event captured during a request that then
 * returns normally — exactly the `console.error`-and-return-500 path this app
 * relies on — can be lost when the function is frozen. (Thrown errors are
 * fine: `captureRequestError` flushes on its own.)
 *
 * Scheduling `flush` with Next's `after()` makes the platform wait for it
 * after the response is sent, so the user is not kept waiting either.
 */
export function flushAfterResponseIntegration() {
  return {
    name: "FlushAfterResponse",
    processEvent(event: Event): Event {
      try {
        after(() => flush(FLUSH_TIMEOUT_MS));
      } catch {
        // Not inside a request (startup, a timer, or after the response has
        // already closed): nothing to keep alive, the normal send applies.
      }
      return event;
    },
  };
}
