// @vitest-environment jsdom
import React from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { render } from "@testing-library/react";

const mocks = vi.hoisted(() => ({
  setState: vi.fn(),
  getState: vi.fn(),
  rehydrate: vi.fn().mockResolvedValue(undefined),
  onAuthStateChange: vi.fn(),
  unsubscribe: vi.fn(),
  reset: vi.fn(),
  setAvatar: vi.fn(),
  toAuthUser: vi.fn(),
  subscribeAvatar: vi.fn(),
}));

vi.mock("@/stores/auth-store", () => ({
  useAuthStore: Object.assign(vi.fn(), {
    setState: mocks.setState,
    getState: mocks.getState,
    persist: { rehydrate: mocks.rehydrate },
  }),
}));

vi.mock("@/services/supabase/client", () => ({
  createClient: vi.fn(() => ({
    auth: { onAuthStateChange: mocks.onAuthStateChange },
  })),
}));

vi.mock("@/lib/auth-user", () => ({
  toAuthUser: mocks.toAuthUser,
}));

vi.mock("@/lib/avatar-cache", () => ({
  subscribeAvatar: mocks.subscribeAvatar,
}));

import { AuthProvider } from "../AuthProvider";

const initialUser = {
  id: "u1",
  email: "test@example.com",
  fullName: "Test User",
  initials: "TU",
};

beforeEach(() => {
  vi.clearAllMocks();
  mocks.onAuthStateChange.mockReturnValue({
    data: { subscription: { unsubscribe: mocks.unsubscribe } },
  });
  mocks.subscribeAvatar.mockReturnValue(vi.fn());
  mocks.getState.mockReturnValue({
    reset: mocks.reset,
    setAvatar: mocks.setAvatar,
    user: null,
  });
});

describe("AuthProvider", () => {
  it("renders children", () => {
    const { getByText } = render(
      <AuthProvider initialUser={null} initialAvatar={null}>
        <span>Child Content</span>
      </AuthProvider>,
    );
    expect(getByText("Child Content")).toBeDefined();
  });

  it("calls rehydrate on mount", () => {
    render(
      <AuthProvider
        initialUser={initialUser}
        initialAvatar="https://example.com/avatar.png"
      >
        <span />
      </AuthProvider>,
    );
    expect(mocks.rehydrate).toHaveBeenCalled();
  });

  it("seeds state from server after rehydration", async () => {
    render(
      <AuthProvider
        initialUser={initialUser}
        initialAvatar="https://example.com/avatar.png"
      >
        <span />
      </AuthProvider>,
    );
    await Promise.resolve(); // flush microtasks
    expect(mocks.setState).toHaveBeenCalledWith({
      user: initialUser,
      avatarUrl: "https://example.com/avatar.png",
    });
  });

  it("subscribes to Supabase auth state changes", () => {
    render(
      <AuthProvider initialUser={null} initialAvatar={null}>
        <span />
      </AuthProvider>,
    );
    expect(mocks.onAuthStateChange).toHaveBeenCalled();
  });

  it("calls reset when auth state change has no user", () => {
    let authCallback: (event: string, session: unknown) => void;
    mocks.onAuthStateChange.mockImplementation((cb: typeof authCallback) => {
      authCallback = cb;
      return { data: { subscription: { unsubscribe: mocks.unsubscribe } } };
    });
    mocks.toAuthUser.mockReturnValue(null);

    render(
      <AuthProvider initialUser={null} initialAvatar={null}>
        <span />
      </AuthProvider>,
    );

    authCallback!("SIGNED_OUT", null);
    expect(mocks.reset).toHaveBeenCalled();
  });

  it("sets user state when auth state change has a valid user", () => {
    let authCallback: (event: string, session: unknown) => void;
    mocks.onAuthStateChange.mockImplementation((cb: typeof authCallback) => {
      authCallback = cb;
      return { data: { subscription: { unsubscribe: mocks.unsubscribe } } };
    });
    mocks.toAuthUser.mockReturnValue(initialUser);

    render(
      <AuthProvider initialUser={null} initialAvatar={null}>
        <span />
      </AuthProvider>,
    );

    authCallback!("SIGNED_IN", { user: { id: "u1" } });
    expect(mocks.setState).toHaveBeenCalledWith({ user: initialUser });
  });

  it("subscribes to cross-tab avatar broadcasts", () => {
    render(
      <AuthProvider initialUser={null} initialAvatar={null}>
        <span />
      </AuthProvider>,
    );
    expect(mocks.subscribeAvatar).toHaveBeenCalled();
  });

  it("updates avatar when broadcast matches current user", () => {
    let avatarCallback: (msg: { userId: string; url: string | null }) => void;
    mocks.subscribeAvatar.mockImplementation((cb: typeof avatarCallback) => {
      avatarCallback = cb;
      return vi.fn();
    });
    mocks.getState.mockReturnValue({
      reset: mocks.reset,
      setAvatar: mocks.setAvatar,
      user: initialUser,
    });

    render(
      <AuthProvider initialUser={initialUser} initialAvatar={null}>
        <span />
      </AuthProvider>,
    );

    avatarCallback!({ userId: "u1", url: "https://example.com/new.png" });
    expect(mocks.setAvatar).toHaveBeenCalledWith("https://example.com/new.png");
  });

  it("does not update avatar when broadcast is for a different user", () => {
    let avatarCallback: (msg: { userId: string; url: string | null }) => void;
    mocks.subscribeAvatar.mockImplementation((cb: typeof avatarCallback) => {
      avatarCallback = cb;
      return vi.fn();
    });
    mocks.getState.mockReturnValue({
      reset: mocks.reset,
      setAvatar: mocks.setAvatar,
      user: initialUser,
    });

    render(
      <AuthProvider initialUser={initialUser} initialAvatar={null}>
        <span />
      </AuthProvider>,
    );

    avatarCallback!({
      userId: "other-user",
      url: "https://example.com/new.png",
    });
    expect(mocks.setAvatar).not.toHaveBeenCalled();
  });

  it("unsubscribes auth and avatar listeners on unmount", () => {
    const mockUnsubscribeAvatar = vi.fn();
    mocks.subscribeAvatar.mockReturnValue(mockUnsubscribeAvatar);

    const { unmount } = render(
      <AuthProvider initialUser={null} initialAvatar={null}>
        <span />
      </AuthProvider>,
    );

    unmount();
    expect(mocks.unsubscribe).toHaveBeenCalled();
    expect(mockUnsubscribeAvatar).toHaveBeenCalled();
  });
});
