"use client";

import { useEffect } from "react";
import * as Sentry from "@sentry/nextjs";
import "@/styles/globals.css";

/**
 * Last-resort boundary: catches render errors anywhere in the app, including
 * the root layout, and replaces the whole document. React swallows errors an
 * error boundary catches, so Sentry's global handlers never see them — report
 * explicitly. (Server render errors are also reported by `onRequestError`; the
 * client copy carries only the digest, which links the two in Sentry.)
 */
export default function GlobalError({
  error,
  retry,
}: {
  error: unknown;
  retry: () => void;
}) {
  useEffect(() => {
    Sentry.captureException(error);
  }, [error]);

  return (
    <html lang="en" data-theme="dark">
      <body>
        <title>Something went wrong | MY Chess Tour</title>
        <main className="bg-bg-base flex h-screen flex-col items-center justify-center gap-8 px-6 text-center">
          <span className="text-gold-bright text-6xl select-none" aria-hidden>
            ♚
          </span>

          <div className="flex flex-col items-center">
            <h1 className="text-gold-bright text-4xl">Something went wrong</h1>

            <div className="divider-gold" />

            <p className="text-text-body max-w-sm pt-4">
              An unexpected error stopped this page from loading. We&apos;ve
              been notified. Please try again in a moment.
            </p>
          </div>

          <button
            type="button"
            onClick={() => retry()}
            className="btn-primary w-fit px-8 py-3"
          >
            Try Again
          </button>
        </main>
      </body>
    </html>
  );
}
