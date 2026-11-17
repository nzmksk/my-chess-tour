// @vitest-environment jsdom
import React from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  cleanup,
  fireEvent,
  render,
  screen,
} from "@testing-library/react";
import MembersClient from "../MembersClient";

const mockFetch = vi.fn();
vi.stubGlobal("fetch", mockFetch);

const ORG_ID = "bbbbbbbb-0000-4000-8000-000000000001";

const OWNER = {
  user_id: "u-1",
  email: "owner@example.com",
  first_name: "Olive",
  last_name: "Owner",
  avatar_url: null,
  role: "owner",
  joined_at: "2026-01-01T00:00:00Z",
};

function renderMembers() {
  render(
    <MembersClient
      orgId={ORG_ID}
      orgName="Test Organization"
      members={[OWNER]}
      currentUserId="u-1"
    />,
  );
}

function invite(email: string, role: "admin" | "member") {
  fireEvent.change(screen.getByLabelText("Email address"), {
    target: { value: email },
  });
  fireEvent.change(screen.getByLabelText("Role"), { target: { value: role } });
  fireEvent.click(screen.getByRole("button", { name: "Send Invite" }));
}

function respondWith(data: Record<string, unknown>) {
  mockFetch.mockResolvedValueOnce({
    ok: true,
    json: async () => ({ data }),
  });
}

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("MembersClient invite", () => {
  it("says an existing user was added as an admin when invited as one", async () => {
    respondWith({ email: "mail@example.com", role: "admin", status: "active" });
    renderMembers();
    invite("mail@example.com", "admin");

    expect(
      await screen.findByText("mail@example.com has been added as an admin"),
    ).toBeTruthy();
    expect(JSON.parse(mockFetch.mock.calls[0][1].body)).toEqual({
      email: "mail@example.com",
      role: "admin",
    });
  });

  it("says an existing user was added as a member when invited as one", async () => {
    respondWith({ email: "mail@example.com", role: "member", status: "active" });
    renderMembers();
    invite("mail@example.com", "member");

    expect(
      await screen.findByText("mail@example.com has been added as a member"),
    ).toBeTruthy();
  });

  it("says an invitation was sent to someone without an account", async () => {
    respondWith({ email: "new@example.com", role: "admin", status: "pending" });
    renderMembers();
    invite("new@example.com", "admin");

    expect(
      await screen.findByText("Invitation sent to new@example.com"),
    ).toBeTruthy();
  });

  it("warns when a new member's invitation email couldn't be sent", async () => {
    respondWith({
      email: "new@example.com",
      role: "member",
      status: "pending",
      email_sent: false,
    });
    renderMembers();
    invite("new@example.com", "member");

    expect(
      await screen.findByText(/new@example.com was invited, but the invitation email couldn't be sent/),
    ).toBeTruthy();
    expect(screen.queryByText("Invitation sent to new@example.com")).toBeNull();
  });

  it("warns when an added member couldn't be emailed", async () => {
    respondWith({
      email: "mail@example.com",
      role: "admin",
      status: "active",
      email_sent: false,
    });
    renderMembers();
    invite("mail@example.com", "admin");

    expect(
      await screen.findByText(
        "mail@example.com has been added as an admin, but the email letting them know couldn't be sent.",
      ),
    ).toBeTruthy();
  });
});
