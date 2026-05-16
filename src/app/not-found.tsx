import Link from "next/link";
import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Page Not Found",
};

export default function NotFound() {
  return (
    <main className="bg-bg-base flex h-screen flex-col items-center justify-center gap-8 px-6 text-center">
      {/* Decorative chess piece */}
      <span className="text-gold-bright text-6xl select-none" aria-hidden>
        ♞
      </span>

      {/* 404 heading */}
      <div className="flex flex-col items-center">
        <h1 className="text-gold-bright text-6xl">404</h1>

        {/* Divider */}
        <div className="divider-gold" />

        <h2>Page Not Found</h2>

        <p className="text-text-body max-w-sm pt-4">
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
