import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  getCurrentUser,
  getUserOrgRole,
  requireAdmin,
  requireOrgRole,
} from "../permission";

vi.mock("next/headers", () => ({
  cookies: vi.fn(() => ({ getAll: vi.fn(() => []), set: vi.fn() })),
}));

vi.mock("@/lib/supabase/server");

import * as supabaseServer from "@/lib/supabase/server";

const createClient = vi.mocked(supabaseServer.createClient);

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Builds a chainable Supabase query mock that resolves .single() with result. */
function makeQueryChain(result: { data: unknown; error: unknown }) {
  const single = vi.fn().mockResolvedValue(result);
  const chain = {
    select: vi.fn().mockReturnThis(),
    eq: vi.fn().mockReturnThis(),
    single,
  };
  return chain;
}

function makeClient({
  authUser = null as unknown,
  queryResult = { data: null, error: null } as { data: unknown; error: unknown },
} = {}) {
  const chain = makeQueryChain(queryResult);
  return {
    from: vi.fn().mockReturnValue(chain),
    auth: {
      getUser: vi.fn().mockResolvedValue({ data: { user: authUser } }),
    },
    _chain: chain, // exposed for assertion
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("getCurrentUser", () => {
  beforeEach(() => vi.clearAllMocks());

  it("returns the authenticated user", async () => {
    const user = { id: "u1", email: "alice@example.com" };
    createClient.mockResolvedValue(makeClient({ authUser: user }) as never);

    expect(await getCurrentUser()).toEqual(user);
  });

  it("returns null when no session exists", async () => {
    createClient.mockResolvedValue(makeClient({ authUser: null }) as never);
    expect(await getCurrentUser()).toBeNull();
  });
});

describe("getUserOrgRole", () => {
  beforeEach(() => vi.clearAllMocks());

  it("returns the user's role in the organisation", async () => {
    createClient.mockResolvedValue(
      makeClient({ queryResult: { data: { role: "admin" }, error: null } }) as never
    );
    expect(await getUserOrgRole("u1", "org1")).toBe("admin");
  });

  it("returns null when the user is not a member", async () => {
    createClient.mockResolvedValue(
      makeClient({ queryResult: { data: null, error: null } }) as never
    );
    expect(await getUserOrgRole("u1", "org1")).toBeNull();
  });

  it("queries the organizer_members table with correct filters", async () => {
    const client = makeClient({
      queryResult: { data: { role: "member" }, error: null },
    });
    createClient.mockResolvedValue(client as never);

    await getUserOrgRole("u1", "org1");

    expect(client.from).toHaveBeenCalledWith("organizer_members");
    expect(client._chain.eq).toHaveBeenCalledWith("user_id", "u1");
    expect(client._chain.eq).toHaveBeenCalledWith("organizer_id", "org1");
  });
});

describe("requireOrgRole", () => {
  beforeEach(() => vi.clearAllMocks());

  it.each([
    ["owner", "owner"],
    ["owner", "admin"],
    ["owner", "member"],
    ["admin", "admin"],
    ["admin", "member"],
    ["member", "member"],
  ] as const)(
    "does not throw when role=%s satisfies minRole=%s",
    async (role, minRole) => {
      createClient.mockResolvedValue(
        makeClient({ queryResult: { data: { role }, error: null } }) as never
      );
      await expect(requireOrgRole("u1", "org1", minRole)).resolves.toBeUndefined();
    }
  );

  it.each([
    ["member", "admin"],
    ["member", "owner"],
    ["admin", "owner"],
  ] as const)(
    "throws when role=%s is below minRole=%s",
    async (role, minRole) => {
      createClient.mockResolvedValue(
        makeClient({ queryResult: { data: { role }, error: null } }) as never
      );
      await expect(requireOrgRole("u1", "org1", minRole)).rejects.toThrow(
        "Insufficient permissions"
      );
    }
  );

  it("throws when user has no role in the organisation", async () => {
    createClient.mockResolvedValue(
      makeClient({ queryResult: { data: null, error: null } }) as never
    );
    await expect(requireOrgRole("u1", "org1", "member")).rejects.toThrow(
      "Insufficient permissions"
    );
  });
});

describe("requireAdmin", () => {
  beforeEach(() => vi.clearAllMocks());

  it("does not throw when user has the admin role", async () => {
    createClient.mockResolvedValue(
      makeClient({ queryResult: { data: { role: ["admin"] }, error: null } }) as never
    );
    await expect(requireAdmin("u1")).resolves.toBeUndefined();
  });

  it("does not throw when user has admin among multiple roles", async () => {
    createClient.mockResolvedValue(
      makeClient({
        queryResult: { data: { role: ["player", "admin"] }, error: null },
      }) as never
    );
    await expect(requireAdmin("u1")).resolves.toBeUndefined();
  });

  it("throws when user only has the player role", async () => {
    createClient.mockResolvedValue(
      makeClient({ queryResult: { data: { role: ["player"] }, error: null } }) as never
    );
    await expect(requireAdmin("u1")).rejects.toThrow("Admin access required");
  });

  it("throws when user record is not found", async () => {
    createClient.mockResolvedValue(
      makeClient({ queryResult: { data: null, error: null } }) as never
    );
    await expect(requireAdmin("u1")).rejects.toThrow("Admin access required");
  });
});
