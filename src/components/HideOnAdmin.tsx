"use client";

import { usePathname } from "next/navigation";

/**
 * Renders its children everywhere except the platform admin console.
 *
 * The root layout is shared by every route, and /admin is an internal tool:
 * its pages are for staff, not the public, so site chrome such as the footer
 * has nothing to offer there. The children stay server-rendered; this only
 * decides whether to show them.
 */
export function HideOnAdmin({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  if (pathname === "/admin" || pathname?.startsWith("/admin/")) return null;
  return <>{children}</>;
}
