// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from "vitest";
import { useAuthStore } from "../auth-store";

const user1 = {
  id: "u1",
  email: "alice@example.com",
  fullName: "Alice Smith",
  initials: "AS",
};

beforeEach(() => {
  useAuthStore.setState({ user: null, avatarUrl: null });
  sessionStorage.clear();
});

describe("useAuthStore", () => {
  it("has null user and avatarUrl as initial state", () => {
    const { user, avatarUrl } = useAuthStore.getState();
    expect(user).toBeNull();
    expect(avatarUrl).toBeNull();
  });

  it("setUser updates the user in state", () => {
    useAuthStore.getState().setUser(user1);
    expect(useAuthStore.getState().user).toEqual(user1);
  });

  it("setUser accepts null to clear the user", () => {
    useAuthStore.setState({ user: user1 });
    useAuthStore.getState().setUser(null);
    expect(useAuthStore.getState().user).toBeNull();
  });

  it("setAvatar updates avatarUrl in state", () => {
    useAuthStore.getState().setAvatar("https://example.com/avatar.png");
    expect(useAuthStore.getState().avatarUrl).toBe(
      "https://example.com/avatar.png",
    );
  });

  it("setAvatar can be set to null", () => {
    useAuthStore.getState().setAvatar("https://example.com/avatar.png");
    useAuthStore.getState().setAvatar(null);
    expect(useAuthStore.getState().avatarUrl).toBeNull();
  });

  it("reset clears both user and avatarUrl", () => {
    useAuthStore.setState({
      user: user1,
      avatarUrl: "https://example.com/avatar.png",
    });
    useAuthStore.getState().reset();
    expect(useAuthStore.getState().user).toBeNull();
    expect(useAuthStore.getState().avatarUrl).toBeNull();
  });

  it("persists only avatarUrl to sessionStorage", () => {
    useAuthStore.getState().setUser(user1);
    useAuthStore.getState().setAvatar("https://example.com/avatar.png");

    const stored = sessionStorage.getItem("mct-auth");
    expect(stored).not.toBeNull();
    const parsed = JSON.parse(stored!);
    expect(parsed.state).toHaveProperty("avatarUrl");
    expect(parsed.state).not.toHaveProperty("user");
  });
});
