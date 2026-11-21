"use client";

import { useEffect, useRef } from "react";
import posthog from "posthog-js";
import { createClient } from "@/services/supabase/client";
import { useAuthStore } from "@/stores/auth-store";
import type { UserOrganization } from "@/lib/auth/roles";
import { toAuthUser, type AuthUser } from "@/lib/auth/auth-user";
import { subscribeAvatar } from "@/lib/auth/avatar-cache";

const posthogConfigured = Boolean(
  process.env.NEXT_PUBLIC_POSTHOG_PROJECT_TOKEN &&
    process.env.NEXT_PUBLIC_POSTHOG_HOST,
);

type Props = {
  initialUser: AuthUser | null;
  initialAvatar: string | null;
  initialOrganizations: UserOrganization[];
  children: React.ReactNode;
};

export function AuthProvider({
  initialUser,
  initialAvatar,
  initialOrganizations,
  children,
}: Props) {
  const identifiedUserId = useRef<string | null>(null);

  useEffect(() => {
    const identifyUser = (user: AuthUser) => {
      if (!posthogConfigured || identifiedUserId.current === user.id) return;

      if (identifiedUserId.current) {
        posthog.reset();
      }

      posthog.identify(user.id, {
        email: user.email,
        name: user.fullName,
      });
      identifiedUserId.current = user.id;
    };

    if (initialUser) {
      identifyUser(initialUser);
    }

    const seedFromServer = () =>
      useAuthStore.setState({
        user: initialUser,
        avatarUrl: initialAvatar,
        organizations: initialOrganizations,
      });
    Promise.resolve(useAuthStore.persist.rehydrate()).finally(seedFromServer);

    const supabase = createClient();

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((event, session) => {
      const user = toAuthUser(session?.user);
      if (!user) {
        useAuthStore.getState().reset();
        if (event === "SIGNED_OUT") {
          if (posthogConfigured) {
            posthog.reset();
          }
          identifiedUserId.current = null;
        }
        return;
      }
      useAuthStore.setState({ user });
      identifyUser(user);
    });

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
  }, [initialUser, initialAvatar, initialOrganizations]);

  return <>{children}</>;
}
