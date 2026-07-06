"use client";

import { useEffect } from "react";
import { createClient } from "@/services/supabase/client";
import { useAuthStore, type AuthUser } from "@/stores/auth-store";
import type { UserOrganization } from "@/lib/roles";
import { toAuthUser } from "@/lib/auth-user";
import { subscribeAvatar } from "@/lib/avatar-cache";

type Props = {
  initialUser: AuthUser | null;
  initialAvatar: string | null;
  initialOrganizations: UserOrganization[];
  children: React.ReactNode;
};

// App-wide auth state owner. Seeds the store from the server-resolved user (so
// no client round-trip is needed for the first paint), then keeps it live with a
// single Supabase auth subscription and a cross-tab avatar listener. Mounted in
// the root layout alongside ThemeProvider.
export function AuthProvider({
  initialUser,
  initialAvatar,
  initialOrganizations,
  children,
}: Props) {
  useEffect(() => {
    // Rehydrate the persisted avatar (store uses skipHydration), then assert the
    // server-provided identity/avatar/orgs as authoritative for this load. The
    // seed runs after rehydrate resolves so a stale persisted value can't win.
    // Org memberships aren't persisted — they're re-seeded fresh every full page
    // load, matching how `user` is handled.
    const seedFromServer = () =>
      useAuthStore.setState({
        user: initialUser,
        avatarUrl: initialAvatar,
        organizations: initialOrganizations,
      });
    Promise.resolve(useAuthStore.persist.rehydrate()).finally(seedFromServer);

    const supabase = createClient();

    // Keeps identity in sync with sign-in/out and token refresh (incl. other
    // tabs). The avatar is NOT in the JWT — it's owned by the server seed,
    // setAvatar on change, and cross-tab broadcast — so don't touch it here.
    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_event, session) => {
      const user = toAuthUser(session?.user);
      if (!user) {
        useAuthStore.getState().reset();
        return;
      }
      useAuthStore.setState({ user });
    });

    // Apply an avatar change pushed from another tab immediately.
    const unsubscribeAvatar = subscribeAvatar(({ userId, url }) => {
      const current = useAuthStore.getState().user;
      if (current && current.id === userId) {
        useAuthStore.getState().setAvatar(url);
      }
    });

    return () => {
      subscription.unsubscribe();
      unsubscribeAvatar();
    };
    // Re-seed if the server hands down a different user (e.g. after navigation
    // that changed auth). initialUser/initialAvatar are primitives/plain objects.
  }, [initialUser, initialAvatar, initialOrganizations]);

  return <>{children}</>;
}
