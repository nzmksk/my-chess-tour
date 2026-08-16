import { beforeEach, describe, expect, it, vi } from "vitest";
import { appIdFor } from "@/test/identity";
import { NextRequest } from "next/server";

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

const { mockFrom, mockGetClaims, mockPermissionRpc, mockRemove, builder } =
  vi.hoisted(() => {
    const builder: Record<string, unknown> = {};
    for (const m of ["select", "eq", "is", "update"]) {
      builder[m] = vi.fn(() => builder);
    }
    builder.single = vi.fn();

    return {
      builder,
      mockFrom: vi.fn(() => builder),
      mockGetClaims: vi.fn(),
      mockPermissionRpc: vi.fn(),
      mockRemove: vi.fn(),
    };
  });

vi.mock("@/services/supabase/admin", () => ({
  supabaseAdmin: {
    from: mockFrom,
    storage: { from: vi.fn(() => ({ remove: mockRemove })) },
  },
}));

vi.mock("@/services/supabase/server", () => ({
  createClient: vi.fn().mockResolvedValue({
    auth: { getClaims: mockGetClaims },
    rpc: mockPermissionRpc,
  }),
}));

vi.mock("next/headers", () => ({
  cookies: vi.fn().mockResolvedValue({
    getAll: vi.fn().mockReturnValue([]),
    set: vi.fn(),
  }),
}));

import { PATCH } from "../route";

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const USER_ID = "aaaaaaaa-0000-0000-0000-000000000001";
const ORG_ID = "bbbbbbbb-0000-0000-0000-000000000001";
const AVATAR_BASE = `${process.env.NEXT_PUBLIC_SUPABASE_URL}/storage/v1/object/public/avatars`;

const params = (orgId = ORG_ID) => ({ params: Promise.resolve({ orgId }) });

function makePatch(body: unknown, orgId = ORG_ID) {
  return new NextRequest(`http://localhost/api/v1/organizations/${orgId}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

const single = () => builder.single as ReturnType<typeof vi.fn>;

/**
 * The route reads the org first, then updates it — both terminate in .single().
 * `existing` answers the read; `updated` answers the write.
 */
function setQueries(
  existing: { data: unknown; error?: unknown },
  updated: { data: unknown; error?: unknown } = { data: { id: ORG_ID } },
) {
  let call = 0;
  single().mockImplementation(() =>
    Promise.resolve(
      call++ === 0
        ? { data: existing.data, error: existing.error ?? null }
        : { data: updated.data, error: updated.error ?? null },
    ),
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  mockGetClaims.mockResolvedValue({
    data: { claims: { sub: USER_ID } },
    error: null,
  });
  mockPermissionRpc.mockResolvedValue({ data: true, error: null });
  mockRemove.mockResolvedValue({ error: null });
  setQueries({ data: { id: ORG_ID, avatar_url: null } });
});

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("PATCH /api/v1/organizations/[orgId]", () => {
  describe("authorization", () => {
    it("400 for a non-UUID orgId", async () => {
      const res = await PATCH(
        makePatch({ name: "X" }, "nope"),
        params("nope"),
      );
      expect(res.status).toBe(400);
    });

    it("401 when unauthenticated", async () => {
      mockGetClaims.mockResolvedValue({ data: { claims: null }, error: null });
      const res = await PATCH(makePatch({ name: "X" }), params());
      expect(res.status).toBe(401);
    });

    it("404 when the organization does not exist", async () => {
      setQueries({ data: null, error: { code: "PGRST116" } });
      const res = await PATCH(makePatch({ name: "X" }), params());
      expect(res.status).toBe(404);
    });

    it("403 without org.manage", async () => {
      mockPermissionRpc.mockResolvedValue({ data: false, error: null });
      const res = await PATCH(makePatch({ name: "X" }), params());
      expect(res.status).toBe(403);
      expect(builder.update).not.toHaveBeenCalled();
    });

    it("checks org.manage for this organization", async () => {
      await PATCH(makePatch({ name: "X" }), params());
      expect(mockPermissionRpc).toHaveBeenCalledWith("has_org_permission", {
        p_user_id: appIdFor(USER_ID),
        p_org_id: ORG_ID,
        p_permission: "org.manage",
      });
    });
  });

  describe("validation", () => {
    it("400 when no recognised field is supplied", async () => {
      const res = await PATCH(makePatch({ nonsense: true }), params());
      expect(res.status).toBe(400);
    });

    it("400 for an empty name", async () => {
      const res = await PATCH(makePatch({ name: "   " }), params());
      expect(res.status).toBe(400);
    });

    it("400 for an invalid email", async () => {
      const res = await PATCH(makePatch({ email: "nope" }), params());
      expect(res.status).toBe(400);
    });

    it("400 for links that aren't an array", async () => {
      const res = await PATCH(makePatch({ links: "https://x" }), params());
      expect(res.status).toBe(400);
    });

    // Changing these after approval would silently invalidate the admin's KYB
    // decision, so the shape simply has no room for them.
    it.each([
      ["entity_type", "individual"],
      ["registration_number", "PPM-999"],
      ["approval_status", "approved"],
      ["agreement_version", "1999-01-01"],
    ])("never writes %s", async (field, value) => {
      await PATCH(makePatch({ name: "X", [field]: value }), params());
      const written = (builder.update as ReturnType<typeof vi.fn>).mock
        .calls[0][0];
      expect(written).not.toHaveProperty(field);
    });
  });

  describe("avatar", () => {
    it("400 for a URL outside this organization's avatar folder", async () => {
      const res = await PATCH(
        makePatch({ avatar_url: "https://evil.example/logo.png" }),
        params(),
      );
      expect(res.status).toBe(400);
    });

    it("400 for a URL in ANOTHER organization's avatar folder", async () => {
      const res = await PATCH(
        makePatch({
          avatar_url: `${AVATAR_BASE}/organizations/cccccccc-0000-0000-0000-000000000009/logo.png`,
        }),
        params(),
      );
      expect(res.status).toBe(400);
    });

    it("accepts a URL in this organization's folder", async () => {
      const url = `${AVATAR_BASE}/organizations/${ORG_ID}/logo.png`;
      const res = await PATCH(makePatch({ avatar_url: url }), params());
      expect(res.status).toBe(200);
      const written = (builder.update as ReturnType<typeof vi.fn>).mock
        .calls[0][0];
      expect(written.avatar_url).toBe(url);
    });

    it("deletes the replaced object, best-effort", async () => {
      setQueries({
        data: {
          id: ORG_ID,
          avatar_url: `${AVATAR_BASE}/organizations/${ORG_ID}/old.png`,
        },
      });
      await PATCH(
        makePatch({
          avatar_url: `${AVATAR_BASE}/organizations/${ORG_ID}/new.png`,
        }),
        params(),
      );
      expect(mockRemove).toHaveBeenCalledWith([
        `organizations/${ORG_ID}/old.png`,
      ]);
    });

    it("leaves the old object alone when the avatar is untouched", async () => {
      setQueries({
        data: {
          id: ORG_ID,
          avatar_url: `${AVATAR_BASE}/organizations/${ORG_ID}/old.png`,
        },
      });
      await PATCH(makePatch({ name: "Renamed" }), params());
      expect(mockRemove).not.toHaveBeenCalled();
    });
  });

  describe("update", () => {
    it("200 with the updated organization", async () => {
      setQueries(
        { data: { id: ORG_ID, avatar_url: null } },
        { data: { id: ORG_ID, name: "Renamed" } },
      );
      const res = await PATCH(makePatch({ name: "Renamed" }), params());
      expect(res.status).toBe(200);
      expect((await res.json()).data.name).toBe("Renamed");
    });

    it("409 when the new name is already taken", async () => {
      setQueries(
        { data: { id: ORG_ID, avatar_url: null } },
        { data: null, error: { code: "23505", message: "duplicate key" } },
      );
      const res = await PATCH(makePatch({ name: "Taken" }), params());
      expect(res.status).toBe(409);
      expect((await res.json()).error.code).toBe("NAME_TAKEN");
    });

    it("500 on an unexpected update error", async () => {
      setQueries(
        { data: { id: ORG_ID, avatar_url: null } },
        { data: null, error: { code: "XX000", message: "boom" } },
      );
      const res = await PATCH(makePatch({ name: "X" }), params());
      expect(res.status).toBe(500);
    });
  });
});
