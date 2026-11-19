import type { Metadata } from "next";
import NavBar from "@/components/NavBar";
import { ChangelogChanges } from "@/components/ChangelogChanges";
import { CHANGELOG } from "@/content/changelog";
import { releasedEntries } from "@/lib/changelog";
import { formatLegalVersion } from "@/lib/reference/legal";

export const metadata: Metadata = {
  title: "Changelog",
  description:
    "What's new in MY Chess Tour: every release, newest first, with what was added, improved and fixed.",
};

/**
 * Every release, newest first (#622). Public and built from the bundled
 * changelog, so it never calls GitHub. Each release has an anchor
 * (/changelogs#v0.11.0-alpha) for links to a specific one.
 */
export default function ChangelogsPage() {
  const entries = releasedEntries(CHANGELOG, process.env.APP_VERSION ?? "");

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

        <ol className="space-y-6">
          {entries.map((entry, index) => (
            <li key={entry.version}>
              <article
                id={entry.version}
                aria-labelledby={`${entry.version}-title`}
                className={`card scroll-mt-24 p-6 sm:p-8 ${index === 0 ? "card--featured" : ""}`}
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
                  {index === 0 && (
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
                <ChangelogChanges entry={entry} />
              </article>
            </li>
          ))}
        </ol>
      </main>
    </div>
  );
}
