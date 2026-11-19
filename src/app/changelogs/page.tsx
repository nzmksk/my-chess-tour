import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import NavBar from "@/components/NavBar";
import { ChangelogChanges } from "@/components/ChangelogChanges";
import {
  paginateEntries,
  parsePageParam,
  releasedEntries,
  type ChangelogEntry,
} from "@/lib/changelog";
import { formatLegalVersion } from "@/lib/reference/legal";
import { loadChangelog } from "@/services/github/releases";

export const metadata: Metadata = {
  title: "Changelog",
  description:
    "What's new in MY Chess Tour: every release, newest first, with what was added, improved and fixed.",
};

const RELEASES_URL = "https://github.com/nzmksk/my-chess-tour/releases";

function pageHref(page: number): string {
  return page === 1 ? "/changelogs" : `/changelogs?page=${page}`;
}

/**
 * Every release, newest first, ten to a page (#622, #640). Read from the
 * GitHub release notes, cached until a release changes. A build only lists
 * releases at or before its own version, so a release cut on staging doesn't
 * show on production. Each release has an anchor (/changelogs#v0.11.0-alpha);
 * the footer links the current one, which is always first on page 1.
 */
export default async function ChangelogsPage({
  searchParams,
}: {
  searchParams: Promise<{ page?: string | string[] }>;
}) {
  const page = parsePageParam((await searchParams).page);
  if (page === null) notFound();

  const changelog = await loadChangelog();
  const current =
    changelog &&
    paginateEntries(
      releasedEntries(changelog, process.env.APP_VERSION ?? ""),
      page,
    );
  if (changelog && !current) notFound();

  return (
    <div className="bg-bg-base flex-1">
      <NavBar />
      <main className="mx-auto max-w-3xl px-4 py-12 sm:px-6 sm:py-16">
        <header className="mb-10 text-center">
          <span className="auth-logo">MY Chess Tour</span>
          <h1 className="auth-heading">Changelog</h1>
          <p className="auth-subheading">
            What changed in each release, newest first.
          </p>
          <hr className="divider-gold" />
        </header>

        {!current ? (
          <p className="font-lato text-text-secondary text-center text-sm">
            We couldn&apos;t load the changelog right now. Please try again
            later, or{" "}
            <a
              href={RELEASES_URL}
              className="text-gold-muted hover:text-gold-bright transition-colors"
            >
              see the releases on GitHub
            </a>
            .
          </p>
        ) : current.entries.length === 0 ? (
          <p className="font-lato text-text-secondary text-center text-sm">
            No releases yet.
          </p>
        ) : (
          <>
            <ol className="space-y-6">
              {current.entries.map((entry, index) => (
                <li key={entry.version}>
                  <Release entry={entry} latest={page === 1 && index === 0} />
                </li>
              ))}
            </ol>
            {current.pageCount > 1 && (
              <Pagination page={page} pageCount={current.pageCount} />
            )}
          </>
        )}
      </main>
    </div>
  );
}

function Release({
  entry,
  latest,
}: {
  entry: ChangelogEntry;
  latest: boolean;
}) {
  const hasChanges = Boolean(
    entry.new?.length || entry.improved?.length || entry.fixed?.length,
  );
  return (
    <article
      id={entry.version}
      aria-labelledby={`${entry.version}-title`}
      className={`card scroll-mt-24 p-6 sm:p-8 ${latest ? "card--featured" : ""}`}
    >
      <div className="mb-4 flex flex-wrap items-baseline gap-x-3 gap-y-1">
        <h2
          id={`${entry.version}-title`}
          className="font-cinzel text-text-primary text-lg font-semibold tracking-wider"
        >
          <a
            href={`#${entry.version}`}
            className="hover:text-gold-bright transition-colors"
          >
            {entry.version}
          </a>
        </h2>
        <time
          dateTime={entry.date}
          className="font-lato text-text-muted text-xs tracking-wide"
        >
          {formatLegalVersion(entry.date)}
        </time>
        {latest && (
          <span className="font-cinzel border-gold-muted text-gold-bright rounded-md border px-2 py-0.5 text-[0.625rem] font-semibold tracking-widest uppercase">
            Latest
          </span>
        )}
      </div>
      {entry.headline && (
        <p className="font-lato text-text-body mb-4 text-sm">
          {entry.headline}
        </p>
      )}
      {hasChanges ? (
        <ChangelogChanges entry={entry} />
      ) : (
        !entry.headline && (
          <p className="font-lato text-text-muted text-sm">
            Behind-the-scenes improvements.
          </p>
        )
      )}
    </article>
  );
}

/** Newer releases come first, so "Newer" is the previous page. */
function Pagination({ page, pageCount }: { page: number; pageCount: number }) {
  return (
    <nav
      aria-label="Changelog pages"
      className="mt-10 flex items-center justify-between gap-4"
    >
      {page > 1 ? (
        <Link
          href={pageHref(page - 1)}
          rel="prev"
          className="btn-secondary px-4"
        >
          Newer
        </Link>
      ) : (
        <span aria-hidden="true" />
      )}
      <p className="font-lato text-text-muted text-sm">
        Page {page} of {pageCount}
      </p>
      {page < pageCount ? (
        <Link
          href={pageHref(page + 1)}
          rel="next"
          className="btn-secondary px-4"
        >
          Older
        </Link>
      ) : (
        <span aria-hidden="true" />
      )}
    </nav>
  );
}
