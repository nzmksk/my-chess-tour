import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { _clearCacheForTesting, getIssueProgress } from "../github";

const mockSearch = vi.fn();

// Must use a regular function (not an arrow function) so it can be called with `new`
vi.mock("@octokit/rest", () => ({
  Octokit: vi.fn(function () {
    return { rest: { search: { issuesAndPullRequests: mockSearch } } };
  }),
}));

function mockCounts(closed: number, total: number) {
  mockSearch
    .mockResolvedValueOnce({ data: { total_count: closed } })
    .mockResolvedValueOnce({ data: { total_count: total } });
}

describe("getIssueProgress", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    _clearCacheForTesting();
  });

  it("returns the correct percentage", async () => {
    mockCounts(3, 10);
    expect(await getIssueProgress()).toBe(30);
  });

  it("returns 100 when all issues are closed", async () => {
    mockCounts(10, 10);
    expect(await getIssueProgress()).toBe(100);
  });

  it("returns 0 when no issues exist (division-by-zero guard)", async () => {
    mockCounts(0, 0);
    expect(await getIssueProgress()).toBe(0);
  });

  it("rounds to the nearest integer", async () => {
    mockCounts(1, 3); // 33.33...%
    expect(await getIssueProgress()).toBe(33);
  });

  it("queries closed issues with state:closed filter", async () => {
    mockCounts(0, 0);
    await getIssueProgress();

    const [firstCall] = mockSearch.mock.calls;
    expect(firstCall[0].q).toContain("state:closed");
  });

  it("filters type:issue in both queries to exclude pull requests", async () => {
    mockCounts(0, 0);
    await getIssueProgress();

    for (const [args] of mockSearch.mock.calls) {
      expect(args.q).toContain("type:issue");
    }
  });

  it("scopes both queries to the correct repository", async () => {
    mockCounts(0, 0);
    await getIssueProgress();

    for (const [args] of mockSearch.mock.calls) {
      expect(args.q).toContain("repo:nzmksk/my-chess-tour");
    }
  });
});

describe("error handling", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    _clearCacheForTesting();
  });

  it("returns 0 when the GitHub API throws", async () => {
    mockSearch.mockRejectedValue(new Error("rate limited"));
    expect(await getIssueProgress()).toBe(0);
  });

  it("returns 0 when only one of the two requests fails", async () => {
    mockSearch
      .mockResolvedValueOnce({ data: { total_count: 5 } })
      .mockRejectedValueOnce(new Error("timeout"));
    expect(await getIssueProgress()).toBe(0);
  });
});

describe("in-memory cache", () => {
  beforeEach(() => {
    vi.resetModules(); // fresh module instance → cache = null for every test
    vi.clearAllMocks();
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  async function freshGetIssueProgress() {
    // vi.resetModules() was called in beforeEach; dynamic import yields a fresh
    // module with an empty cache. The top-level vi.mock() factory for
    // @octokit/rest persists across resetModules and applies to the fresh import.
    const { getIssueProgress: fn } = await import("../github");
    return fn;
  }

  it("returns the cached value on a second call without re-fetching", async () => {
    const fn = await freshGetIssueProgress();
    mockSearch.mockResolvedValue({ data: { total_count: 10 } });

    await fn(); // first call — populates cache
    await fn(); // second call — should hit cache

    // First call fires exactly 2 API requests (closed + all); second call fires 0
    expect(mockSearch).toHaveBeenCalledTimes(2);
  });

  it("re-fetches after the 6-hour TTL has elapsed", async () => {
    const fn = await freshGetIssueProgress();
    mockSearch.mockResolvedValue({ data: { total_count: 10 } });

    await fn(); // populates cache
    vi.advanceTimersByTime(6 * 60 * 60 * 1000 + 1); // 6 h + 1 ms
    mockSearch.mockResolvedValue({ data: { total_count: 15 } });
    await fn(); // cache expired — should re-fetch

    // 2 calls per fetch × 2 fetches = 4
    expect(mockSearch).toHaveBeenCalledTimes(4);
  });

  it("does not re-fetch when called just before the TTL expires", async () => {
    const fn = await freshGetIssueProgress();
    mockSearch.mockResolvedValue({ data: { total_count: 10 } });

    await fn(); // populates cache
    vi.advanceTimersByTime(6 * 60 * 60 * 1000 - 1); // 1 ms before TTL
    await fn(); // still within TTL — should use cache

    expect(mockSearch).toHaveBeenCalledTimes(2);
  });
});
