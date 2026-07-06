"use client";

import Image from "next/image";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState, useEffect, useRef, useTransition } from "react";
import { closeDrawer, getIsDrawerOpen, openDrawer } from "@/lib/nav-bar-state";
import { useAuthStore } from "@/stores/auth-store";
import { logout } from "@/app/auth/logout/_actions/logout";
import { ThemeToggle } from "./ThemeToggle";
import OrgSwitcher from "./OrgSwitcher";
import { RoleBadge } from "@/lib/roles";
import { MenuIcon, CloseIcon } from "@/app/components/Icons";

const NAV_LINKS = [
  { href: "/organizations", label: "Become an Organizer", ghost: true },
];

export default function NavBar() {
  const pathname = usePathname();
  const [drawerState, setDrawerState] = useState(() =>
    closeDrawer(openDrawer(pathname ?? "")),
  );
  const drawerRef = useRef<HTMLDivElement>(null);
  const drawerOpen = getIsDrawerOpen(drawerState, pathname ?? "");

  // User + orgs come from the shared auth store (seeded by AuthProvider and
  // kept live there) — no per-navigation fetch here. The avatar is read inside
  // OrgSwitcher, which owns the desktop account control.
  const authUser = useAuthStore((s) => s.user);
  const organizations = useAuthStore((s) => s.organizations);
  const [, startSignOut] = useTransition();

  // Sign out immediately — no confirmation. The action clears the session and
  // redirects to the signed-out screen.
  function handleSignOut() {
    startSignOut(() => {
      logout();
    });
  }

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
              // Account & organization switcher — the single authed control.
              // It carries the personal account, org switching, and the account
              // actions (Settings / Sign Out) that used to live in a separate
              // avatar menu.
              <OrgSwitcher />
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
                href="/my"
                onClick={() =>
                  setDrawerState((current) => closeDrawer(current))
                }
                className={`nav-drawer-link ${pathname === "/my" ? "nav-drawer-link--active" : ""}`}
              >
                My Tournaments
              </Link>

              {/* Mobile equivalent of the desktop OrgSwitcher: the popover is
                  desktop-oriented, so in the drawer the memberships render as a
                  flat list of links. */}
              <p className="font-cinzel text-text-muted mt-2 px-1 text-xs font-bold tracking-widest uppercase">
                Organizations
              </p>
              {organizations.length === 0 ? (
                <p className="font-lato text-text-muted px-1 text-sm">
                  You don&apos;t manage any organizations yet.
                </p>
              ) : (
                organizations.map((org) => {
                  const href = `/my/organizations/${org.id}`;
                  return (
                    <Link
                      key={org.id}
                      href={href}
                      onClick={() =>
                        setDrawerState((current) => closeDrawer(current))
                      }
                      className={`nav-drawer-link flex items-center gap-2 ${pathname?.startsWith(href) ? "nav-drawer-link--active" : ""}`}
                    >
                      <span className="min-w-0 flex-1 truncate">
                        {org.name}
                      </span>
                      <RoleBadge role={org.role} className="shrink-0" />
                    </Link>
                  );
                })
              )}
              <Link
                href="/organizations"
                onClick={() =>
                  setDrawerState((current) => closeDrawer(current))
                }
                className="nav-drawer-link"
              >
                {organizations.length === 0
                  ? "+ Become an organizer"
                  : "+ Create / apply for organization"}
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
              <button
                type="button"
                className="nav-drawer-btn-login mt-4"
                onClick={() => {
                  setDrawerState((current) => closeDrawer(current));
                  handleSignOut();
                }}
              >
                Sign Out
              </button>
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
