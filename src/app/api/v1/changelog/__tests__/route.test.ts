import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import type { ChangelogEntry } from "@/lib/changelog";

const { mockLoadChangelog } = vi.hoisted(() => ({
  mockLoadChangelog: vi.fn(),
}));
vi.mock("@/services/github/releases", () => ({
  loadChangelog: mockLoadChangelog,
}));

import { GET } from "../route";

const ENTRIES: ChangelogEntry[] = [
  { version: "v0.12.0-alpha", date: "2026-11-20", new: ["Unreleased here."] },
  { version: "v0.11.0-alpha", date: "2026-11-19", new: ["A changelog."] },
  { version: "v0.10.0-alpha", date: "2026-11-18", improved: ["Faster."] },
  { version: "v0.9.6-alpha", date: "2026-11-15", fixed: ["A bug."] },
];

function get(query: string) {
  return GET(new NextRequest(`http://localhost/api/v1/changelog${query}`));
}

describe("GET /api/v1/changelog", () => {
  beforeEach(() => {
    vi.stubEnv("APP_VERSION", "v0.11.0-alpha");
    mockLoadChangelog.mockReset().mockResolvedValue(ENTRIES);
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("returns the releases after the given one that this build carries", async () => {
    const response = await get("?after=v0.9.6-alpha");
    expect(response.status).toBe(200);
    const { data } = await response.json();
    expect(data.entries.map((e: ChangelogEntry) => e.version)).toEqual([
      "v0.11.0-alpha",
      "v0.10.0-alpha",
    ]);
  });

  it("returns nothing when the visitor is up to date", async () => {
    const { data } = await (await get("?after=v0.11.0-alpha")).json();
    expect(data.entries).toEqual([]);
  });

  it.each(["", "?after=", "?after=dev", "?after=0.10.0"])(
    "refuses %j",
    async (query) => {
      const response = await get(query);
      expect(response.status).toBe(400);
      expect((await response.json()).error.code).toBe("VALIDATION_ERROR");
      expect(mockLoadChangelog).not.toHaveBeenCalled();
    },
  );

  it("answers 503 when the releases can't be read", async () => {
    mockLoadChangelog.mockResolvedValue(null);
    const response = await get("?after=v0.9.6-alpha");
    expect(response.status).toBe(503);
    expect((await response.json()).error.code).toBe("INTERNAL_ERROR");
  });
});
