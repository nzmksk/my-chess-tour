import Link from "next/link";
import {
  FacebookIcon,
  InstagramIcon,
  LinkedInIcon,
} from "@/app/components/Icons";
import { isReleaseVersion } from "@/lib/changelog";

/**
 * The release this build belongs to, so testers can say which one they were on
 * when they report a bug (#621). Both values are inlined at build time by
 * next.config.ts. Outside production the short commit is appended, so builds
 * between two releases can be told apart.
 */
function releaseLabel(): { text: string; href: string } | null {
  const version = process.env.APP_VERSION;
  if (!version) return null;
  const commit = process.env.APP_COMMIT;
  const showCommit =
    commit && process.env.NEXT_PUBLIC_ENVIRONMENT !== "production";
  return {
    text: showCommit ? `${version} · ${commit}` : version,
    // This release's entry on the changelog (#622); a local `dev` build has
    // no entry to point at.
    href: isReleaseVersion(version) ? `/changelogs#${version}` : "/changelogs",
  };
}

export default function Footer() {
  const year = new Date().getFullYear();
  const release = releaseLabel();

  return (
    <footer className="bg-bg-sunken border-border border-t-2">
      <div className="mx-auto max-w-300 px-6 py-8">
        <div className="grid grid-cols-1 gap-8 sm:grid-cols-3">
          <div className="flex flex-col gap-3">
            <span className="text--brand">MY Chess Tour</span>
            <p className="text--meta max-w-48">
              Malaysia&apos;s premier competitive chess circuit.
            </p>
            <Link href="/changelogs" className="footer-link">
              Changelog
            </Link>
          </div>

          <div className="flex flex-col gap-3">
            <h3>Legal</h3>
            <nav aria-label="Legal navigation" className="flex flex-col gap-2">
              <Link href="/terms" className="footer-link">
                Terms and Conditions
              </Link>
              <Link href="/privacy" className="footer-link">
                Privacy Policy
              </Link>
              <Link href="/organizer-agreement" className="footer-link">
                Organizer Agreement
              </Link>
            </nav>
          </div>

          <div className="flex flex-col gap-3">
            <h3>Follow Us</h3>
            <div className="flex flex-col gap-2">
              <a
                href="https://www.facebook.com/mychesstour"
                target="_blank"
                rel="noopener noreferrer"
                className="footer-link flex items-center gap-2"
                aria-label="Facebook"
              >
                <FacebookIcon />
                Facebook
              </a>
              <a
                href="https://instagram.com/mychesstour"
                target="_blank"
                rel="noopener noreferrer"
                className="footer-link flex items-center gap-2"
                aria-label="Instagram"
              >
                <InstagramIcon />
                Instagram
              </a>
              <a
                href="https://linkedin.com/company/mychesstour"
                target="_blank"
                rel="noopener noreferrer"
                className="footer-link flex items-center gap-2"
                aria-label="LinkedIn"
              >
                <LinkedInIcon />
                LinkedIn
              </a>
            </div>
          </div>
        </div>
      </div>
      <div className="border-border border-t-2 py-4">
        <p className="text--meta text-center">
          &copy; {year} MY Chess Tour. All rights reserved.
        </p>
        {release && (
          <p className="text--meta mt-1 text-center">
            <Link
              href={release.href}
              className="hover:text-gold-bright transition-colors"
              aria-label={`Version ${release.text}: see what changed`}
            >
              {release.text}
            </Link>
          </p>
        )}
      </div>
    </footer>
  );
}
