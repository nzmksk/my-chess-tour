"use client";

import Image from "next/image";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState, useEffect, useRef } from "react";
import { closeDrawer, getIsDrawerOpen, openDrawer } from "@/lib/nav-bar-state";
import { createClient } from "@/lib/supabase/client";

const NAV_LINKS = [
  { href: "/become-organizer", label: "Become an Organizer", ghost: true },
];

type AuthUser = {
  email: string;
  fullName: string;
  initials: string;
};

export default function NavBar() {
  const pathname = usePathname();
  const [drawerState, setDrawerState] = useState(() =>
    closeDrawer(openDrawer(pathname ?? "")),
  );
  const drawerRef = useRef<HTMLDivElement>(null);
  const drawerOpen = getIsDrawerOpen(drawerState, pathname ?? "");

  const [authUser, setAuthUser] = useState<AuthUser | null>(null);
  const [dropdownOpen, setDropdownOpen] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);

  // Fetch auth state on every route change
  useEffect(() => {
    const supabase = createClient();
    supabase.auth.getUser().then(({ data }) => {
      if (!data.user) {
        setAuthUser(null);
        return;
      }
      const meta = data.user.user_metadata ?? {};
      const firstName: string = meta.first_name ?? meta.firstName ?? "";
      const lastName: string = meta.last_name ?? meta.lastName ?? "";
      const initials =
        [firstName[0], lastName[0]].filter(Boolean).join("").toUpperCase() ||
        (data.user.email?.[0]?.toUpperCase() ?? "?");
      setAuthUser({
        email: data.user.email ?? "",
        fullName:
          [firstName, lastName].filter(Boolean).join(" ") ||
          (data.user.email ?? ""),
        initials,
      });
    });
  }, [pathname]);

  // Close dropdown on outside click or Escape
  useEffect(() => {
    if (!dropdownOpen) return;
    function onMouseDown(e: MouseEvent) {
      if (
        dropdownRef.current &&
        !dropdownRef.current.contains(e.target as Node)
      ) {
        setDropdownOpen(false);
      }
    }
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") setDropdownOpen(false);
    }
    document.addEventListener("mousedown", onMouseDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("mousedown", onMouseDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [dropdownOpen]);

  // Prevent body scroll when drawer is open
  useEffect(() => {
    document.body.style.overflow = drawerOpen ? "hidden" : "";
    return () => {
      document.body.style.overflow = "";
    };
  }, [drawerOpen]);

  // Hide closed drawer from keyboard and assistive tech
  useEffect(() => {
    const el = drawerRef.current;
    if (!el) return;
    if (drawerOpen) {
      el.removeAttribute("inert");
    } else {
      el.setAttribute("inert", "");
    }
  }, [drawerOpen]);

  return (
    <>
      <nav className="bg-(--color-bg-sunken) border-b border-(--color-border) sticky top-0 z-50">
        <div className="max-w-300 mx-auto px-10 flex items-center justify-between h-16">
          {/* Brand logo */}
          <Link href="/tournaments" className="flex items-center shrink-0">
            <Image
              src="/mct-logo-horizontal.svg"
              alt="MY Chess Tour"
              width={148}
              height={60}
              priority
            />
          </Link>

          {/* Desktop nav */}
          <div className="hidden sm:flex items-center gap-2">
            {NAV_LINKS.map(({ href, label, ghost }) => (
              <Link
                key={href}
                href={href}
                className={
                  ghost
                    ? "nav-link"
                    : `nav-link${pathname === href ? " nav-link--active" : ""}`
                }
              >
                {label}
              </Link>
            ))}

            {authUser ? (
              <>
                <Link
                  href="/tournaments"
                  className={`nav-link${pathname === "/tournaments" ? " nav-link--active" : ""}`}
                >
                  My Tournaments
                </Link>

                {/* Avatar + dropdown */}
                <div className="relative ml-2" ref={dropdownRef}>
                  <button
                    className={`nav-avatar${dropdownOpen ? " nav-avatar--open" : ""}`}
                    onClick={() => setDropdownOpen((v) => !v)}
                    aria-label="Account menu"
                    aria-expanded={dropdownOpen}
                  >
                    {authUser.initials}
                  </button>

                  {dropdownOpen && (
                    <div className="nav-dropdown">
                      <div className="nav-dropdown-user">
                        <p className="nav-dropdown-name">{authUser.fullName}</p>
                        <p className="nav-dropdown-email">{authUser.email}</p>
                      </div>
                      <div>
                        <Link
                          href="/profile"
                          className="nav-dropdown-item"
                          onClick={() => setDropdownOpen(false)}
                        >
                          My Profile
                        </Link>
                        <Link
                          href="/tournaments"
                          className="nav-dropdown-item"
                          onClick={() => setDropdownOpen(false)}
                        >
                          My Registrations
                        </Link>
                        <Link
                          href="/settings"
                          className="nav-dropdown-item"
                          onClick={() => setDropdownOpen(false)}
                        >
                          Settings
                        </Link>
                      </div>
                      <div className="nav-dropdown-divider" />
                      <Link
                        href="/logout"
                        className="nav-dropdown-item nav-dropdown-item--danger"
                        onClick={() => setDropdownOpen(false)}
                      >
                        Sign Out
                      </Link>
                    </div>
                  )}
                </div>
              </>
            ) : (
              <>
                <Link href="/login" className="nav-btn-login">
                  Login
                </Link>
                <Link href="/sign-up" className="nav-btn-signup">
                  Sign Up
                </Link>
              </>
            )}
          </div>

          {/* Hamburger button — visible on small screens only */}
          <button
            className="flex sm:hidden items-center bg-transparent border-0 cursor-pointer p-2 text-(--color-text-secondary)"
            onClick={() => setDrawerState(openDrawer(pathname ?? ""))}
            aria-label="Open navigation menu"
            aria-expanded={drawerOpen}
            aria-controls="nav-drawer"
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
        onClick={() => setDrawerState((current) => closeDrawer(current))}
      />

      {/* Slide-in drawer from right */}
      <div
        id="nav-drawer"
        ref={drawerRef}
        className={drawerOpen ? "nav-drawer nav-drawer--open" : "nav-drawer"}
        aria-modal={drawerOpen ? "true" : undefined}
        role="dialog"
        aria-label="Navigation menu"
      >
        {/* Close button */}
        <div className="flex justify-end mb-8">
          <button
            onClick={() => setDrawerState((current) => closeDrawer(current))}
            aria-label="Close navigation menu"
            className="bg-transparent border-0 cursor-pointer p-2 text-(--color-text-secondary)"
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
        <div className="flex flex-col gap-1">
          {NAV_LINKS.map(({ href, label }) => (
            <Link
              key={href}
              href={href}
              onClick={() => setDrawerState((current) => closeDrawer(current))}
              className={`nav-drawer-link${pathname === href ? " nav-drawer-link--active" : ""}`}
            >
              {label}
            </Link>
          ))}

          {authUser ? (
            <>
              <Link
                href="/tournaments"
                onClick={() =>
                  setDrawerState((current) => closeDrawer(current))
                }
                className={`nav-drawer-link${pathname === "/tournaments" ? " nav-drawer-link--active" : ""}`}
              >
                My Tournaments
              </Link>
              <Link
                href="/logout"
                className="nav-drawer-btn-login mt-4"
                onClick={() =>
                  setDrawerState((current) => closeDrawer(current))
                }
              >
                Sign Out
              </Link>
            </>
          ) : (
            <>
              <Link
                href="/login"
                className="nav-drawer-btn-login"
                onClick={() =>
                  setDrawerState((current) => closeDrawer(current))
                }
              >
                Login
              </Link>
              <Link
                href="/sign-up"
                className="nav-drawer-btn-signup"
                onClick={() =>
                  setDrawerState((current) => closeDrawer(current))
                }
              >
                Sign Up
              </Link>
            </>
          )}
        </div>
      </div>
    </>
  );
}
