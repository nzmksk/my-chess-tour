import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { mockPaginate, mockOctokit, mockUnstableCache } = vi.hoisted(() => {
  const mockPaginate = vi.fn();
  const mockOctokit = vi.fn(function (this: Record<string, unknown>) {
    this.paginate = mockPaginate;
    this.rest = { repos: { listReleases: "listReleases" } };
  });
  // Pass the function through, recording how it was cached.
  const mockUnstableCache = vi.fn((fn: unknown) => fn);
  return { mockPaginate, mockOctokit, mockUnstableCache };
});

vi.mock("@octokit/rest", () => ({ Octokit: mockOctokit }));
vi.mock("next/cache", () => ({ unstable_cache: mockUnstableCache }));

import { GITHUB_RELEASES_TAG, getChangelog, loadChangelog } from "../releases";

function release(tag: string, publishedAt: string | null, body = "") {
  return {
    tag_name: tag,
    draft: publishedAt === null,
    published_at: publishedAt,
    body,
  };
}

describe("getChangelog", () => {
  beforeEach(() => {
    mockPaginate.mockReset();
    mockOctokit.mockClear();
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("is cached with no time limit under the releases tag", () => {
    expect(mockUnstableCache).toHaveBeenCalledWith(
      expect.any(Function),
      ["github-releases"],
      { tags: [GITHUB_RELEASES_TAG], revalidate: false },
    );
  });

  it("lists every page of the repo's releases", async () => {
    mockPaginate.mockResolvedValue([]);
    await getChangelog();
    expect(mockPaginate).toHaveBeenCalledWith("listReleases", {
      owner: "nzmksk",
      repo: "my-chess-tour",
      per_page: 100,
    });
  });

  it("returns published releases as entries, newest version first", async () => {
    mockPaginate.mockResolvedValue([
      release("v0.9.6-alpha", "2026-11-15T09:57:19Z", "### Fixed\n- A."),
      release("v0.11.0-alpha", "2026-11-19T02:47:02Z", "### New\n- B."),
      release("v0.12.0-alpha", null, "### New\n- Draft."),
      release("nightly", "2026-11-19T00:00:00Z", "### New\n- C."),
      release("v0.10.0-alpha", "2026-11-18T10:52:09Z", "### Improved\n- D."),
    ]);
    expect(await getChangelog()).toEqual([
      { version: "v0.11.0-alpha", date: "2026-11-19", new: ["B."] },
      { version: "v0.10.0-alpha", date: "2026-11-18", improved: ["D."] },
      { version: "v0.9.6-alpha", date: "2026-11-15", fixed: ["A."] },
    ]);
  });

  it("authenticates with GITHUB_TOKEN when it is set", async () => {
    vi.stubEnv("GITHUB_TOKEN", "github_pat_test");
    mockPaginate.mockResolvedValue([]);
    await getChangelog();
    expect(mockOctokit).toHaveBeenCalledWith(
      expect.objectContaining({ auth: "github_pat_test" }),
    );
  });

  it("reads anonymously without a token", async () => {
    vi.stubEnv("GITHUB_TOKEN", "");
    mockPaginate.mockResolvedValue([]);
    await getChangelog();
    expect(mockOctokit).toHaveBeenCalledWith(
      expect.objectContaining({ auth: undefined }),
    );
  });

  it("throws when GitHub fails, so nothing is cached", async () => {
    mockPaginate.mockRejectedValue(new Error("rate limited"));
    await expect(getChangelog()).rejects.toThrow("rate limited");
  });
});

describe("loadChangelog", () => {
  it("returns the entries", async () => {
    mockPaginate.mockResolvedValue([
      release("v0.11.0-alpha", "2026-11-19T02:47:02Z", "### New\n- B."),
    ]);
    expect(await loadChangelog()).toHaveLength(1);
  });

  it("returns null and logs when GitHub fails", async () => {
    const consoleError = vi
      .spyOn(console, "error")
      .mockImplementation(() => {});
    mockPaginate.mockRejectedValue(new Error("rate limited"));
    expect(await loadChangelog()).toBeNull();
    expect(consoleError).toHaveBeenCalledWith(
      "Changelog: could not read the GitHub releases",
      expect.any(Error),
    );
    consoleError.mockRestore();
  });
});
