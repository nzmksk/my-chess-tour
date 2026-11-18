"use client";

import { useId, useState, type FormEvent } from "react";
import { Bug } from "lucide-react";
import { lastEventId } from "@sentry/nextjs";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  DESCRIPTION_MAX_LENGTH,
  DETAILS_MAX_LENGTH,
} from "@/services/bug-reports/format";

type Status =
  | { kind: "editing"; error: string | null }
  | { kind: "sending" }
  | { kind: "sent"; reference: string; savedOnly: boolean };

const GENERIC_ERROR =
  "We couldn't send your report. Please try again in a moment.";

/**
 * "Report a bug" (#616): a floating button on every page that opens a short
 * form. The report is filed as an issue on our public GitHub repo by
 * POST /api/v1/feedback, without the reporter's identity, and the reporter is
 * shown a reference rather than the issue link.
 */
export function BugReport() {
  const [open, setOpen] = useState(false);
  const [description, setDescription] = useState("");
  const [details, setDetails] = useState("");
  const [website, setWebsite] = useState("");
  const [status, setStatus] = useState<Status>({
    kind: "editing",
    error: null,
  });
  const ids = useId();

  function handleOpenChange(next: boolean) {
    setOpen(next);
    // Start fresh after a report went through; keep an unsent draft.
    if (!next && status.kind === "sent") {
      setDescription("");
      setDetails("");
      setStatus({ kind: "editing", error: null });
    }
  }

  async function handleSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!description.trim()) {
      setStatus({ kind: "editing", error: "Tell us what happened." });
      return;
    }
    setStatus({ kind: "sending" });

    try {
      const res = await fetch("/api/v1/feedback", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          description,
          details: details || undefined,
          path: window.location.pathname,
          viewport: { width: window.innerWidth, height: window.innerHeight },
          sentryEventId: lastEventId(),
          website,
        }),
      });
      const json = (await res.json().catch(() => null)) as {
        reference?: string;
        error?: { code?: string; message?: string };
      } | null;

      if (res.ok && json?.reference) {
        setStatus({
          kind: "sent",
          reference: json.reference,
          savedOnly: false,
        });
        return;
      }
      // Saved, but not yet passed on to GitHub: support files it by hand, so
      // from the reporter's side it is done.
      if (json?.error?.code === "FILING_FAILED" && json.reference) {
        setStatus({ kind: "sent", reference: json.reference, savedOnly: true });
        return;
      }
      setStatus({
        kind: "editing",
        error:
          res.status === 429 || res.status === 400
            ? (json?.error?.message ?? GENERIC_ERROR)
            : GENERIC_ERROR,
      });
    } catch {
      setStatus({ kind: "editing", error: GENERIC_ERROR });
    }
  }

  const sending = status.kind === "sending";

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="border-border-gold bg-bg-raised text-gold-muted hover:text-gold-bright font-cinzel fixed right-4 bottom-4 z-40 flex items-center gap-2 rounded-full border px-3 py-2 text-xs font-semibold tracking-widest uppercase shadow-lg transition-colors print:hidden"
      >
        <Bug className="size-4" aria-hidden="true" />
        <span className="sr-only sm:not-sr-only">Report a bug</span>
      </button>

      <Dialog open={open} onOpenChange={handleOpenChange}>
        <DialogContent className="bg-bg-raised border-border">
          {status.kind === "sent" ? (
            <>
              <DialogHeader>
                <DialogTitle className="font-cinzel text-text-primary">
                  Thanks for the report
                </DialogTitle>
                <DialogDescription className="font-lato text-text-secondary">
                  {status.savedOnly
                    ? "We've saved it and the team will pick it up shortly."
                    : "It's with the team now."}{" "}
                  If you contact us about it, quote this reference:
                </DialogDescription>
              </DialogHeader>
              <p className="font-cinzel text-gold-bright text-center text-lg tracking-widest">
                {status.reference}
              </p>
              <DialogFooter>
                <button
                  type="button"
                  className="btn-primary w-full sm:w-auto sm:px-6"
                  onClick={() => handleOpenChange(false)}
                >
                  Done
                </button>
              </DialogFooter>
            </>
          ) : (
            <form onSubmit={handleSubmit} noValidate>
              <DialogHeader className="mb-4">
                <DialogTitle className="font-cinzel text-text-primary">
                  Report a bug
                </DialogTitle>
                <DialogDescription className="font-lato text-text-secondary">
                  Your report is posted publicly on our GitHub issue tracker. It
                  doesn&apos;t include your name, email or account, so please
                  don&apos;t type personal details. We add the page you&apos;re
                  on, your browser and your screen size.
                </DialogDescription>
              </DialogHeader>

              {status.kind === "editing" && status.error && (
                <div className="error-banner" role="alert">
                  <p className="error-text">{status.error}</p>
                </div>
              )}

              <div className="form-group">
                <div className="label-row">
                  <label htmlFor={`${ids}-description`} className="input-label">
                    What happened?
                  </label>
                </div>
                <textarea
                  id={`${ids}-description`}
                  className="input resize-y"
                  rows={4}
                  required
                  maxLength={DESCRIPTION_MAX_LENGTH}
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  disabled={sending}
                  placeholder="The register button did nothing when I clicked it."
                />
              </div>

              <div className="form-group">
                <div className="label-row">
                  <label htmlFor={`${ids}-details`} className="input-label">
                    Steps / what you expected{" "}
                    <span className="label-optional">(optional)</span>
                  </label>
                </div>
                <textarea
                  id={`${ids}-details`}
                  className="input resize-y"
                  rows={3}
                  maxLength={DETAILS_MAX_LENGTH}
                  value={details}
                  onChange={(e) => setDetails(e.target.value)}
                  disabled={sending}
                  placeholder="1. Opened a tournament  2. Clicked Register  3. I expected the payment page"
                />
              </div>

              {/* Honeypot: hidden from people and assistive tech; bots fill it. */}
              <div
                aria-hidden="true"
                className="absolute -left-[9999px] h-0 w-0 overflow-hidden"
              >
                <label htmlFor={`${ids}-website`}>Website</label>
                <input
                  id={`${ids}-website`}
                  type="text"
                  name="website"
                  tabIndex={-1}
                  autoComplete="off"
                  value={website}
                  onChange={(e) => setWebsite(e.target.value)}
                />
              </div>

              <DialogFooter>
                <button
                  type="button"
                  className="btn-secondary w-full sm:w-auto sm:px-6"
                  onClick={() => handleOpenChange(false)}
                  disabled={sending}
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="btn-primary w-full sm:w-auto sm:px-6"
                  disabled={sending}
                >
                  {sending ? "Sending…" : "Send report"}
                </button>
              </DialogFooter>
            </form>
          )}
        </DialogContent>
      </Dialog>
    </>
  );
}
