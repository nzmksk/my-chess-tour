import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  getCurrentUser,
  hasOrgPermission,
  hasGlobalPermission,
  requireOrgPermission,
  requireGlobalPermission,
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

function makeClient({
  authUser = null as unknown,
  rpcResult = null as unknown,
} = {}) {
  return {
    rpc: vi.fn().mockResolvedValue({ data: rpcResult }),
    auth: {
      getUser: vi.fn().mockResolvedValue({ data: { user: authUser } }),
    },
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
      requireOrgPermission("u1", "org1", "tournament.create")
    ).resolves.toBeUndefined();
  });

  it("throws when user lacks the permission", async () => {
    createClient.mockResolvedValue(makeClient({ rpcResult: false }) as never);
    await expect(
      requireOrgPermission("u1", "org1", "tournament.create")
    ).rejects.toThrow("Insufficient permissions");
  });
});

describe("requireGlobalPermission", () => {
  beforeEach(() => vi.clearAllMocks());

  it("does not throw when user has the permission", async () => {
    createClient.mockResolvedValue(makeClient({ rpcResult: true }) as never);
    await expect(
      requireGlobalPermission("u1", "platform.manage")
    ).resolves.toBeUndefined();
  });

  it("throws when user lacks the permission", async () => {
    createClient.mockResolvedValue(makeClient({ rpcResult: false }) as never);
    await expect(
      requireGlobalPermission("u1", "platform.manage")
    ).rejects.toThrow("Insufficient permissions");
  });
});
