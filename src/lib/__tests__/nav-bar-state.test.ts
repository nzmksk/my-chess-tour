import { describe, expect, it } from "vitest";

import {
  closeDrawer,
  getIsDrawerOpen,
  openDrawer,
  type NavDrawerState,
} from "../nav-bar-state";

describe("nav drawer state helpers", () => {
  it("marks drawer as open for the current path", () => {
    const state = openDrawer("/tournaments");

    expect(state).toEqual({ isOpen: true, openedOnPath: "/tournaments" });
    expect(getIsDrawerOpen(state, "/tournaments")).toBe(true);
  });

  it("treats drawer as closed after pathname changes", () => {
    const state = openDrawer("/tournaments");

    expect(getIsDrawerOpen(state, "/profile")).toBe(false);
  });

  it("explicitly closes an opened drawer", () => {
    const openedState: NavDrawerState = {
      isOpen: true,
      openedOnPath: "/my-tournaments",
    };

    expect(closeDrawer(openedState)).toEqual({
      isOpen: false,
      openedOnPath: "/my-tournaments",
    });
  });
});
