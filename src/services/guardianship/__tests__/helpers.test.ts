import { beforeEach, describe, expect, it, vi } from "vitest";

const { mockFrom, queues } = vi.hoisted(() => {
  const queues: Record<string, unknown[]> = {};
  const mockFrom = vi.fn((table: string) => {
    const chain: Record<string, unknown> = {};
    const next = () => Promise.resolve(queues[table]?.shift());
    chain.select = vi.fn(() => chain);
    chain.eq = vi.fn(() => chain);
    chain.order = vi.fn(next);
    chain.maybeSingle = vi.fn(next);
    return chain;
  });
  return { mockFrom, queues };
});

vi.mock("@/services/supabase/admin", () => ({
  supabaseAdmin: { from: mockFrom },
}));

import {
  getHelperInvitationByToken,
  helperErrorResponse,
  helperInvitationUrl,
  loadHelpersOverview,
} from "../helpers";

const FUTURE = new Date(Date.now() + 5 * 60 * 60 * 1000).toISOString();
const PAST = new Date(Date.now() - 60 * 1000).toISOString();

beforeEach(() => {
  vi.clearAllMocks();
  for (const key of Object.keys(queues)) delete queues[key];
});

describe("getHelperInvitationByToken", () => {
  it("returns null for a malformed token without a query", async () => {
    expect(await getHelperInvitationByToken("nope")).toBeNull();
    expect(mockFrom).not.toHaveBeenCalled();
  });

  it("describes a pending invitation with the hours left", async () => {
    queues.helper_invitations = [
      {
        data: {
          id: "i1",
          email: "carer@example.com",
          relationship: "carer",
          status: "pending",
          expires_at: FUTURE,
          player: { first_name: "Bea", last_name: "Player" },
        },
        error: null,
      },
    ];
    const view = await getHelperInvitationByToken("a".repeat(43));
    expect(view).toMatchObject({
      id: "i1",
      state: "pending",
      hoursLeft: 5,
      playerName: "Bea Player",
    });
  });

  it("reports a lapsed pending invitation as expired", async () => {
    queues.helper_invitations = [
      {
        data: {
          id: "i1",
          email: "carer@example.com",
          relationship: "carer",
          status: "pending",
          expires_at: PAST,
          player: null,
        },
        error: null,
      },
    ];
    const view = await getHelperInvitationByToken("a".repeat(43));
    expect(view?.state).toBe("expired");
    expect(view?.hoursLeft).toBe(0);
  });
});

describe("loadHelpersOverview", () => {
  it("lists helpers, pending invitations and only self-managed players helped", async () => {
    queues.guardianships = [
      {
        data: [
          {
            id: "g1",
            relationship: "carer",
            authorisation_method: "player_invite",
            created_at: "2026-11-01T00:00:00Z",
            terms_accepted_at: "2026-11-02T00:00:00Z",
            person: { first_name: "Hal", last_name: "Helper" },
          },
        ],
        error: null,
      },
      {
        data: [
          {
            id: "g2",
            relationship: "coach",
            authorisation_method: "player_invite",
            created_at: "2026-11-03T00:00:00Z",
            terms_accepted_at: "2026-11-03T00:00:00Z",
            person: {
              first_name: "Ada",
              last_name: "Adult",
              account_type: "self",
            },
          },
          {
            id: "g3",
            relationship: "parent",
            authorisation_method: null,
            created_at: "2026-11-03T00:00:00Z",
            terms_accepted_at: "2026-11-03T00:00:00Z",
            person: {
              first_name: "Kai",
              last_name: "Child",
              account_type: "managed",
            },
          },
        ],
        error: null,
      },
    ];
    queues.helper_invitations = [
      {
        data: [
          {
            id: "i1",
            email: "a@example.com",
            relationship: "carer",
            status: "pending",
            expires_at: FUTURE,
          },
          {
            id: "i2",
            email: "b@example.com",
            relationship: "other",
            status: "pending",
            expires_at: PAST,
          },
        ],
        error: null,
      },
    ];

    const result = await loadHelpersOverview("player", true);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data.can_invite).toBe(true);
    expect(result.data.helpers).toEqual([
      {
        guardianship_id: "g1",
        name: "Hal Helper",
        relationship: "carer",
        authorisation_method: "player_invite",
        since: "2026-11-02T00:00:00Z",
      },
    ]);
    expect(result.data.invitations.map((i) => [i.id, i.state])).toEqual([
      ["i1", "pending"],
      ["i2", "expired"],
    ]);
    expect(result.data.helping.map((h) => h.guardianship_id)).toEqual(["g2"]);
  });

  it("passes a database error back", async () => {
    const error = { message: "boom" };
    queues.guardianships = [
      { data: null, error },
      { data: [], error: null },
    ];
    queues.helper_invitations = [{ data: [], error: null }];
    expect(await loadHelpersOverview("player", false)).toEqual({
      ok: false,
      error,
    });
  });
});

describe("helperInvitationUrl", () => {
  it("points at the public invitation page", () => {
    expect(helperInvitationUrl("tok")).toMatch(/\/helper-invitations\/tok$/);
  });
});

describe("helperErrorResponse", () => {
  it.each([
    ["INVITATION_NOT_FOUND: x", 404],
    ["INVITATION_WRONG_ACCOUNT: x", 403],
    ["INVITATION_EXPIRED: x", 410],
    ["INVITATION_CLOSED: x", 409],
    ["HELPER_NOT_FOUND: x", 404],
    ["HELPER_SELF: x", 400],
    ["HELPER_ALREADY_ACTIVE: x", 409],
    ["HELPER_INVITE_NOT_ALLOWED: x", 403],
    ["HELPER_NOT_ELIGIBLE: x", 403],
    ["GUARDIANSHIP_LIMIT_REACHED: x", 422],
    ["INVALID_HELPER_INVITATION: x", 400],
  ])("maps %s to %i", (message, status) => {
    expect(helperErrorResponse({ message }, "testing").status).toBe(status);
  });

  it("hides anything else behind a 500", () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    expect(helperErrorResponse({ message: "boom" }, "testing").status).toBe(
      500,
    );
  });
});
