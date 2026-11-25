import React from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";

const { mockGetAuthClaims, mockListInvitations, mockRegistrationsClient } =
  vi.hoisted(() => ({
    mockGetAuthClaims: vi.fn(),
    mockListInvitations: vi.fn(),
    mockRegistrationsClient: vi.fn(),
  }));

vi.mock("next/headers", () => ({
  headers: async () =>
    new Map([
      ["host", "staging.example.com"],
      ["cookie", "sb=1"],
    ]),
}));
vi.mock("next/navigation", () => ({
  redirect: vi.fn(() => {
    throw new Error("redirect");
  }),
}));
vi.mock("@/components/NavBar", () => ({ default: () => null }));
vi.mock("@/services/supabase/permission", () => ({
  getAuthClaims: mockGetAuthClaims,
}));
vi.mock("@/services/organizations/invitations", () => ({
  listInvitationsForUser: mockListInvitations,
}));
vi.mock("../_components/PlayerDashboardShell", () => ({
  default: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));
vi.mock("../_components/InvitationsPanel", () => ({ default: () => null }));
vi.mock("../tournaments/_components/RegistrationsClient", () => ({
  default: (props: { registrations: unknown }) => {
    mockRegistrationsClient(props);
    return null;
  },
}));

import MyDashboardPage from "../page";

async function renderedRegistrations(): Promise<unknown> {
  renderToStaticMarkup(await MyDashboardPage());
  return mockRegistrationsClient.mock.calls[0][0].registrations;
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.spyOn(console, "error").mockImplementation(() => {});
  mockGetAuthClaims.mockResolvedValue({ id: "user-1" });
  mockListInvitations.mockResolvedValue([]);
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("MyDashboardPage", () => {
  it("passes the loaded registrations through", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ data: [{ id: "reg-1" }] }),
    });
    vi.stubGlobal("fetch", fetchMock);

    expect(await renderedRegistrations()).toEqual([{ id: "reg-1" }]);
    expect(fetchMock).toHaveBeenCalledWith(
      "https://staging.example.com/api/v1/me/registrations",
      expect.objectContaining({ headers: { cookie: "sb=1" } }),
    );
  });

  it("reports a failed load instead of an empty list", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({ ok: false, status: 500 }),
    );

    expect(await renderedRegistrations()).toBeNull();
    expect(console.error).toHaveBeenCalledWith(
      expect.stringContaining("HTTP 500"),
    );
  });

  it("reports a network failure instead of an empty list", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("down")));

    expect(await renderedRegistrations()).toBeNull();
  });
});
