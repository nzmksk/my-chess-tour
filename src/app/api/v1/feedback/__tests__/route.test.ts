import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { appIdFor } from "@/test/identity";
import { INTERNAL_ERROR_MESSAGE } from "@/lib/http/internal-error";

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

const {
  mockGetClaims,
  mockInsert,
  mockInsertSingle,
  mockUpdate,
  mockUpdateEq,
  mockFrom,
  mockHitWindow,
  mockCreateBugReportIssue,
} = vi.hoisted(() => {
  const mockInsertSingle = vi.fn();
  const mockInsert = vi.fn(() => ({
    select: vi.fn(() => ({ single: mockInsertSingle })),
  }));
  const mockUpdateEq = vi.fn();
  const mockUpdate = vi.fn(() => ({ eq: mockUpdateEq }));
  const mockFrom = vi.fn(() => ({ insert: mockInsert, update: mockUpdate }));
  return {
    mockGetClaims: vi.fn(),
    mockInsert,
    mockInsertSingle,
    mockUpdate,
    mockUpdateEq,
    mockFrom,
    mockHitWindow: vi.fn(),
    mockCreateBugReportIssue: vi.fn(),
  };
});

vi.mock("@/services/supabase/server", () => ({
  createClient: vi.fn().mockResolvedValue({
    auth: { getClaims: mockGetClaims },
  }),
}));

vi.mock("@/services/supabase/admin", () => ({
  supabaseAdmin: { from: mockFrom },
}));

vi.mock("@/services/rate-limit/window", () => ({
  hitWindow: mockHitWindow,
}));

vi.mock("@/services/bug-reports/github", () => ({
  createBugReportIssue: mockCreateBugReportIssue,
}));

import { POST } from "../route";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const AUTH_USER_ID = "auth-user-1";
const REPORT_ID = "1a2b3c4d-0000-4000-8000-000000000000";
const REFERENCE = "BR-1A2B3C4D";

function makeRequest(body: unknown, raw = false): NextRequest {
  return new NextRequest("http://localhost/api/v1/feedback", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "user-agent": "Mozilla/5.0 (Test)",
      "x-forwarded-for": "203.0.113.7",
    },
    body: raw ? (body as string) : JSON.stringify(body),
  });
}

const validBody = {
  description: "The register button does nothing\nI clicked it twice",
  details: "Open a tournament, click Register",
  path: "https://mychesstour.com/tournaments/kl-open-2026?ref=abc#top",
  viewport: { width: 390, height: 844 },
  sentryEventId: "0123456789abcdef0123456789abcdef",
};

function signedIn() {
  mockGetClaims.mockResolvedValue({
    data: { claims: { sub: AUTH_USER_ID, email: "player@example.com" } },
  });
}

function signedOut() {
  mockGetClaims.mockResolvedValue({ data: { claims: null } });
}

// The rate-limit buckets the report was counted against.
function keysHit(): string[] {
  return mockHitWindow.mock.calls.map(([key]) => key as string);
}

// The issue title and body handed to GitHub.
function filedIssue(): { title: string; body: string } {
  const [title, body] = mockCreateBugReportIssue.mock.calls[0];
  return { title, body };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("POST /api/v1/feedback", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    signedIn();
    mockHitWindow.mockResolvedValue(0);
    mockInsertSingle.mockResolvedValue({
      data: { id: REPORT_ID, created_at: "2026-11-18T10:00:00+00:00" },
      error: null,
    });
    mockUpdateEq.mockResolvedValue({ error: null });
    mockCreateBugReportIssue.mockResolvedValue(321);
  });

  describe("filing", () => {
    it("saves the report, files the issue, links them and returns the reference", async () => {
      const res = await POST(makeRequest(validBody));

      expect(res.status).toBe(201);
      expect(await res.json()).toEqual({ reference: REFERENCE });

      expect(mockFrom).toHaveBeenCalledWith("bug_reports");
      expect(mockInsert).toHaveBeenCalledWith({
        user_id: appIdFor(AUTH_USER_ID),
        description: "The register button does nothing\nI clicked it twice",
        details: "Open a tournament, click Register",
        context: {
          path: "/tournaments/kl-open-2026",
          user_agent: "Mozilla/5.0 (Test)",
          viewport: "390x844",
          app_version: expect.any(String),
          environment: expect.any(String),
          sentry_event_id: "0123456789abcdef0123456789abcdef",
        },
      });
      expect(mockUpdate).toHaveBeenCalledWith({
        github_issue_number: 321,
        filed_at: expect.any(String),
        filing_error: null,
      });
      expect(mockUpdateEq).toHaveBeenCalledWith("id", REPORT_ID);
    });

    it("saves the report before calling GitHub", async () => {
      await POST(makeRequest(validBody));
      expect(mockInsertSingle.mock.invocationCallOrder[0]).toBeLessThan(
        mockCreateBugReportIssue.mock.invocationCallOrder[0],
      );
    });

    it("titles the issue from the first line and puts the context table in the body", async () => {
      await POST(makeRequest(validBody));
      const { title, body } = filedIssue();
      expect(title).toBe("[User report] The register button does nothing");
      expect(body).toContain("| Reference | `BR-1A2B3C4D` |");
      expect(body).toContain("| Page | `/tournaments/kl-open-2026` |");
      expect(body).toContain("| Browser | `Mozilla/5.0 (Test)` |");
      expect(body).toContain("| Viewport | `390x844` |");
      expect(body).toContain("| Signed in | `yes` |");
      expect(body).toContain(
        "| Sentry event | `0123456789abcdef0123456789abcdef` |",
      );
      expect(body).toContain("| Reported at | `2026-11-18T10:00:00.000Z` |");
    });

    it("keeps the reporter's identity and IP out of the issue", async () => {
      await POST(makeRequest(validBody));
      const { title, body } = filedIssue();
      for (const text of [title, body]) {
        expect(text).not.toContain("player@example.com");
        expect(text).not.toContain(AUTH_USER_ID);
        expect(text).not.toContain(appIdFor(AUTH_USER_ID));
        expect(text).not.toContain("203.0.113.7");
        expect(text).not.toContain("ref=abc");
      }
    });

    it("accepts a signed-out report and rate limits it by IP alone", async () => {
      signedOut();
      const res = await POST(makeRequest(validBody));

      expect(res.status).toBe(201);
      expect(keysHit()).toEqual([
        "ratelimit:feedback:ip:203.0.113.7",
        "ratelimit:feedback:signed-out-ip:203.0.113.7",
      ]);
      expect(mockHitWindow).toHaveBeenCalledWith(
        "ratelimit:feedback:signed-out-ip:203.0.113.7",
        3,
        3600,
      );
      expect(mockInsert).toHaveBeenCalledWith(
        expect.objectContaining({ user_id: null }),
      );
      expect(filedIssue().body).toContain("| Signed in | `no` |");
    });

    it("rate limits a signed-in report by IP and account", async () => {
      await POST(makeRequest(validBody));
      expect(keysHit()).toEqual([
        `ratelimit:feedback:user:${appIdFor(AUTH_USER_ID)}`,
        "ratelimit:feedback:ip:203.0.113.7",
      ]);
      expect(mockHitWindow).toHaveBeenCalledWith(
        `ratelimit:feedback:user:${appIdFor(AUTH_USER_ID)}`,
        5,
        3600,
      );
      expect(mockHitWindow).toHaveBeenCalledWith(
        "ratelimit:feedback:ip:203.0.113.7",
        10,
        3600,
      );
    });

    it("masks an invitation token in the saved and published path", async () => {
      const token = "Ab3_kL9-zzQwErTyUiOpAsDfGhJkLzXcVbNm1234567";
      await POST(makeRequest({ ...validBody, path: `/invitations/${token}` }));

      expect(mockInsert).toHaveBeenCalledWith(
        expect.objectContaining({
          context: expect.objectContaining({ path: "/invitations/[token]" }),
        }),
      );
      expect(filedIssue().body).not.toContain(token);
    });

    it("drops malformed context instead of refusing the report", async () => {
      const res = await POST(
        makeRequest({
          description: "Broken",
          path: 42,
          viewport: { width: "wide", height: -1 },
          sentryEventId: "not-an-id",
        }),
      );

      expect(res.status).toBe(201);
      expect(mockInsert).toHaveBeenCalledWith(
        expect.objectContaining({
          details: null,
          context: expect.objectContaining({
            path: null,
            viewport: null,
            sentry_event_id: null,
          }),
        }),
      );
    });

    it("still reports success when linking the row to the issue fails", async () => {
      mockUpdateEq.mockResolvedValue({ error: { message: "db down" } });
      const res = await POST(makeRequest(validBody));
      expect(res.status).toBe(201);
      expect(await res.json()).toEqual({ reference: REFERENCE });
    });
  });

  describe("validation", () => {
    it("rejects invalid JSON", async () => {
      const res = await POST(makeRequest("{not json", true));
      expect(res.status).toBe(400);
      expect(mockInsert).not.toHaveBeenCalled();
    });

    it("rejects a missing or blank description", async () => {
      for (const description of [undefined, "", "   \n​ "]) {
        const res = await POST(makeRequest({ description }));
        expect(res.status).toBe(400);
        expect((await res.json()).error.code).toBe("VALIDATION_ERROR");
      }
      expect(mockInsert).not.toHaveBeenCalled();
    });

    it("rejects an over-long description or steps", async () => {
      expect(
        (await POST(makeRequest({ description: "x".repeat(4001) }))).status,
      ).toBe(400);
      expect(
        (
          await POST(
            makeRequest({ description: "ok", details: "x".repeat(4001) }),
          )
        ).status,
      ).toBe(400);
      expect(mockInsert).not.toHaveBeenCalled();
    });

    it("rejects non-string steps", async () => {
      const res = await POST(makeRequest({ description: "ok", details: 5 }));
      expect(res.status).toBe(400);
    });
  });

  describe("rate limiting", () => {
    it("returns 429 with Retry-After and saves nothing", async () => {
      mockHitWindow.mockResolvedValue(1200);
      const res = await POST(makeRequest(validBody));

      expect(res.status).toBe(429);
      expect(res.headers.get("Retry-After")).toBe("1200");
      expect((await res.json()).error.code).toBe("RATE_LIMITED");
      expect(mockInsert).not.toHaveBeenCalled();
      expect(mockCreateBugReportIssue).not.toHaveBeenCalled();
    });

    it("fails closed when the limiter is unreachable", async () => {
      mockHitWindow.mockRejectedValue(new Error("redis down"));
      const res = await POST(makeRequest(validBody));

      expect(res.status).toBe(500);
      expect((await res.json()).error.message).toBe(INTERNAL_ERROR_MESSAGE);
      expect(mockCreateBugReportIssue).not.toHaveBeenCalled();
    });
  });

  describe("honeypot", () => {
    it("pretends to succeed and files nothing when the hidden field is filled", async () => {
      const res = await POST(
        makeRequest({ ...validBody, website: "http://spam.example" }),
      );

      expect(res.status).toBe(201);
      expect((await res.json()).reference).toMatch(/^BR-[0-9A-F]{8}$/);
      expect(mockInsert).not.toHaveBeenCalled();
      expect(mockCreateBugReportIssue).not.toHaveBeenCalled();
    });
  });

  describe("failures", () => {
    it("returns a generic 500 and files nothing when the report can't be saved", async () => {
      mockInsertSingle.mockResolvedValue({
        data: null,
        error: {
          code: "42P01",
          message: 'relation "bug_reports" does not exist',
        },
      });
      const res = await POST(makeRequest(validBody));

      expect(res.status).toBe(500);
      const json = await res.json();
      expect(json.error.message).toBe(INTERNAL_ERROR_MESSAGE);
      expect(JSON.stringify(json)).not.toContain("bug_reports");
      expect(mockCreateBugReportIssue).not.toHaveBeenCalled();
    });

    it("keeps the report, records the failure and tells the user it was saved when GitHub fails", async () => {
      const consoleError = vi
        .spyOn(console, "error")
        .mockImplementation(() => {});
      mockCreateBugReportIssue.mockRejectedValue(new Error("Bad credentials"));

      const res = await POST(makeRequest(validBody));

      expect(res.status).toBe(502);
      const json = await res.json();
      expect(json.reference).toBe(REFERENCE);
      expect(json.error.code).toBe("FILING_FAILED");
      expect(json.error.message).not.toContain("Bad credentials");
      expect(mockUpdate).toHaveBeenCalledWith({
        filing_error: "Bad credentials",
      });
      expect(mockUpdateEq).toHaveBeenCalledWith("id", REPORT_ID);
      // console.error is what Sentry captures (captureConsoleIntegration).
      expect(consoleError).toHaveBeenCalledWith(
        expect.stringContaining(REFERENCE),
        expect.any(Error),
      );
      consoleError.mockRestore();
    });
  });
});
