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
import {
  hasMissedRelease,
  pickAnnouncement,
  type Announcement,
  type ChangelogEntry,
} from "@/lib/changelog";
import { formatLegalVersion } from "@/lib/reference/legal";

export const LAST_SEEN_KEY = "mct:lastSeenVersion";

const QUIET_PATHS = [
  /^\/tournaments\/[^/]+\/register(\/|$)/,
  /^\/auth(\/|$)/,
  /^\/prize-funding(\/|$)/,
];

export function isQuietPath(pathname: string): boolean {
  return QUIET_PATHS.some((pattern) => pattern.test(pathname));
}

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

export async function fetchMissedReleases(
  after: string,
): Promise<readonly ChangelogEntry[]> {
  const response = await fetch(
    `/api/v1/changelog?after=${encodeURIComponent(after)}`,
  );
  if (!response.ok) {
    throw new Error(`Changelog request failed with ${response.status}`);
  }
  const body: { data: { entries: ChangelogEntry[] } } = await response.json();
  return body.data.entries;
}

export function WhatsNew({
  version = process.env.APP_VERSION ?? "",
  loadEntries = fetchMissedReleases,
}: {
  version?: string;
  loadEntries?: (after: string) => Promise<readonly ChangelogEntry[]>;
}) {
  const pathname = usePathname();
  const decided = useRef(false);
  const returnFocus = useRef<HTMLElement | null>(null);
  const [shown, setShown] = useState<Shown | null>(null);

  useEffect(() => {
    if (decided.current || !pathname || isQuietPath(pathname)) return;
    decided.current = true;

    const lastSeen = readLastSeen();
    if (lastSeen === undefined) return;

    const act = (announcement: Announcement) => {
      if (announcement.kind === "none") return;

      if (!writeLastSeen(version)) return;

      if (announcement.kind === "show") {
        returnFocus.current =
          document.activeElement instanceof HTMLElement
            ? document.activeElement
            : null;
        setShown({
          entry: announcement.entry,
          missed: announcement.missed,
          open: true,
        });
      }
    };

    if (lastSeen === null || !hasMissedRelease(lastSeen, version)) {
      act(pickAnnouncement(lastSeen, version, []));
      return;
    }

    let settled = false;
    let cancelled = false;
    loadEntries(lastSeen)
      .then((entries) => {
        settled = true;
        if (!cancelled) act(pickAnnouncement(lastSeen, version, entries));
      })
      .catch(() => {
        settled = true;
        decided.current = false;
      });

    return () => {
      if (!settled) {
        cancelled = true;
        decided.current = false;
      }
    };
  }, [pathname, version, loadEntries]);

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
