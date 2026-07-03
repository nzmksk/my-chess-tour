import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const { mockRange, mockFrom, mockSyncFidePlayer } = vi.hoisted(() => {
  const mockRange = vi.fn();
  const order = vi.fn(() => ({ range: mockRange }));
  const not = vi.fn(() => ({ order }));
  const select = vi.fn(() => ({ not }));
  const mockFrom = vi.fn(() => ({ select }));
  return { mockRange, mockFrom, mockSyncFidePlayer: vi.fn() };
});

vi.mock("@/services/supabase/admin", () => ({
  supabaseAdmin: { from: mockFrom },
}));
vi.mock("@/services/fide/fide", () => ({
  syncFidePlayer: mockSyncFidePlayer,
}));

import { POST } from "../route";

const SECRET = "test-cron-secret";

function makeReq(auth?: string) {
  return new NextRequest("http://localhost/api/v1/cron/fide-ratings", {
    method: "POST",
    headers: auth ? { Authorization: auth } : {},
  });
}

describe("POST /api/v1/cron/fide-ratings", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubEnv("CRON_SECRET", SECRET);
    mockSyncFidePlayer.mockResolvedValue("updated");
  });
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });

  it("401s without the bearer secret", async () => {
    const res = await POST(makeReq());
    expect(res.status).toBe(401);
    expect(mockFrom).not.toHaveBeenCalled();
  });

  it("401s with a wrong secret", async () => {
    const res = await POST(makeReq("Bearer nope"));
    expect(res.status).toBe(401);
    expect(mockSyncFidePlayer).not.toHaveBeenCalled();
  });

  it("500s when CRON_SECRET is not configured", async () => {
    vi.stubEnv("CRON_SECRET", "");
    const res = await POST(makeReq("Bearer whatever"));
    expect(res.status).toBe(500);
  });

  it("syncs every player with a FIDE ID and returns a summary", async () => {
    mockRange.mockResolvedValue({
      data: [
        {
          user_id: "u1",
          fide_id: 1503014,
          users: { first_name: "Magnus", last_name: "Carlsen" },
        },
        {
          user_id: "u2",
          fide_id: 2016192,
          users: [{ first_name: "Hikaru", last_name: "Nakamura" }],
        },
      ],
      error: null,
    });

    const res = await POST(makeReq(`Bearer ${SECRET}`));
    expect(res.status).toBe(200);
    expect(mockSyncFidePlayer).toHaveBeenCalledTimes(2);
    expect(mockSyncFidePlayer).toHaveBeenCalledWith(
      "u1",
      1503014,
      "Magnus",
      "Carlsen",
      expect.any(String),
    );
    // Handles the array-shaped embedded relation too.
    expect(mockSyncFidePlayer).toHaveBeenCalledWith(
      "u2",
      2016192,
      "Hikaru",
      "Nakamura",
      expect.any(String),
    );
    const body = await res.json();
    expect(body.data).toEqual({
      processed: 2,
      updated: 2,
      not_found: 0,
      failed: 0,
    });
  });

  it("counts not_found and failed results without aborting the run", async () => {
    mockRange.mockResolvedValue({
      data: [
        { user_id: "a", fide_id: 1, users: { first_name: "A", last_name: "A" } },
        { user_id: "b", fide_id: 2, users: { first_name: "B", last_name: "B" } },
        { user_id: "c", fide_id: 3, users: { first_name: "C", last_name: "C" } },
      ],
      error: null,
    });
    mockSyncFidePlayer
      .mockResolvedValueOnce("updated")
      .mockResolvedValueOnce("not_found")
      .mockResolvedValueOnce("failed");

    const res = await POST(makeReq(`Bearer ${SECRET}`));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.data).toEqual({
      processed: 3,
      updated: 1,
      not_found: 1,
      failed: 1,
    });
  });

  it("returns 500 when the player query errors", async () => {
    mockRange.mockResolvedValue({ data: null, error: { message: "db down" } });
    const res = await POST(makeReq(`Bearer ${SECRET}`));
    expect(res.status).toBe(500);
  });
});
