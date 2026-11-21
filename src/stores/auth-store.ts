import { create } from "zustand";
import { persist, createJSONStorage } from "zustand/middleware";
import type { AuthUser } from "@/lib/auth/auth-user";
import type { UserOrganization } from "@/lib/auth/roles";

type AuthState = {
  user: AuthUser | null;
  avatarUrl: string | null;
  organizations: UserOrganization[];
  setUser: (user: AuthUser | null) => void;
  setAvatar: (avatarUrl: string | null) => void;
  setOrganizations: (organizations: UserOrganization[]) => void;
  reset: () => void;
};

export const useAuthStore = create<AuthState>()(
  persist(
    (set) => ({
      user: null,
      avatarUrl: null,
      organizations: [],
      setUser: (user) => set({ user }),
      setAvatar: (avatarUrl) => set({ avatarUrl }),
      setOrganizations: (organizations) => set({ organizations }),
      reset: () => set({ user: null, avatarUrl: null, organizations: [] }),
    }),
    {
      name: "mct-auth",
      storage: createJSONStorage(() => sessionStorage),
      partialize: (state) => ({ avatarUrl: state.avatarUrl }),
      skipHydration: true,
    },
  ),
);
