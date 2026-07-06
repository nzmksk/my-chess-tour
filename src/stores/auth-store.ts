import { create } from "zustand";
import { persist, createJSONStorage } from "zustand/middleware";
import type { UserOrganization } from "@/lib/roles";

export type AuthUser = {
  id: string;
  email: string;
  fullName: string;
  initials: string;
};

type AuthState = {
  user: AuthUser | null;
  avatarUrl: string | null;
  organizations: UserOrganization[];
  setUser: (user: AuthUser | null) => void;
  setAvatar: (avatarUrl: string | null) => void;
  setOrganizations: (organizations: UserOrganization[]) => void;
  reset: () => void;
};

// Single client-side source of truth for the signed-in user and their avatar.
// Seeded from the server (see AuthProvider) and kept live via Supabase auth
// events + cross-tab broadcasts. Only `avatarUrl` is persisted to sessionStorage
// so it survives a reload; the user identity is always re-seeded from the server
// render. `skipHydration` defers rehydration to the client so the server and
// first client render agree (no hydration mismatch) — AuthProvider rehydrates.
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
