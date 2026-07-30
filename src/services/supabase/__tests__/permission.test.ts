import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  getAppUserId,
  getCurrentUser,
  getNavUser,
  hasOrgPermission,
  hasGlobalPermission,
  requireOrgPermission,
  requireGlobalPermission,
} from "../permission";
import { lookupAppUserId } from "@/services/supabase/identity";

// Stubbed globally in src/test/setup.ts to return the auth id unchanged.
const mockLookupAppUserId = vi.mocked(lookupAppUserId);

vi.mock("next/headers", () => ({
  cookies: vi.fn(() => ({ getAll: vi.fn(() => []), set: vi.fn() })),
}));

vi.mock("@/services/supabase/server");

vi.mock("@/services/supabase/admin", () => ({
  supabaseAdmin: { from: vi.fn() },
}));

import * as supabaseServer from "@/services/supabase/server";
import { supabaseAdmin } from "@/services/supabase/admin";

const createClient = vi.mocked(supabaseServer.createClient);
const mockAdmin = vi.mocked(supabaseAdmin);

// getNavUser issues two admin reads: the users avatar lookup and the org
// memberships query (getUserOrganizations). Route by table so both chains
// resolve independently.
function mockAdminNavQueries(
  avatarData: { avatar_url?: string } | null,
  orgRows: unknown[] = [],
) {
  const usersChain = {
    select: vi.fn().mockReturnValue({
      eq: vi.fn().mockReturnValue({
        maybeSingle: vi.fn().mockResolvedValue({ data: avatarData }),
      }),
    }),
  };
  // organization_memberships: select → eq → eq → is → order → { data }
  const membershipsChain = {
    select: vi.fn().mockReturnValue({
      eq: vi.fn().mockReturnValue({
        eq: vi.fn().mockReturnValue({
          is: vi.fn().mockReturnValue({
            order: vi.fn().mockResolvedValue({ data: orgRows }),
          }),
        }),
      }),
    }),
  };
  mockAdmin.from.mockImplementation((table: string) =>
    (table === "users" ? usersChain : membershipsChain) as never,
  );
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeClient({
  claims = null as unknown,
  rpcResult = null as unknown,
} = {}) {
  return {
    rpc: vi.fn().mockResolvedValue({ data: rpcResult }),
    auth: {
      getClaims: vi.fn().mockResolvedValue({ data: { claims } }),
    },
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("getNavUser", () => {
  beforeEach(() => vi.clearAllMocks());

  it("returns null when there are no auth claims", async () => {
    createClient.mockResolvedValue(makeClient({ claims: null }) as never);
    expect(await getNavUser()).toBeNull();
  });

  it("returns claims and avatarUrl when the user has an avatar", async () => {
    const claims = {
      sub: "u1",
      email: "alice@example.com",
      user_metadata: { first_name: "Alice" },
      role: "authenticated",
    };
    createClient.mockResolvedValue(makeClient({ claims }) as never);
    mockAdminNavQueries({ avatar_url: "https://example.com/avatar.png" });

    const result = await getNavUser();

    expect(result).toEqual({
      claims: {
        // id is the public.users.id resolved from the JWT sub via
        // users.auth_user_id; authUserId keeps the raw auth id. Equal here
        // because self-signup writes id = auth_user_id.
        id: "u1",
        authUserId: "u1",
        email: "alice@example.com",
        userMetadata: { first_name: "Alice" },
        role: "authenticated",
      },
      avatarUrl: "https://example.com/avatar.png",
      organizations: [],
    });
  });

  it("returns null avatarUrl when the user has no avatar", async () => {
    const claims = {
      sub: "u1",
      email: "alice@example.com",
      user_metadata: {},
      role: "authenticated",
    };
    createClient.mockResolvedValue(makeClient({ claims }) as never);
    mockAdminNavQueries(null);

    const result = await getNavUser();

    expect(result?.avatarUrl).toBeNull();
  });

  it("maps org memberships to the switcher shape", async () => {
    const claims = {
      sub: "u1",
      email: "alice@example.com",
      user_metadata: {},
      role: "authenticated",
    };
    createClient.mockResolvedValue(makeClient({ claims }) as never);
    mockAdminNavQueries(null, [
      {
        organizations: { id: "o1", name: "KL Chess Club", avatar_url: null },
        roles: { name: "owner" },
      },
    ]);

    const result = await getNavUser();

    expect(result?.organizations).toEqual([
      { id: "o1", name: "KL Chess Club", avatar_url: null, role: "owner" },
    ]);
  });
});

describe("getCurrentUser", () => {
  beforeEach(() => vi.clearAllMocks());

  it("returns the authenticated user identity", async () => {
    const claims = {
      sub: "u1",
      email: "alice@example.com",
      user_metadata: { first_name: "Alice" },
      role: "authenticated",
    };
    createClient.mockResolvedValue(makeClient({ claims }) as never);
    expect(await getCurrentUser()).toEqual({
      id: "u1",
      authUserId: "u1",
      email: "alice@example.com",
      userMetadata: { first_name: "Alice" },
      role: "authenticated",
    });
  });

  it("returns null when no session exists", async () => {
    createClient.mockResolvedValue(makeClient({ claims: null }) as never);
    expect(await getCurrentUser()).toBeNull();
  });
});

describe("hasOrgPermission", () => {
  beforeEach(() => vi.clearAllMocks());

  it("returns true when user has the permission", async () => {
    const client = makeClient({ rpcResult: true });
    createClient.mockResolvedValue(client as never);

    expect(await hasOrgPermission("u1", "org1", "tournament.edit")).toBe(true);
    expect(client.rpc).toHaveBeenCalledWith("has_org_permission", {
      p_user_id: "u1",
      p_org_id: "org1",
      p_permission: "tournament.edit",
    });
  });

  it("returns false when user lacks the permission", async () => {
    createClient.mockResolvedValue(makeClient({ rpcResult: false }) as never);
    expect(await hasOrgPermission("u1", "org1", "org.manage")).toBe(false);
  });
});

describe("hasGlobalPermission", () => {
  beforeEach(() => vi.clearAllMocks());

  it("returns true for platform admin", async () => {
    const client = makeClient({ rpcResult: true });
    createClient.mockResolvedValue(client as never);

    expect(await hasGlobalPermission("u1", "platform.manage")).toBe(true);
    expect(client.rpc).toHaveBeenCalledWith("has_global_permission", {
      p_user_id: "u1",
      p_permission: "platform.manage",
    });
  });

  it("returns false for non-admin user", async () => {
    createClient.mockResolvedValue(makeClient({ rpcResult: false }) as never);
    expect(await hasGlobalPermission("u1", "platform.manage")).toBe(false);
  });
});

describe("requireOrgPermission", () => {
  beforeEach(() => vi.clearAllMocks());

  it("does not throw when user has the permission", async () => {
    createClient.mockResolvedValue(makeClient({ rpcResult: true }) as never);
    await expect(
      requireOrgPermission("u1", "org1", "tournament.create"),
    ).resolves.toBeUndefined();
  });

  it("throws when user lacks the permission", async () => {
    createClient.mockResolvedValue(makeClient({ rpcResult: false }) as never);
    await expect(
      requireOrgPermission("u1", "org1", "tournament.create"),
    ).rejects.toThrow("Insufficient permissions");
  });
});

describe("requireGlobalPermission", () => {
  beforeEach(() => vi.clearAllMocks());

  it("does not throw when user has the permission", async () => {
    createClient.mockResolvedValue(makeClient({ rpcResult: true }) as never);
    await expect(
      requireGlobalPermission("u1", "platform.manage"),
    ).resolves.toBeUndefined();
  });

  it("throws when user lacks the permission", async () => {
    createClient.mockResolvedValue(makeClient({ rpcResult: false }) as never);
    await expect(
      requireGlobalPermission("u1", "platform.manage"),
    ).rejects.toThrow("Insufficient permissions");
  });
});

// ---------------------------------------------------------------------------
// Identity indirection (#501)
//
// The JWT carries an AUTH id; every application table keys off public.users.id.
// resolveAuthClaims is the only place that bridges the two, so these cover the
// bridge itself rather than any one route.
// ---------------------------------------------------------------------------

describe("identity resolution", () => {
  const claims = {
    sub: "auth-abc",
    email: "alice@example.com",
    user_metadata: {},
    role: "authenticated",
  };

  beforeEach(() => {
    vi.clearAllMocks();
    mockLookupAppUserId.mockImplementation(async (id: string) => id);
    vi.spyOn(console, "error").mockImplementation(() => {});
  });

  it("exposes the resolved users.id as `id` and the JWT sub as `authUserId`", async () => {
    mockLookupAppUserId.mockResolvedValue("app-xyz");
    createClient.mockResolvedValue(makeClient({ claims }) as never);

    const identity = await getCurrentUser();

    // The two differ here on purpose — that is the whole point of the column.
    expect(identity?.id).toBe("app-xyz");
    expect(identity?.authUserId).toBe("auth-abc");
    expect(mockLookupAppUserId).toHaveBeenCalledWith("auth-abc");
  });

  it("fails closed when a valid session has no linked users row", async () => {
    // Only reachable if the handle_new_user trigger failed, leaving a signup
    // half-provisioned. Returning an identity here would let callers write rows
    // against an id that does not exist.
    mockLookupAppUserId.mockResolvedValue(null);
    createClient.mockResolvedValue(makeClient({ claims }) as never);

    expect(await getCurrentUser()).toBeNull();
    expect(console.error).toHaveBeenCalled();
  });

  it("does not attempt a lookup when there is no session", async () => {
    createClient.mockResolvedValue(makeClient({ claims: null }) as never);

    expect(await getCurrentUser()).toBeNull();
    expect(mockLookupAppUserId).not.toHaveBeenCalled();
  });

  it("getAppUserId returns the resolved users.id", async () => {
    mockLookupAppUserId.mockResolvedValue("app-xyz");
    createClient.mockResolvedValue(makeClient({ claims }) as never);

    expect(await getAppUserId()).toBe("app-xyz");
  });

  it("getAppUserId returns null when unauthenticated", async () => {
    createClient.mockResolvedValue(makeClient({ claims: null }) as never);

    expect(await getAppUserId()).toBeNull();
  });
});
