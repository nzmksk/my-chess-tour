import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { appIdFor } from "@/test/identity";
import { runAfterCallbacks } from "@/test/after";
import { INTERNAL_ERROR_MESSAGE } from "@/lib/http/internal-error";

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

const { mockGetClaims, mockRpc, mockInfo, mockRemove } = vi.hoisted(() => ({
  mockGetClaims: vi.fn(),
  mockRpc: vi.fn(),
  mockInfo: vi.fn(),
  mockRemove: vi.fn(),
}));

vi.mock("@/services/supabase/admin", () => ({
  supabaseAdmin: {
    rpc: mockRpc,
    storage: { from: vi.fn(() => ({ info: mockInfo, remove: mockRemove })) },
  },
}));

vi.mock("@/services/supabase/server", () => ({
  createClient: vi.fn().mockResolvedValue({
    auth: { getClaims: mockGetClaims },
  }),
}));

vi.mock("next/headers", () => ({
  cookies: vi.fn().mockResolvedValue({
    getAll: vi.fn().mockReturnValue([]),
    set: vi.fn(),
  }),
}));

import { PUT } from "../route";
import { ORGANIZER_AGREEMENT_VERSION } from "@/lib/reference/legal";
import { hitWindow } from "@/services/rate-limit/window";

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const USER_ID = "aaaaaaaa-0000-0000-0000-000000000001";
const ORG_ID = "bbbbbbbb-0000-0000-0000-000000000001";
const KEPT_DOC_ID = "cccccccc-0000-0000-0000-000000000001";

// The document prefix is keyed to the RESOLVED public.users.id, not the JWT sub.
const NEW_DOC_PATH = `users/${appIdFor(USER_ID)}/org-kyb/2.pdf`;
const DROPPED_PATH = `users/${appIdFor(USER_ID)}/org-kyb/old.pdf`;

const KEEP_BODY = {
  name: "KL Chess Club",
  email: "chess@klcc.com",
  agreement_accepted: true,
  entity_type: "society",
  registration_number: "PPM-001-14-01012020",
  registered_name: "Persatuan Catur Kuala Lumpur",
  keep_bank_account: true,
  keep_document_ids: [KEPT_DOC_ID],
  new_documents: [
    {
      doc_type: "other",
      storage_path: NEW_DOC_PATH,
      original_filename: "letter.pdf",
    },
  ],
};

function makePutRequest(body: unknown = KEEP_BODY, id = ORG_ID): NextRequest {
  return new NextRequest(
    `http://localhost/api/v1/organizations/applications/${id}`,
    {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    },
  );
}

function put(body: unknown = KEEP_BODY, id = ORG_ID) {
  return PUT(makePutRequest(body, id), { params: Promise.resolve({ id }) });
}

function rpcArgs(): Record<string, unknown> {
  return mockRpc.mock.calls[0][1] as Record<string, unknown>;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("PUT /api/v1/organizations/applications/[id]", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetClaims.mockResolvedValue({
      data: { claims: { sub: USER_ID } },
      error: null,
    });
    mockInfo.mockResolvedValue({
      data: { size: 2048, contentType: "application/pdf" },
      error: null,
    });
    mockRemove.mockResolvedValue({ data: [], error: null });
    mockRpc.mockResolvedValue({
      data: {
        id: ORG_ID,
        name: "KL Chess Club",
        approval_status: "pending",
        removed_storage_paths: [DROPPED_PATH],
      },
      error: null,
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("returns 401 without a session", async () => {
    mockGetClaims.mockResolvedValue({ data: { claims: null }, error: null });
    const res = await put();
    expect(res.status).toBe(401);
    expect(mockRpc).not.toHaveBeenCalled();
  });

  it("returns 404 for a malformed id without calling the RPC", async () => {
    const res = await put(KEEP_BODY, "not-a-uuid");
    expect(res.status).toBe(404);
    expect(mockRpc).not.toHaveBeenCalled();
  });

  it("returns 429 once the user is over the application limit", async () => {
    vi.mocked(hitWindow).mockResolvedValueOnce(43200);
    const res = await put();
    expect(res.status).toBe(429);
    expect(mockRpc).not.toHaveBeenCalled();
  });

  it("resubmits as the caller, keeping the account, with the server's agreement version", async () => {
    const res = await put();

    expect(res.status).toBe(200);
    expect(mockRpc).toHaveBeenCalledWith(
      "resubmit_organization_application",
      expect.any(Object),
    );
    const args = rpcArgs();
    expect(args.p_org_id).toBe(ORG_ID);
    expect(args.p_user_id).toBe(appIdFor(USER_ID));
    expect(args.p_agreement_version).toBe(ORGANIZER_AGREEMENT_VERSION);
    expect(args.p_keep_bank_account).toBe(true);
    expect(args.p_account_number).toBeNull();
    expect(args.p_keep_document_ids).toEqual([KEPT_DOC_ID]);
    expect(args.p_new_documents).toEqual(KEEP_BODY.new_documents);
    expect(args.p_registered_name).toBe("Persatuan Catur Kuala Lumpur");
  });

  it("sends a replacement account, normalised, with the bank name derived from the code", async () => {
    const res = await put({
      ...KEEP_BODY,
      keep_bank_account: false,
      bank_code: "MBBEMYKL",
      bank_account_holder: " KL Chess Club ",
      bank_account_number: "5140 1234-5678",
    });

    expect(res.status).toBe(200);
    const args = rpcArgs();
    expect(args.p_keep_bank_account).toBe(false);
    expect(args.p_bank_code).toBe("MBBEMYKL");
    expect(args.p_bank_name).toBeTruthy();
    expect(args.p_account_holder).toBe("KL Chess Club");
    expect(args.p_account_number).toBe("514012345678");
  });

  it("requires bank details when the account is not kept", async () => {
    const res = await put({ ...KEEP_BODY, keep_bank_account: false });
    expect(res.status).toBe(400);
    expect(mockRpc).not.toHaveBeenCalled();
  });

  it("requires the Organizer Agreement to be accepted again", async () => {
    const res = await put({ ...KEEP_BODY, agreement_accepted: false });
    expect(res.status).toBe(400);
    expect(mockRpc).not.toHaveBeenCalled();
  });

  it("refuses a new document outside the caller's own folder", async () => {
    const res = await put({
      ...KEEP_BODY,
      new_documents: [
        { doc_type: "other", storage_path: "users/someone-else/org-kyb/x.pdf" },
      ],
    });
    expect(res.status).toBe(400);
    expect(mockRpc).not.toHaveBeenCalled();
  });

  it("refuses an application with no documents left", async () => {
    const res = await put({
      ...KEEP_BODY,
      keep_document_ids: [],
      new_documents: [],
    });
    expect(res.status).toBe(400);
    expect(mockRpc).not.toHaveBeenCalled();
  });

  it("refuses kept document ids that aren't ids", async () => {
    const res = await put({ ...KEEP_BODY, keep_document_ids: ["../x"] });
    expect(res.status).toBe(400);
    expect(mockRpc).not.toHaveBeenCalled();
  });

  it("checks new uploads exist before resubmitting", async () => {
    mockInfo.mockResolvedValue({ data: null, error: { message: "not found" } });
    const res = await put();
    expect(res.status).toBe(400);
    expect(mockRpc).not.toHaveBeenCalled();
  });

  it("deletes the dropped documents' files after the response, and never returns their paths", async () => {
    const res = await put();
    const json = await res.json();

    expect(json.data.removed_storage_paths).toBeUndefined();
    expect(mockRemove).not.toHaveBeenCalled();

    await runAfterCallbacks();
    expect(mockRemove).toHaveBeenCalledWith([DROPPED_PATH]);
  });

  it("still succeeds when deleting the dropped files fails", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    mockRemove.mockResolvedValue({ data: null, error: { message: "boom" } });

    const res = await put();
    await runAfterCallbacks();

    expect(res.status).toBe(200);
    expect(console.error).toHaveBeenCalled();
  });

  it.each([
    ["APPLICATION_NOT_FOUND: no such application", "P0002", 404, "NOT_FOUND"],
    [
      "APPLICATION_NOT_REJECTED: only a rejected application can be amended",
      "P0001",
      409,
      "APPLICATION_NOT_REJECTED",
    ],
    [
      "NAME_TAKEN: an approved organization already uses this name",
      "P0001",
      409,
      "NAME_TAKEN",
    ],
    [
      "BANK_ACCOUNT_IN_USE: this bank account is already...",
      "P0001",
      409,
      "BANK_ACCOUNT_IN_USE",
    ],
    [
      "BANK_ACCOUNT_REQUIRED: this application has no bank account to keep",
      "P0001",
      400,
      "VALIDATION_ERROR",
    ],
    [
      "ENTITY_DOCS_REQUIRED: a society must supply an ROS document",
      "P0001",
      400,
      "VALIDATION_ERROR",
    ],
  ])("maps %s to %i", async (message, code, status, errorCode) => {
    mockRpc.mockResolvedValue({ data: null, error: { message, code } });
    const res = await put();
    expect(res.status).toBe(status);
    const json = await res.json();
    expect(json.error.code).toBe(errorCode);
    expect(mockRemove).not.toHaveBeenCalled();
  });

  it("returns 500 for an unexpected RPC error", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    mockRpc.mockResolvedValue({
      data: null,
      error: { message: "connection reset", code: "08006" },
    });
    const res = await put();
    expect(res.status).toBe(500);
    const json = await res.json();
    expect(json.error.message).toBe(INTERNAL_ERROR_MESSAGE);
  });
});
