"use client";

import Image from "next/image";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState, useEffect } from "react";

const NAV_LINKS = [
  { href: "/my-tournaments", label: "My Tournaments" },
  { href: "/profile", label: "Profile" },
];

export default function NavBar() {
  const pathname = usePathname();
  const [drawerOpen, setDrawerOpen] = useState(false);

  // Close drawer when route changes
  useEffect(() => {
    setDrawerOpen(false);
  }, [pathname]);

  // Prevent body scroll when drawer is open
  useEffect(() => {
    document.body.style.overflow = drawerOpen ? "hidden" : "";
    return () => {
      document.body.style.overflow = "";
    };
  }, [drawerOpen]);

  return (
    <>
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
          {/* Brand logo — always redirects to /tournaments, never shrinks */}
          <Link
            href="/tournaments"
            style={{ display: "flex", alignItems: "center", flexShrink: 0 }}
          >
            <Image
              src="/mct-logo-horizontal.svg"
              alt="MY Chess Tour"
              width={220}
              height={60}
              priority
            />
          </Link>

          {/* Desktop nav — hidden on small screens via CSS */}
          <div className="nav-desktop">
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
                padding: "0 0 0 16px",
                marginLeft: "8px",
                transition: "opacity 0.15s ease",
              }}
            >
              Become an Organizer
            </Link>
          </div>

          {/* Hamburger button — visible on small screens only */}
          <button
            className="nav-hamburger"
            onClick={() => setDrawerOpen(true)}
            aria-label="Open navigation menu"
            style={{
              background: "none",
              border: "none",
              cursor: "pointer",
              padding: "8px",
              color: "var(--color-text-secondary)",
            }}
          >
            <svg
              width="24"
              height="24"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
            >
              <line x1="3" y1="6" x2="21" y2="6" />
              <line x1="3" y1="12" x2="21" y2="12" />
              <line x1="3" y1="18" x2="21" y2="18" />
            </svg>
          </button>
        </div>
      </nav>

      {/* Backdrop */}
      <div
        className={
          drawerOpen ? "nav-backdrop nav-backdrop--open" : "nav-backdrop"
        }
        onClick={() => setDrawerOpen(false)}
      />

      {/* Slide-in drawer from right */}
      <div
        className={drawerOpen ? "nav-drawer nav-drawer--open" : "nav-drawer"}
      >
        {/* Close button */}
        <div
          style={{
            display: "flex",
            justifyContent: "flex-end",
            marginBottom: "32px",
          }}
        >
          <button
            onClick={() => setDrawerOpen(false)}
            aria-label="Close navigation menu"
            style={{
              background: "none",
              border: "none",
              cursor: "pointer",
              padding: "8px",
              color: "var(--color-text-secondary)",
            }}
          >
            <svg
              width="24"
              height="24"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
            >
              <line x1="18" y1="6" x2="6" y2="18" />
              <line x1="6" y1="6" x2="18" y2="18" />
            </svg>
          </button>
        </div>

        {/* Drawer nav links */}
        <div style={{ display: "flex", flexDirection: "column", gap: "4px" }}>
          {NAV_LINKS.map(({ href, label }) => (
            <Link
              key={href}
              href={href}
              onClick={() => setDrawerOpen(false)}
              style={{
                fontFamily: "var(--font-lato)",
                fontSize: "14px",
                letterSpacing: "0.08em",
                color:
                  pathname === href
                    ? "var(--color-gold-bright)"
                    : "var(--color-text-secondary)",
                textTransform: "uppercase",
                textDecoration: "none",
                padding: "12px 16px",
                borderRadius: "2px",
                background:
                  pathname === href
                    ? "rgba(201, 168, 76, 0.08)"
                    : "transparent",
                transition: "color 0.15s ease, background 0.15s ease",
              }}
            >
              {label}
            </Link>
          ))}
          <Link
            href="/become-organizer"
            onClick={() => setDrawerOpen(false)}
            style={{
              fontFamily: "var(--font-lato)",
              fontSize: "14px",
              letterSpacing: "0.08em",
              color: "var(--color-gold-bright)",
              textTransform: "uppercase",
              textDecoration: "none",
              padding: "12px 16px",
              marginTop: "16px",
              border: "1px solid var(--color-gold-bright)",
              borderRadius: "2px",
              textAlign: "center",
              transition: "background 0.15s ease",
            }}
          >
            Become an Organizer
          </Link>
        </div>
      </div>
    </>
  );
}
