// @vitest-environment jsdom
import React from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
} from "@testing-library/react";

const { mockPush, mockRefresh, mockFetch } = vi.hoisted(() => ({
  mockPush: vi.fn(),
  mockRefresh: vi.fn(),
  mockFetch: vi.fn(),
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: mockPush, refresh: mockRefresh }),
}));

import HelperInvitationClient from "../HelperInvitationClient";
import type { HelperInvitationView } from "@/services/guardianship/helpers";

const TOKEN = "T".repeat(43);

function invitation(
  overrides: Partial<HelperInvitationView> = {},
): HelperInvitationView {
  return {
    id: "inv-1",
    email: "carer@example.com",
    relationship: "carer",
    state: "pending",
    expiresAt: "2026-11-27T00:00:00.000Z",
    hoursLeft: 72,
    playerName: "Bea Player",
    ...overrides,
  };
}

function renderClient(
  props: Partial<React.ComponentProps<typeof HelperInvitationClient>> = {},
) {
  return render(
    <HelperInvitationClient
      token={TOKEN}
      invitation={invitation()}
      loadFailed={false}
      signedIn={true}
      viewerEmail="carer@example.com"
      {...props}
    />,
  );
}

function respondWith(status: number, body: unknown) {
  mockFetch.mockResolvedValueOnce({
    ok: status < 400,
    status,
    json: async () => body,
  });
}

beforeEach(() => {
  vi.stubGlobal("fetch", mockFetch);
  sessionStorage.clear();
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  vi.unstubAllGlobals();
});

describe("HelperInvitationClient", () => {
  it("names the player, the relationship and the expiry", () => {
    renderClient();
    expect(screen.getByRole("heading", { name: "Help a Player" })).toBeTruthy();
    expect(screen.getAllByText(/Bea Player/).length).toBeGreaterThan(0);
    expect(screen.getByText(/as their carer/)).toBeTruthy();
    expect(screen.getByText(/It expires in 72 hours/)).toBeTruthy();
  });

  it("keeps Accept disabled until the helper agrees", async () => {
    renderClient();
    const accept = screen.getByRole("button", { name: "Accept Invitation" });
    expect((accept as HTMLButtonElement).disabled).toBe(true);

    fireEvent.click(screen.getByRole("checkbox"));
    expect((accept as HTMLButtonElement).disabled).toBe(false);

    respondWith(200, { data: { guardianship_id: "g" } });
    await act(async () => {
      fireEvent.click(accept);
    });
    expect(mockFetch).toHaveBeenCalledWith(
      `/api/v1/helper-invitations/${TOKEN}/accept`,
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({ accept_terms: true }),
      }),
    );
    expect(
      screen.getByRole("heading", { name: "You're Now a Helper" }),
    ).toBeTruthy();
  });

  it("shows the server's message when accepting fails", async () => {
    renderClient();
    fireEvent.click(screen.getByRole("checkbox"));
    respondWith(403, {
      error: {
        message: "This invitation was sent to a different email address.",
      },
    });
    await act(async () => {
      fireEvent.click(
        screen.getByRole("button", { name: "Accept Invitation" }),
      );
    });
    expect(screen.getByRole("alert").textContent).toContain(
      "different email address",
    );
  });

  it("declines without an account", async () => {
    renderClient({ signedIn: false, viewerEmail: null });
    expect(
      screen.queryByRole("button", { name: "Accept Invitation" }),
    ).toBeNull();
    expect(screen.getByRole("link", { name: "Log In to Accept" })).toBeTruthy();

    respondWith(200, { data: { already_declined: false } });
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Decline" }));
    });
    expect(mockFetch).toHaveBeenCalledWith(
      `/api/v1/helper-invitations/${TOKEN}/decline`,
      expect.objectContaining({ method: "POST" }),
    );
    expect(
      screen.getByRole("heading", { name: "Invitation Declined" }),
    ).toBeTruthy();
  });

  it("prefills signup with the invited address and returns here", () => {
    renderClient({ signedIn: false, viewerEmail: null });
    fireEvent.click(screen.getByRole("button", { name: "Create an Account" }));
    expect(mockPush).toHaveBeenCalledWith("/auth/signup");
    expect(Object.values({ ...sessionStorage }).join(" ")).toContain(
      "carer@example.com",
    );
  });

  it.each([
    ["expired", "Invitation Expired"],
    ["accepted", "Already Accepted"],
    ["revoked", "Invitation Withdrawn"],
    ["declined", "Invitation Declined"],
  ] as const)("explains a %s invitation", (state, heading) => {
    renderClient({ invitation: invitation({ state }) });
    expect(screen.getByRole("heading", { name: heading })).toBeTruthy();
    expect(
      screen.queryByRole("button", { name: "Accept Invitation" }),
    ).toBeNull();
  });

  it("explains a missing invitation and a failed load", () => {
    renderClient({ invitation: null });
    expect(
      screen.getByRole("heading", { name: "Invitation Not Found" }),
    ).toBeTruthy();
    cleanup();
    renderClient({ loadFailed: true });
    expect(
      screen.getByRole("heading", { name: "Something Went Wrong" }),
    ).toBeTruthy();
  });
});
