// @vitest-environment jsdom
import React from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import type { HelpersOverview } from "@/services/guardianship/helpers";

const mockFetch = vi.fn();

import HelpersCard from "../HelpersCard";

const FUTURE = "2026-11-27T00:00:00.000Z";

function overview(overrides: Partial<HelpersOverview> = {}): HelpersOverview {
  return {
    can_invite: true,
    helpers: [
      {
        guardianship_id: "g1",
        name: "Hal Helper",
        relationship: "carer",
        authorisation_method: "player_invite",
        since: "2026-11-20T00:00:00.000Z",
      },
    ],
    invitations: [
      {
        id: "i1",
        email: "pending@example.com",
        relationship: "coach",
        expires_at: FUTURE,
        state: "pending",
      },
      {
        id: "i2",
        email: "lapsed@example.com",
        relationship: "other",
        expires_at: "2026-11-01T00:00:00.000Z",
        state: "expired",
      },
    ],
    helping: [
      {
        guardianship_id: "g2",
        name: "Ada Adult",
        relationship: "carer",
        authorisation_method: "player_invite",
        since: "2026-11-21T00:00:00.000Z",
      },
    ],
    ...overrides,
  };
}

function reply(status: number, body: unknown) {
  return { ok: status < 400, status, json: async () => body };
}

function routeFetch(data: HelpersOverview) {
  mockFetch.mockImplementation(async (url: string, init?: RequestInit) => {
    if (
      url === "/api/v1/me/helpers" &&
      (!init || !init.method || init.method === "GET")
    ) {
      return reply(200, { data });
    }
    if (url === "/api/v1/me/helpers" && init?.method === "POST") {
      const body = JSON.parse(String(init.body));
      return reply(201, {
        data: { id: "new", email: body.email, email_sent: true },
      });
    }
    if (init?.method === "DELETE") return reply(200, { data: {} });
    return reply(404, {});
  });
}

beforeEach(() => {
  vi.stubGlobal("fetch", mockFetch);
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  vi.unstubAllGlobals();
});

describe("HelpersCard", () => {
  it("lists helpers, invitations and the players the user helps", async () => {
    routeFetch(overview());
    render(<HelpersCard />);
    expect(await screen.findByText("Hal Helper")).toBeTruthy();
    expect(screen.getByText("pending@example.com")).toBeTruthy();
    expect(screen.getByText("lapsed@example.com")).toBeTruthy();
    expect(screen.getByText("Ada Adult")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Resend" })).toBeTruthy();
  });

  it("invites a helper by email and relationship", async () => {
    routeFetch(overview({ helpers: [], invitations: [], helping: [] }));
    render(<HelpersCard />);
    const input = await screen.findByLabelText("Their email address");
    fireEvent.change(input, { target: { value: " carer@example.com " } });
    fireEvent.change(screen.getByLabelText("They are your"), {
      target: { value: "parent" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Send invitation" }));

    await waitFor(() =>
      expect(screen.getByRole("status").textContent).toContain(
        "Invitation sent to carer@example.com",
      ),
    );
    const post = mockFetch.mock.calls.find(
      ([, init]) => init?.method === "POST",
    );
    expect(JSON.parse(String(post?.[1].body))).toEqual({
      email: "carer@example.com",
      relationship: "parent",
    });
  });

  it("shows the server's message when the invitation is refused", async () => {
    routeFetch(overview({ helpers: [], invitations: [], helping: [] }));
    render(<HelpersCard />);
    const input = await screen.findByLabelText("Their email address");
    mockFetch.mockImplementationOnce(async () =>
      reply(409, {
        error: { message: "This person already helps with this account." },
      }),
    );
    fireEvent.change(input, { target: { value: "c@example.com" } });
    fireEvent.click(screen.getByRole("button", { name: "Send invitation" }));
    expect((await screen.findByRole("alert")).textContent).toContain(
      "already helps",
    );
  });

  it("removes a helper after confirming", async () => {
    routeFetch(overview());
    render(<HelpersCard />);
    fireEvent.click(
      await screen.findByRole("button", { name: "Remove: Hal Helper" }),
    );
    fireEvent.click(screen.getByRole("button", { name: "Remove helper" }));
    await waitFor(() =>
      expect(mockFetch).toHaveBeenCalledWith("/api/v1/me/helpers/g1", {
        method: "DELETE",
      }),
    );
  });

  it("steps down for a player the user helps", async () => {
    routeFetch(overview());
    render(<HelpersCard />);
    fireEvent.click(
      await screen.findByRole("button", { name: "Step down: Ada Adult" }),
    );
    fireEvent.click(screen.getByRole("button", { name: "Step down" }));
    await waitFor(() =>
      expect(mockFetch).toHaveBeenCalledWith("/api/v1/me/helpers/g2", {
        method: "DELETE",
      }),
    );
  });

  it("withdraws and resends invitations", async () => {
    routeFetch(overview());
    render(<HelpersCard />);
    fireEvent.click(
      await screen.findByRole("button", {
        name: "Withdraw the invitation to pending@example.com",
      }),
    );
    await waitFor(() =>
      expect(mockFetch).toHaveBeenCalledWith(
        "/api/v1/me/helper-invitations/i1",
        {
          method: "DELETE",
        },
      ),
    );

    fireEvent.click(screen.getByRole("button", { name: "Resend" }));
    await waitFor(() => {
      const post = mockFetch.mock.calls.find(
        ([, init]) => init?.method === "POST",
      );
      expect(JSON.parse(String(post?.[1].body))).toEqual({
        email: "lapsed@example.com",
        relationship: "other",
      });
    });
  });

  it("hides the invite form from someone who can't invite", async () => {
    routeFetch(
      overview({
        can_invite: false,
        helpers: [],
        invitations: [],
        helping: [],
      }),
    );
    render(<HelpersCard />);
    expect(
      await screen.findByText(/available to players aged 18 or over/),
    ).toBeTruthy();
    expect(screen.queryByLabelText("Their email address")).toBeNull();
  });

  it("says so when the overview can't be loaded", async () => {
    mockFetch.mockResolvedValue(reply(500, {}));
    render(<HelpersCard />);
    expect((await screen.findByRole("alert")).textContent).toContain(
      "couldn't load your helpers",
    );
  });
});
