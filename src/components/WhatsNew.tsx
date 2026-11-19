"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { ChangelogChanges } from "@/components/ChangelogChanges";
import { CHANGELOG } from "@/content/changelog";
import { pickAnnouncement, type ChangelogEntry } from "@/lib/changelog";
import { formatLegalVersion } from "@/lib/reference/legal";

/** The last release this browser was told about. Works signed out too. */
export const LAST_SEEN_KEY = "mct:lastSeenVersion";

/**
 * Flows the dialog would get in the way of. It waits for the next ordinary
 * page instead: nothing is read or stored on these.
 */
const QUIET_PATHS = [
  // Checkout and the payment success / failure pages it returns to.
  /^\/tournaments\/[^/]+\/register(\/|$)/,
  // Signing in, signing up, verifying and resetting a password. Sign-in is
  // part of checkout too: a signed-out player opening /register is sent to
  // /auth/login?next=..., and the release would be marked seen mid-flow.
  /^\/auth(\/|$)/,
  // Sponsors returning from paying into a prize pool.
  /^\/prize-funding(\/|$)/,
];

export function isQuietPath(pathname: string): boolean {
  return QUIET_PATHS.some((pattern) => pattern.test(pathname));
}

/** `undefined` when storage can't be read (private mode, blocked). */
function readLastSeen(): string | null | undefined {
  try {
    return window.localStorage.getItem(LAST_SEEN_KEY);
  } catch {
    return undefined;
  }
}

function writeLastSeen(version: string): boolean {
  try {
    window.localStorage.setItem(LAST_SEEN_KEY, version);
    return true;
  } catch {
    return false;
  }
}

type Shown = { entry: ChangelogEntry; missed: number; open: boolean };

/**
 * "What's new" (#622): the first ordinary page view after a new release shows
 * that release's changelog entry, once. A first-ever visit stores the version
 * quietly instead, and several skipped releases still mean one dialog, for
 * the newest. Decided in an effect, so nothing renders during SSR or
 * hydration. Radix's dialog traps focus, closes on Esc, returns focus where
 * it was, and labels itself by its title.
 */
export function WhatsNew({
  version = process.env.APP_VERSION ?? "",
  entries = CHANGELOG,
}: {
  version?: string;
  entries?: readonly ChangelogEntry[];
}) {
  const pathname = usePathname();
  const decided = useRef(false);
  // Radix returns focus to a DialogTrigger, and this dialog opens without
  // one, so it would drop focus on <body>. Return it where it was instead.
  const returnFocus = useRef<HTMLElement | null>(null);
  const [shown, setShown] = useState<Shown | null>(null);

  useEffect(() => {
    if (decided.current || !pathname || isQuietPath(pathname)) return;
    decided.current = true;

    const lastSeen = readLastSeen();
    if (lastSeen === undefined) return;

    const announcement = pickAnnouncement(lastSeen, version, entries);
    if (announcement.kind === "none") return;

    // Stored as soon as it's decided, so neither closing nor reloading brings
    // it back. Storage that won't keep it means no dialog at all, rather than
    // the same one on every page.
    if (!writeLastSeen(version)) return;

    if (announcement.kind === "show") {
      returnFocus.current =
        document.activeElement instanceof HTMLElement
          ? document.activeElement
          : null;
      // localStorage only exists after hydration, so this has to be an effect.
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setShown({
        entry: announcement.entry,
        missed: announcement.missed,
        open: true,
      });
    }
  }, [pathname, version, entries]);

  if (!shown) return null;
  const { entry, missed, open } = shown;
  const setOpen = (next: boolean) => setShown({ ...shown, open: next });

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogContent
        className="bg-bg-raised border-border max-h-[85vh] overflow-y-auto"
        onCloseAutoFocus={(event) => {
          event.preventDefault();
          returnFocus.current?.focus();
        }}
      >
        <DialogHeader>
          <p className="font-cinzel text-gold-muted text-xs font-semibold tracking-widest uppercase">
            What&apos;s new
          </p>
          <DialogTitle className="font-cinzel text-text-primary tracking-wider">
            {entry.version}
          </DialogTitle>
          <DialogDescription className="font-lato text-text-secondary">
            {entry.headline ?? `Released ${formatLegalVersion(entry.date)}.`}
            {missed > 1 &&
              ` This is the latest of ${missed} releases since your last visit.`}
          </DialogDescription>
        </DialogHeader>

        <ChangelogChanges entry={entry} />

        <DialogFooter className="items-center gap-4">
          <Link
            href="/changelogs"
            onClick={() => setOpen(false)}
            className="font-lato text-gold-muted hover:text-gold-bright text-sm transition-colors"
          >
            See all changes
          </Link>
          <button
            type="button"
            onClick={() => setOpen(false)}
            className="btn-primary w-full sm:w-auto sm:px-6"
          >
            Got it
          </button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
