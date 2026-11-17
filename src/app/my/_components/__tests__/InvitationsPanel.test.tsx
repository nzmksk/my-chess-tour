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

import InvitationsPanel from "../InvitationsPanel";
import type { InvitationView } from "@/services/organizations/invitations";

const ORG_ID = "bbbbbbbb-0000-0000-0000-000000000001";

function invitation(overrides: Partial<InvitationView> = {}): InvitationView {
  return {
    id: "inv-1",
    email: "farid@example.com",
    role: "admin",
    state: "pending",
    expiresAt: "2026-12-17T00:00:00.000Z",
    daysLeft: 12,
    organization: { id: ORG_ID, name: "KL Chess Club", available: true },
    inviterName: "Aisha Rahman",
    ...overrides,
  };
}

function respondWith(status: number, body: unknown) {
  mockFetch.mockResolvedValueOnce({ ok: status < 400, status, json: async () => body });
}

beforeEach(() => {
  vi.stubGlobal("fetch", mockFetch);
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  vi.unstubAllGlobals();
});

describe("InvitationsPanel", () => {
  it("renders nothing without invitations", () => {
    const { container } = render(<InvitationsPanel invitations={[]} />);
    expect(container.innerHTML).toBe("");
  });

  it("lists each invitation with its inviter, role and expiry", () => {
    render(
      <InvitationsPanel
        invitations={[
          invitation(),
          invitation({
            id: "inv-2",
            role: "member",
            daysLeft: 1,
            inviterName: null,
            organization: { id: "org-2", name: "Penang Knights", available: true },
          }),
        ]}
      />,
    );
    expect(screen.getByRole("heading", { name: "Organization Invitations" })).toBeTruthy();
    expect(screen.getByText(/Aisha Rahman invited you to join/).textContent).toContain(
      "KL Chess Club as an admin.",
    );
    expect(screen.getByText(/Someone invited you to join/).textContent).toContain(
      "Penang Knights as a member.",
    );
    expect(screen.getByText("Expires in 12 days")).toBeTruthy();
    expect(screen.getByText("Expires within a day")).toBeTruthy();
  });

  it("accepts by id and opens the organization", async () => {
    respondWith(200, { data: { organization_id: ORG_ID, already_accepted: false } });
    render(<InvitationsPanel invitations={[invitation()]} />);

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Accept" }));
    });

    expect(mockFetch).toHaveBeenCalledWith("/api/v1/me/invitations/inv-1/accept", {
      method: "POST",
    });
    expect(mockPush).toHaveBeenCalledWith(`/my/organizations/${ORG_ID}`);
    expect(mockRefresh).toHaveBeenCalled();
  });

  it("declines by id, drops it and says so", async () => {
    respondWith(200, { data: { already_declined: false } });
    render(<InvitationsPanel invitations={[invitation()]} />);

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Decline" }));
    });

    expect(mockFetch).toHaveBeenCalledWith("/api/v1/me/invitations/inv-1/decline", {
      method: "POST",
    });
    expect(screen.queryByRole("button", { name: "Accept" })).toBeNull();
    expect(screen.getByRole("status").textContent).toBe(
      "You declined the invitation to join KL Chess Club.",
    );
  });

  it("shows the API's message and keeps the invitation when refused", async () => {
    respondWith(410, {
      error: { code: "INVITATION_EXPIRED", message: "This invitation has expired" },
    });
    render(<InvitationsPanel invitations={[invitation()]} />);

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Accept" }));
    });

    expect(screen.getByRole("alert").textContent).toBe("This invitation has expired");
    expect(screen.getByRole("button", { name: "Accept" })).toBeTruthy();
    expect(mockPush).not.toHaveBeenCalled();
  });
});
