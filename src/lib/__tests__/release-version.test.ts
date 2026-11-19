import { describe, it, expect, vi, afterEach } from "vitest";
import { resolveReleaseVersion } from "../release-version";

type Responses = Record<string, string | Error>;

/** A fake git keyed by subcommand; unknown subcommands throw. */
function fakeGit(responses: Responses) {
  return vi.fn((args: string[]) => {
    const key = args[0] === "fetch" ? `fetch ${args.at(-1)}` : args[0];
    const response = responses[key];
    if (response === undefined || response instanceof Error) {
      throw response ?? new Error(`unexpected git ${args.join(" ")}`);
    }
    return response;
  });
}

const DESCRIBE_ARGS = [
  "describe",
  "--tags",
  "--abbrev=0",
  "--match",
  "v[0-9]*",
];

describe("resolveReleaseVersion", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("returns the nearest release tag", () => {
    const run = fakeGit({ describe: "v0.10.0-alpha" });
    expect(resolveReleaseVersion(run, {})).toBe("v0.10.0-alpha");
    expect(run).toHaveBeenCalledWith(DESCRIBE_ARGS);
  });

  it("does not fetch outside Netlify", () => {
    const run = fakeGit({ describe: "v0.10.0-alpha" });
    resolveReleaseVersion(run, {});
    expect(run).toHaveBeenCalledTimes(1);
  });

  it("prefers an APP_VERSION override without touching git", () => {
    const run = fakeGit({});
    expect(resolveReleaseVersion(run, { APP_VERSION: "v9.9.9" })).toBe(
      "v9.9.9",
    );
    expect(run).not.toHaveBeenCalled();
  });

  it("falls back to dev locally when no tag is reachable", () => {
    const run = fakeGit({ describe: new Error("No names found") });
    expect(resolveReleaseVersion(run, {})).toBe("dev");
  });

  describe("on Netlify", () => {
    it("unshallows and fetches tags before describing", () => {
      const run = fakeGit({
        "rev-parse": "true",
        "fetch origin": "",
        describe: "v0.10.0-alpha",
      });
      expect(resolveReleaseVersion(run, { NETLIFY: "true" })).toBe(
        "v0.10.0-alpha",
      );
      expect(run).toHaveBeenCalledWith([
        "fetch",
        "--quiet",
        "--force",
        "--tags",
        "--unshallow",
        "origin",
      ]);
      const order = run.mock.calls.map(([args]) => args[0]);
      expect(order.indexOf("fetch")).toBeLessThan(order.indexOf("describe"));
    });

    it("does not pass --unshallow to a full clone", () => {
      const run = fakeGit({
        "rev-parse": "false",
        "fetch origin": "",
        describe: "v0.10.0-alpha",
      });
      resolveReleaseVersion(run, { NETLIFY: "true" });
      expect(run).toHaveBeenCalledWith([
        "fetch",
        "--quiet",
        "--force",
        "--tags",
        "origin",
      ]);
    });

    it("falls back to the repository URL when origin fails", () => {
      const url = "https://github.com/nzmksk/my-chess-tour";
      const run = fakeGit({
        "rev-parse": "true",
        "fetch origin": new Error("auth failed"),
        [`fetch ${url}`]: "",
        describe: "v0.10.0-alpha",
      });
      expect(
        resolveReleaseVersion(run, { NETLIFY: "true", REPOSITORY_URL: url }),
      ).toBe("v0.10.0-alpha");
      expect(run).toHaveBeenCalledWith(
        expect.arrayContaining(["fetch", "--unshallow", url]),
      );
    });

    it("warns but still uses a local tag when every fetch fails", () => {
      const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
      const run = fakeGit({
        "rev-parse": "false",
        "fetch origin": new Error("offline"),
        describe: "v0.9.6-alpha",
      });
      expect(resolveReleaseVersion(run, { NETLIFY: "true" })).toBe(
        "v0.9.6-alpha",
      );
      expect(warn).toHaveBeenCalledOnce();
    });

    it("fails the build when no tag is reachable", () => {
      const run = fakeGit({
        "rev-parse": "false",
        "fetch origin": "",
        describe: new Error("No names found"),
      });
      expect(() => resolveReleaseVersion(run, { NETLIFY: "true" })).toThrow(
        /No v\* git tag/,
      );
    });
  });
});
