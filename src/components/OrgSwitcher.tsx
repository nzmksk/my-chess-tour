"use client";

import Image from "next/image";
import { usePathname, useRouter } from "next/navigation";
import { useState } from "react";
import { Check, ChevronsUpDown, Plus } from "lucide-react";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import {
  Command,
  CommandGroup,
  CommandItem,
  CommandList,
  CommandSeparator,
} from "@/components/ui/command";
import { RoleBadge, getRoleConfig, type UserOrganization } from "@/lib/roles";
import { useAuthStore } from "@/stores/auth-store";
import { cn } from "@/lib/utils";

/** First letters of an org name, for the fallback avatar when there's no image. */
function orgInitials(name: string): string {
  const letters = name
    .split(/\s+/)
    .filter(Boolean)
    .map((w) => w[0])
    .join("")
    .slice(0, 2)
    .toUpperCase();
  return letters || "?";
}

function Avatar({
  square,
  imageUrl,
  initials,
  alt,
  open,
}: {
  square?: boolean;
  imageUrl: string | null;
  initials: string;
  alt: string;
  open?: boolean;
}) {
  return (
    <span
      className={cn(
        "border-border bg-bg-raised text-text-primary font-cinzel flex h-7 w-7 shrink-0 items-center justify-center overflow-hidden border text-xs font-semibold",
        square ? "rounded" : "rounded-full",
        open && "border-gold-dim",
      )}
    >
      {imageUrl ? (
        <Image
          src={imageUrl}
          alt={alt}
          width={28}
          height={28}
          unoptimized
          className="h-full w-full object-cover"
        />
      ) : (
        initials
      )}
    </span>
  );
}

// The navbar Account & Organization switcher. Shows the current context
// (personal account or the org in the URL) and lets the user jump between their
// personal surfaces and any organization they're a member of. Active org is
// read from the URL — org context lives entirely in the /my/organizations/[orgId]
// path, so the switcher stays in sync with the page without any extra state.
export default function OrgSwitcher() {
  const pathname = usePathname();
  const router = useRouter();
  const [open, setOpen] = useState(false);

  const user = useAuthStore((s) => s.user);
  const avatarUrl = useAuthStore((s) => s.avatarUrl);
  const organizations = useAuthStore((s) => s.organizations);

  // NavBar already guards on auth, but keep this defensive so the switcher never
  // renders a broken trigger.
  if (!user) return null;

  const match = pathname?.match(/^\/my\/organizations\/([^/]+)/);
  const activeOrgId =
    match && match[1] !== "applications" ? match[1] : null;
  const activeOrg: UserOrganization | null =
    organizations.find((o) => o.id === activeOrgId) ?? null;

  const go = (href: string) => {
    setOpen(false);
    router.push(href);
  };

  const hasOrgs = organizations.length > 0;

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          aria-label="Switch account or organization"
          className={cn(
            "border-border bg-bg-surface hover:border-gold-dim flex max-w-52 cursor-pointer items-center gap-2 rounded-md border px-2 py-1 transition-colors",
            open && "border-gold-dim",
          )}
        >
          {activeOrg ? (
            <Avatar
              square
              imageUrl={activeOrg.avatar_url}
              initials={orgInitials(activeOrg.name)}
              alt={activeOrg.name}
              open={open}
            />
          ) : (
            <Avatar
              imageUrl={avatarUrl}
              initials={user.initials}
              alt={user.fullName}
              open={open}
            />
          )}
          <span className="flex min-w-0 flex-col text-left leading-tight">
            <span className="font-lato text-text-primary truncate text-xs font-semibold">
              {activeOrg ? activeOrg.name : user.fullName}
            </span>
            <span className="font-lato text-text-muted truncate text-[0.625rem]">
              {activeOrg
                ? getRoleConfig(activeOrg.role).label
                : "Personal account"}
            </span>
          </span>
          <ChevronsUpDown className="text-text-muted ml-auto h-3.5 w-3.5 shrink-0" />
        </button>
      </PopoverTrigger>

      <PopoverContent
        align="end"
        className="bg-bg-surface border-border w-64 overflow-hidden p-0"
      >
        <Command className="bg-bg-surface">
          <CommandList className="max-h-80">
            <CommandGroup
              heading="Account"
              className="**:[[cmdk-group-heading]]:font-cinzel **:[[cmdk-group-heading]]:text-text-muted **:[[cmdk-group-heading]]:tracking-widest **:[[cmdk-group-heading]]:uppercase"
            >
              <CommandItem
                value="__personal_account"
                onSelect={() => go("/my/tournaments")}
                className="data-[selected=true]:bg-bg-raised gap-2"
              >
                <Avatar
                  imageUrl={avatarUrl}
                  initials={user.initials}
                  alt={user.fullName}
                />
                <span className="flex min-w-0 flex-col leading-tight">
                  <span className="font-lato text-text-primary truncate text-sm">
                    {user.fullName}
                  </span>
                  <span className="font-lato text-text-muted text-xs">
                    Personal account
                  </span>
                </span>
                {activeOrgId === null && (
                  <Check className="text-gold-bright ml-auto h-4 w-4 shrink-0" />
                )}
              </CommandItem>
            </CommandGroup>

            <CommandGroup
              heading="Organizations"
              className="**:[[cmdk-group-heading]]:font-cinzel **:[[cmdk-group-heading]]:text-text-muted **:[[cmdk-group-heading]]:tracking-widest **:[[cmdk-group-heading]]:uppercase"
            >
              {hasOrgs ? (
                organizations.map((org) => (
                  <CommandItem
                    key={org.id}
                    value={`org-${org.id}-${org.name}`}
                    onSelect={() => go(`/my/organizations/${org.id}`)}
                    className="data-[selected=true]:bg-bg-raised gap-2"
                  >
                    <Avatar
                      square
                      imageUrl={org.avatar_url}
                      initials={orgInitials(org.name)}
                      alt={org.name}
                    />
                    <span className="font-lato text-text-primary min-w-0 flex-1 truncate text-sm">
                      {org.name}
                    </span>
                    <RoleBadge role={org.role} className="shrink-0" />
                    {org.id === activeOrgId && (
                      <Check className="text-gold-bright h-4 w-4 shrink-0" />
                    )}
                  </CommandItem>
                ))
              ) : (
                <p className="font-lato text-text-muted px-3 py-2 text-xs">
                  You don&apos;t manage any organizations yet.
                </p>
              )}
            </CommandGroup>
          </CommandList>

          <CommandSeparator className="bg-border" />
          <button
            type="button"
            onClick={() => go("/organizations")}
            className="border-border bg-bg-raised text-text-primary font-lato hover:text-gold-bright flex w-full cursor-pointer items-center gap-2 border-t px-3 py-2.5 text-left text-sm transition-colors"
          >
            <Plus className="h-4 w-4 shrink-0" />
            {hasOrgs
              ? "Create / apply for organization"
              : "Become an organizer"}
          </button>
        </Command>
      </PopoverContent>
    </Popover>
  );
}
