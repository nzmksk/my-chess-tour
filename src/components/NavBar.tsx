"use client";

import Image from "next/image";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState, useEffect, useRef } from "react";
import { closeDrawer, getIsDrawerOpen, openDrawer } from "@/lib/nav-bar-state";
import { createClient } from "@/services/supabase/client";
import { ThemeToggle } from "./ThemeToggle";
import { MenuIcon, CloseIcon } from "@/app/components/Icons";

const NAV_LINKS = [
  { href: "/organizations", label: "Become an Organizer", ghost: true },
];

type AuthUser = {
  email: string;
  fullName: string;
  initials: string;
  avatarUrl: string | null;
};

type SupabaseUser = {
  id?: string;
  email?: string | null;
  user_metadata?: Record<string, unknown> | null;
};

function toAuthUser(user: SupabaseUser | null | undefined): AuthUser | null {
  if (!user) return null;
  const meta = user.user_metadata ?? {};
  const firstName: string =
    (meta.first_name as string) ?? (meta.firstName as string) ?? "";
  const lastName: string =
    (meta.last_name as string) ?? (meta.lastName as string) ?? "";
  const initials =
    [firstName[0], lastName[0]].filter(Boolean).join("").toUpperCase() ||
    (user.email?.[0]?.toUpperCase() ?? "?");
  return {
    email: user.email ?? "",
    fullName:
      [firstName, lastName].filter(Boolean).join(" ") || (user.email ?? ""),
    initials,
    avatarUrl: null,
  };
}

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

  // Fetch auth state on route change, and keep it in sync with sign-in/out
  // events (including those triggered in other tabs).
  useEffect(() => {
    const supabase = createClient();
    let active = true;

    // Resolves the base auth user from metadata, then enriches it with the
    // avatar stored on the users table (avatar_url lives there, not in
    // user_metadata).
    async function syncAuthUser(user: SupabaseUser | null | undefined) {
      const base = toAuthUser(user);
      if (!active) return;
      setAuthUser(base);
      if (!base || !user?.id) return;

      const { data } = await supabase
        .from("users")
        .select("avatar_url")
        .eq("id", user.id)
        .maybeSingle();
      if (!active) return;
      const avatarUrl = (data?.avatar_url as string | null) ?? null;
      setAuthUser((prev) => (prev ? { ...prev, avatarUrl } : prev));
    }

    supabase.auth.getUser().then(({ data }) => syncAuthUser(data.user));

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_event, session) => {
      syncAuthUser(session?.user);
    });

    return () => {
      active = false;
      subscription.unsubscribe();
    };
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
      <nav className="bg-bg-sunken border-border sticky top-0 z-50 border-b">
        <div className="mx-auto flex h-16 max-w-300 items-center justify-between px-10">
          {/* Brand logo */}
          <Link href="/tournaments" className="flex shrink-0 items-center">
            <Image
              src="/mct-logo-horizontal.svg"
              alt="MY Chess Tour"
              width={148}
              height={60}
              priority
            />
          </Link>

          {/* Desktop nav */}
          <div className="hidden items-center gap-2 sm:flex">
            {NAV_LINKS.map(({ href, label, ghost }) => (
              <Link
                key={href}
                href={href}
                className={
                  ghost
                    ? "nav-link-organizer"
                    : `nav-link ${pathname === href ? "nav-link--active" : ""}`
                }
              >
                {label}
              </Link>
            ))}

            <ThemeToggle />

            {authUser ? (
              <>
                {/* Avatar + dropdown */}
                <div className="relative ml-2" ref={dropdownRef}>
                  <button
                    className={`nav-avatar ${dropdownOpen ? "nav-avatar--open" : ""} ${authUser.avatarUrl ? "overflow-hidden" : ""}`}
                    onClick={() => setDropdownOpen((v) => !v)}
                    aria-label="Account menu"
                    aria-expanded={dropdownOpen}
                  >
                    {authUser.avatarUrl ? (
                      <Image
                        src={authUser.avatarUrl}
                        alt={`${authUser.fullName} avatar`}
                        width={34}
                        height={34}
                        unoptimized
                        className="h-full w-full object-cover"
                      />
                    ) : (
                      authUser.initials
                    )}
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
                          href="/my/tournaments"
                          className="nav-dropdown-item"
                          onClick={() => setDropdownOpen(false)}
                        >
                          My Tournaments
                        </Link>
                        <Link
                          href="/my/applications"
                          className="nav-dropdown-item"
                          onClick={() => setDropdownOpen(false)}
                        >
                          My Organizations
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
                        href="/auth/logout"
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
                <Link href="/auth/login" className="nav-btn-login">
                  Login
                </Link>
                <Link href="/auth/signup" className="nav-btn-signup">
                  Sign Up
                </Link>
              </>
            )}
          </div>

          {/* Hamburger button — visible on small screens only */}
          <button
            className="text-text-secondary flex cursor-pointer items-center border-0 bg-transparent p-2 sm:hidden"
            onClick={() => setDrawerState(openDrawer(pathname ?? ""))}
            aria-label="Open navigation menu"
            aria-expanded={drawerOpen}
            aria-controls="nav-drawer"
          >
            <MenuIcon />
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
        <div className="mb-8 flex justify-end">
          <button
            onClick={() => setDrawerState((current) => closeDrawer(current))}
            aria-label="Close navigation menu"
            className="text-text-secondary cursor-pointer border-0 bg-transparent p-2"
          >
            <CloseIcon />
          </button>
        </div>

        {/* Theme toggle in drawer */}
        <div className="mb-4 flex items-center gap-3 px-1">
          <ThemeToggle />
          <span className="text-text-muted) font-lato text-sm tracking-widest uppercase">
            Theme
          </span>
        </div>

        {/* Drawer nav links */}
        <div className="flex flex-col gap-1">
          {NAV_LINKS.map(({ href, label }) => (
            <Link
              key={href}
              href={href}
              onClick={() => setDrawerState((current) => closeDrawer(current))}
              className={`nav-drawer-link ${pathname === href ? "nav-drawer-link--active" : ""}`}
            >
              {label}
            </Link>
          ))}

          {authUser ? (
            <>
              <Link
                href="/profile"
                onClick={() =>
                  setDrawerState((current) => closeDrawer(current))
                }
                className={`nav-drawer-link ${pathname === "/profile" ? "nav-drawer-link--active" : ""}`}
              >
                My Profile
              </Link>
              <Link
                href="/my/tournaments"
                onClick={() =>
                  setDrawerState((current) => closeDrawer(current))
                }
                className={`nav-drawer-link ${pathname === "/my/tournaments" ? "nav-drawer-link--active" : ""}`}
              >
                My Tournaments
              </Link>
              <Link
                href="/my/applications"
                onClick={() =>
                  setDrawerState((current) => closeDrawer(current))
                }
                className={`nav-drawer-link ${pathname === "/my/applications" ? "nav-drawer-link--active" : ""}`}
              >
                My Organizations
              </Link>
              <Link
                href="/settings"
                onClick={() =>
                  setDrawerState((current) => closeDrawer(current))
                }
                className={`nav-drawer-link ${pathname === "/settings" ? "nav-drawer-link--active" : ""}`}
              >
                Settings
              </Link>
              <Link
                href="/auth/logout"
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
                href="/auth/login"
                className="nav-drawer-btn-login"
                onClick={() =>
                  setDrawerState((current) => closeDrawer(current))
                }
              >
                Login
              </Link>
              <Link
                href="/auth/signup"
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
