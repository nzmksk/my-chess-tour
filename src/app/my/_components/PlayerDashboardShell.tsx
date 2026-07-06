"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Trophy, User, Building2 } from "lucide-react";
import { cn } from "@/lib/utils";

// The personal-account dashboard chrome: a left sidebar (My Tournaments /
// Profile, plus the "Become an Organizer" affordance) wrapping the section
// content. The pages under /my (and the owner's /profile) render their existing
// view inside this shell so the personal surfaces read as one dashboard with
// tabs, per wireframes/player.html.
const NAV = [
  {
    href: "/my",
    label: "My Tournaments",
    icon: Trophy,
    isActive: (p: string) => p === "/my",
  },
  {
    href: "/profile",
    label: "Profile",
    icon: User,
    isActive: (p: string) => p === "/profile",
  },
];

export default function PlayerDashboardShell({
  children,
}: {
  children: React.ReactNode;
}) {
  const pathname = usePathname() ?? "";

  return (
    <div className="mx-auto flex max-w-300 gap-0 sm:px-6">
      <aside className="border-border hidden w-56 shrink-0 border-r py-6 sm:block">
        <nav className="flex flex-col gap-1">
          {NAV.map(({ href, label, icon: Icon, isActive }) => {
            const active = isActive(pathname);
            return (
              <Link
                key={href}
                href={href}
                className={cn(
                  "font-lato flex items-center gap-3 px-4 py-2.5 text-sm transition-colors",
                  active
                    ? "text-gold-bright bg-gold-ghost border-gold-bright border-r-2 font-semibold"
                    : "text-text-secondary hover:text-text-primary hover:bg-bg-raised",
                )}
              >
                <Icon className="h-4 w-4 shrink-0" />
                {label}
              </Link>
            );
          })}

          <div className="border-border my-2 border-t" />

          <Link
            href="/organizations"
            className="text-gold-bright font-lato hover:bg-bg-raised flex items-center gap-3 px-4 py-2.5 text-sm font-semibold transition-colors"
          >
            <Building2 className="h-4 w-4 shrink-0" />
            Become an Organizer
          </Link>
        </nav>
      </aside>

      <main className="min-w-0 flex-1">{children}</main>
    </div>
  );
}
