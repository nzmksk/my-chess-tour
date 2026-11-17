// @vitest-environment jsdom
import React from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";

const { mockPush, mockRefresh, mockFetch } = vi.hoisted(() => ({
  mockPush: vi.fn(),
  mockRefresh: vi.fn(),
  mockFetch: vi.fn(),
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: mockPush, refresh: mockRefresh }),
}));

import InvitationClient from "../InvitationClient";
import type { InvitationView } from "@/services/organizations/invitations";

const TOKEN = "T".repeat(43);
const ORG_ID = "bbbbbbbb-0000-0000-0000-000000000001";

function invitation(overrides: Partial<InvitationView> = {}): InvitationView {
  return {
    id: "inv-1",
    email: "farid@example.com",
    role: "admin",
    state: "pending",
    expiresAt: "2026-12-17T00:00:00.000Z",
    daysLeft: 30,
    organization: { id: ORG_ID, name: "KL Chess Club", available: true },
    inviterName: "Aisha Rahman",
    ...overrides,
  };
}

function renderClient(
  props: Partial<React.ComponentProps<typeof InvitationClient>> = {},
) {
  return render(
    <InvitationClient
      token={TOKEN}
      invitation={invitation()}
      loadFailed={false}
      viewerEmail={null}
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

describe("InvitationClient — a pending invitation", () => {
  it("names the inviter, organization, role and expiry", () => {
    renderClient();
    expect(screen.getByText(/Aisha Rahman invited you to join/)).toBeTruthy();
    expect(screen.getByText("KL Chess Club")).toBeTruthy();
    expect(screen.getByText(/as an admin/)).toBeTruthy();
    expect(screen.getByText(/Sent to farid@example.com\. It expires in 30 days\./)).toBeTruthy();
  });

  it("offers login, signup and decline to a visitor who isn't signed in", () => {
    renderClient();
    const login = screen.getByRole("link", { name: "Log In to Accept" });
    expect(login.getAttribute("href")).toBe(
      `/auth/login?redirectTo=${encodeURIComponent(`/invitations/${TOKEN}`)}`,
    );
    expect(screen.getByRole("button", { name: "Create an Account" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Decline" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Accept Invitation" })).toBeNull();
  });

  it("seeds signup with the invited address and a way back", () => {
    renderClient();
    fireEvent.click(screen.getByRole("button", { name: "Create an Account" }));
    expect(JSON.parse(sessionStorage.getItem("signup_form") as string)).toEqual({
      email: "farid@example.com",
    });
    expect(sessionStorage.getItem("signup_return_to")).toBe(`/invitations/${TOKEN}`);
    expect(mockPush).toHaveBeenCalledWith("/auth/signup");
  });

  it("lets the invited account accept, then opens the organization", async () => {
    respondWith(200, { data: { organization_id: ORG_ID, already_accepted: false } });
    renderClient({ viewerEmail: "Farid@Example.com" });

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Accept Invitation" }));
    });

    expect(mockFetch).toHaveBeenCalledWith(`/api/v1/invitations/${TOKEN}/accept`, {
      method: "POST",
    });
    expect(mockPush).toHaveBeenCalledWith(`/my/organizations/${ORG_ID}`);
    expect(mockRefresh).toHaveBeenCalled();
  });

  it("explains that another account can't accept", () => {
    renderClient({ viewerEmail: "someone@else.com" });
    expect(screen.getByRole("status").textContent).toMatch(
      /signed in as someone@else.com.*sign in as farid@example.com/,
    );
    expect(screen.queryByRole("button", { name: "Accept Invitation" })).toBeNull();
    expect(screen.getByRole("button", { name: "Decline" })).toBeTruthy();
  });

  it("confirms a decline", async () => {
    respondWith(200, { data: { already_declined: false } });
    renderClient();

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Decline" }));
    });

    expect(mockFetch).toHaveBeenCalledWith(`/api/v1/invitations/${TOKEN}/decline`, {
      method: "POST",
    });
    expect(screen.getByRole("heading", { name: "Invitation Declined" })).toBeTruthy();
  });

  it("shows the API's message when a response is refused", async () => {
    respondWith(410, {
      error: { code: "INVITATION_EXPIRED", message: "This invitation has expired" },
    });
    renderClient({ viewerEmail: "farid@example.com" });

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Accept Invitation" }));
    });

    expect(screen.getByRole("alert").textContent).toContain("This invitation has expired");
    expect(mockPush).not.toHaveBeenCalled();
  });

  it("says when it expires within a day", () => {
    renderClient({ invitation: invitation({ daysLeft: 1 }) });
    expect(screen.getByText(/It expires within a day\./)).toBeTruthy();
  });
});

describe("InvitationClient — closed invitations", () => {
  it.each([
    ["expired", "Invitation Expired", /Invitations last 30 days/],
    ["revoked", "Invitation Withdrawn", /withdrew this invitation/],
    ["declined", "Invitation Declined", /You declined/],
    ["accepted", "Already Accepted", /already been accepted/],
  ] as const)("shows a %s invitation with no actions", (state, heading, text) => {
    renderClient({ invitation: invitation({ state }) });
    expect(screen.getByRole("heading", { name: heading })).toBeTruthy();
    expect(screen.getByText(text)).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Decline" })).toBeNull();
  });

  it("links the invitee to the dashboard of an invitation they accepted", () => {
    renderClient({
      invitation: invitation({ state: "accepted" }),
      viewerEmail: "farid@example.com",
    });
    expect(
      screen.getByRole("link", { name: "Go to Dashboard" }).getAttribute("href"),
    ).toBe(`/my/organizations/${ORG_ID}`);
  });

  it("says when the organization isn't taking members", () => {
    renderClient({
      invitation: invitation({
        organization: { id: ORG_ID, name: "KL Chess Club", available: false },
      }),
    });
    expect(screen.getByRole("heading", { name: "Invitation Unavailable" })).toBeTruthy();
  });

  it("says when the link matches nothing", () => {
    renderClient({ invitation: null });
    expect(screen.getByRole("heading", { name: "Invitation Not Found" })).toBeTruthy();
  });

  it("says when the invitation couldn't be loaded", () => {
    renderClient({ invitation: null, loadFailed: true });
    expect(screen.getByRole("heading", { name: "Something Went Wrong" })).toBeTruthy();
  });
});
