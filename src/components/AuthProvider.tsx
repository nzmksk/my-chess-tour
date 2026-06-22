"use client";

import { useEffect } from "react";
import { createClient } from "@/services/supabase/client";
import { useAuthStore, type AuthUser } from "@/stores/auth-store";
import { toAuthUser, avatarFromMetadata } from "@/lib/auth-user";
import { subscribeAvatar } from "@/lib/avatar-cache";

type Props = {
  initialUser: AuthUser | null;
  initialAvatar: string | null;
  children: React.ReactNode;
};

// App-wide auth state owner. Seeds the store from the server-resolved user (so
// no client round-trip is needed for the first paint), then keeps it live with a
// single Supabase auth subscription and a cross-tab avatar listener. Mounted in
// the root layout alongside ThemeProvider.
export function AuthProvider({ initialUser, initialAvatar, children }: Props) {
  useEffect(() => {
    // Rehydrate the persisted avatar (store uses skipHydration), then assert the
    // server-provided identity/avatar as authoritative for this load.
    void useAuthStore.persist.rehydrate();
    useAuthStore.setState({ user: initialUser, avatarUrl: initialAvatar });

    const supabase = createClient();

    // Keeps the store in sync with sign-in/out and token refresh (incl. changes
    // made in other tabs). The avatar rides along on user_metadata.
    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_event, session) => {
      const user = toAuthUser(session?.user);
      if (!user) {
        useAuthStore.getState().reset();
        return;
      }
      useAuthStore.setState({
        user,
        avatarUrl: avatarFromMetadata(session?.user),
      });
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
  }, [initialUser, initialAvatar]);

  return <>{children}</>;
}
