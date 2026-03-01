"use client";

import Image from "next/image";
import Link from "next/link";
import { usePathname } from "next/navigation";

const NAV_LINKS = [
  { href: "/tournaments", label: "Tournaments" },
  { href: "/my-tournaments", label: "My Tournaments" },
  { href: "/profile", label: "Profile" },
];

export default function NavBar() {
  const pathname = usePathname();

  return (
    <nav
      style={{
        background: "var(--color-bg-sunken)",
        borderBottom: "1px solid var(--color-border)",
        position: "sticky",
        top: 0,
        zIndex: 50,
      }}
    >
      <div
        style={{
          maxWidth: "1200px",
          margin: "0 auto",
          padding: "0 40px",
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          height: "64px",
        }}
      >
        <Link
          href="/tournaments"
          style={{ display: "flex", alignItems: "center" }}
        >
          <Image
            src="/mct-logo-horizontal.svg"
            alt="MY Chess Tour"
            width={220}
            height={60}
            priority
          />
        </Link>

        <div style={{ display: "flex", alignItems: "center" }}>
          {NAV_LINKS.map(({ href, label }) => (
            <Link
              key={href}
              href={href}
              style={{
                fontFamily: "var(--font-lato)",
                fontSize: "13px",
                letterSpacing: "0.08em",
                color:
                  pathname === href
                    ? "var(--color-gold-bright)"
                    : "var(--color-text-secondary)",
                textTransform: "uppercase",
                textDecoration: "none",
                padding: "0 16px",
                transition: "color 0.15s ease",
              }}
            >
              {label}
            </Link>
          ))}
          <Link
            href="/become-organizer"
            style={{
              fontFamily: "var(--font-lato)",
              fontSize: "13px",
              letterSpacing: "0.08em",
              color: "var(--color-gold-bright)",
              textTransform: "uppercase",
              textDecoration: "none",
              padding: "0 16px",
              marginLeft: "8px",
              transition: "opacity 0.15s ease",
            }}
          >
            Become an Organizer
          </Link>
        </div>
      </div>
    </nav>
  );
}
