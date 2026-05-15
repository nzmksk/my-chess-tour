import Link from "next/link";

export default function Footer() {
  const year = new Date().getFullYear();

  return (
    <footer className="bg-bg-sunken border-t border-border">
      <div className="max-w-300 mx-auto px-10 py-10">
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-8 mb-8">
          <div className="flex flex-col gap-3">
            <span className="font-cinzel font-bold text-sm tracking-widest text-gold-bright uppercase">
              MY Chess Tour
            </span>
            <p className="font-lato font-light text-sm text-text-muted leading-relaxed max-w-48">
              Malaysia&apos;s premier competitive chess circuit.
            </p>
          </div>

          <div className="flex flex-col gap-3">
            <h3 className="font-cinzel text-xs font-semibold tracking-widest uppercase text-gold-muted">
              Legal
            </h3>
            <nav aria-label="Legal navigation" className="flex flex-col gap-2">
              <Link href="/terms" className="footer-link">
                Terms and Conditions
              </Link>
              <Link href="/privacy" className="footer-link">
                Privacy Policy
              </Link>
            </nav>
          </div>

          <div className="flex flex-col gap-3">
            <h3 className="font-cinzel text-xs font-semibold tracking-widest uppercase text-gold-muted">
              Follow Us
            </h3>
            <div className="flex flex-col gap-2">
              <a
                href="https://facebook.com/mychesstour"
                target="_blank"
                rel="noopener noreferrer"
                className="footer-link flex items-center gap-2"
                aria-label="Facebook"
              >
                <svg
                  width="16"
                  height="16"
                  viewBox="0 0 24 24"
                  fill="currentColor"
                  aria-hidden="true"
                >
                  <path d="M18 2h-3a5 5 0 0 0-5 5v3H7v4h3v8h4v-8h3l1-4h-4V7a1 1 0 0 1 1-1h3z" />
                </svg>
                Facebook
              </a>
              <a
                href="https://instagram.com/mychesstour"
                target="_blank"
                rel="noopener noreferrer"
                className="footer-link flex items-center gap-2"
                aria-label="Instagram"
              >
                <svg
                  width="16"
                  height="16"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  aria-hidden="true"
                >
                  <rect x="2" y="2" width="20" height="20" rx="5" ry="5" />
                  <circle cx="12" cy="12" r="4" />
                  <circle
                    cx="17.5"
                    cy="6.5"
                    r="0.5"
                    fill="currentColor"
                    stroke="none"
                  />
                </svg>
                Instagram
              </a>
              <a
                href="https://linkedin.com/company/mychesstour"
                target="_blank"
                rel="noopener noreferrer"
                className="footer-link flex items-center gap-2"
                aria-label="LinkedIn"
              >
                <svg
                  width="16"
                  height="16"
                  viewBox="0 0 24 24"
                  fill="currentColor"
                  aria-hidden="true"
                >
                  <path d="M16 8a6 6 0 0 1 6 6v7h-4v-7a2 2 0 0 0-2-2 2 2 0 0 0-2 2v7h-4v-7a6 6 0 0 1 6-6z" />
                  <rect x="2" y="9" width="4" height="12" />
                  <circle cx="4" cy="4" r="2" />
                </svg>
                LinkedIn
              </a>
            </div>
          </div>
        </div>

        <div className="border-t border-border pt-6">
          <p className="font-lato text-xs text-text-muted text-center">
            &copy; {year} MY Chess Tour. All rights reserved.
          </p>
        </div>
      </div>
    </footer>
  );
}
