import Link from "next/link";
import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Page Not Found",
};

export default function NotFound() {
  return (
    <main className="flex h-screen flex-col items-center justify-center gap-8 px-6 bg-bg-base text-center">
      {/* Decorative chess piece */}
      <span className="text-6xl text-gold-bright select-none" aria-hidden>
        ♞
      </span>

      {/* 404 heading */}
      <div className="flex flex-col items-center gap-4">
        <h1 className="text-8xl font-bold tracking-widest text-gold-bright font-cinzel leading-none">
          404
        </h1>

        {/* Divider */}
        <div className="divider-gold" />

        <h2 className="text-2xl font-semibold tracking-wider text-text-primary font-cinzel">
          Page Not Found
        </h2>

        <p className="max-w-sm text-base font-light leading-7 text-text-secondary">
          The page you&apos;re looking for has moved, been removed, or never
          existed. Let&apos;s get you back on the board.
        </p>
      </div>

      {/* CTA */}
      <Link href="/tournaments" className="btn-primary w-fit px-8 py-3">
        Return Home
      </Link>
    </main>
  );
}
