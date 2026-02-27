import { beforeEach, describe, expect, it, vi } from "vitest";
import { getIssueProgress } from "../github";

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
  beforeEach(() => vi.clearAllMocks());

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
