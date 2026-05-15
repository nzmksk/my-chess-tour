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
              Navigate
            </h3>
            <nav aria-label="Footer navigation" className="flex flex-col gap-2">
              <Link href="/tournaments" className="footer-link">
                Tournaments
              </Link>
              <Link href="/organizations/apply" className="footer-link">
                Become an Organizer
              </Link>
            </nav>
          </div>

          <div className="flex flex-col gap-3">
            <h3 className="font-cinzel text-xs font-semibold tracking-widest uppercase text-gold-muted">
              Account
            </h3>
            <nav aria-label="Account navigation" className="flex flex-col gap-2">
              <Link href="/auth/login" className="footer-link">
                Login
              </Link>
              <Link href="/auth/signup" className="footer-link">
                Sign Up
              </Link>
            </nav>
          </div>
        </div>

        <div className="border-t border-border pt-6">
          <p className="font-lato text-xs text-text-muted text-center sm:text-left">
            &copy; {year} MY Chess Tour. All rights reserved.
          </p>
        </div>
      </div>
    </footer>
  );
}
