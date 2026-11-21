"use client";

import { useEffect } from "react";
import { createClient } from "@/services/supabase/client";
import { useAuthStore } from "@/stores/auth-store";
import type { UserOrganization } from "@/lib/auth/roles";
import { toAuthUser, type AuthUser } from "@/lib/auth/auth-user";
import { subscribeAvatar } from "@/lib/auth/avatar-cache";

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
  useEffect(() => {
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
    } = supabase.auth.onAuthStateChange((_event, session) => {
      const user = toAuthUser(session?.user);
      if (!user) {
        useAuthStore.getState().reset();
        return;
      }
      useAuthStore.setState({ user });
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
