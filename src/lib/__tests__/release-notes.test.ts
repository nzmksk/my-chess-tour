import { describe, expect, it } from "vitest";
import { parseReleaseNotes, toChangelogEntry } from "../release-notes";

const GENERATED = `## What's Changed
* Move /tournaments to / (#615) by @someone in https://github.com/o/r/pull/623

## New Contributors
* @someone made their first contribution

**Full Changelog**: https://github.com/o/r/compare/v0.10.0-alpha...v0.11.0-alpha`;

describe("parseReleaseNotes", () => {
  it("reads the headline and the three groups", () => {
    expect(
      parseReleaseNotes(`Tournaments up front.

### New
- A bug report button.
- A changelog.

### Improved
- Faster pages.

### Fixed
- A broken link.
`),
    ).toEqual({
      headline: "Tournaments up front.",
      new: ["A bug report button.", "A changelog."],
      improved: ["Faster pages."],
      fixed: ["A broken link."],
    });
  });

  it("stops at the developer notes marker", () => {
    const notes = parseReleaseNotes(`### New
- Shown.

<!-- developer notes -->
### Fixed
- Hidden.
${GENERATED}`);
    expect(notes).toEqual({ new: ["Shown."] });
  });

  it.each([
    ["What's Changed", "## What's Changed\n* PR title"],
    ["New Contributors", "## New Contributors\n* @someone"],
    ["Full Changelog", "**Full Changelog**: https://example.com"],
  ])("stops at GitHub's generated %s section", (_, generated) => {
    expect(parseReleaseNotes(`### New\n- Shown.\n\n${generated}`)).toEqual({
      new: ["Shown."],
    });
  });

  it("treats notes GitHub generated, with nothing for users, as silent", () => {
    expect(parseReleaseNotes(GENERATED)).toEqual({ silent: true });
  });

  it("treats empty or missing notes as silent", () => {
    expect(parseReleaseNotes("")).toEqual({ silent: true });
    expect(parseReleaseNotes(null)).toEqual({ silent: true });
    expect(parseReleaseNotes(undefined)).toEqual({ silent: true });
  });

  it("keeps the items of a release marked silent", () => {
    expect(
      parseReleaseNotes("<!-- silent -->\n### Fixed\n- Small display fixes."),
    ).toEqual({ silent: true, fixed: ["Small display fixes."] });
  });

  it("matches group headings at any level and in any case", () => {
    expect(
      parseReleaseNotes("## new\n- One.\n#### IMPROVED ####\n- Two."),
    ).toEqual({ new: ["One."], improved: ["Two."] });
  });

  it("drops items under headings it doesn't know", () => {
    expect(
      parseReleaseNotes("### Internal\n- Refactor.\n### Fixed\n- A bug."),
    ).toEqual({ fixed: ["A bug."] });
  });

  it("drops list items before the first heading", () => {
    expect(parseReleaseNotes("- Stray.\n### New\n- Kept.")).toEqual({
      new: ["Kept."],
    });
  });

  it("accepts *, + and - bullets", () => {
    expect(parseReleaseNotes("### New\n* One.\n+ Two.\n- Three.")).toEqual({
      new: ["One.", "Two.", "Three."],
    });
  });

  it("joins an item wrapped over several lines", () => {
    expect(
      parseReleaseNotes(
        "### New\n- Organizers can download\n  their participant list.\n- Next.",
      ),
    ).toEqual({
      new: ["Organizers can download their participant list.", "Next."],
    });
  });

  it("joins a headline wrapped over several lines", () => {
    expect(
      parseReleaseNotes(
        "Refunds you can follow,\nand exports.\n\n### New\n- X.",
      ),
    ).toEqual({
      headline: "Refunds you can follow, and exports.",
      new: ["X."],
    });
  });

  it("reduces inline formatting to plain text", () => {
    expect(
      parseReleaseNotes(
        "**Big** release.\n### New\n- See the [Changelog](https://x.y/changelogs) page.\n- Use `Report a bug`, *now*.",
      ),
    ).toEqual({
      headline: "Big release.",
      new: ["See the Changelog page.", "Use Report a bug, now."],
    });
  });

  it("ignores other HTML comments and Windows line endings", () => {
    expect(
      parseReleaseNotes(
        "<!-- draft: check wording -->\r\n### New\r\n- One.\r\n",
      ),
    ).toEqual({ new: ["One."] });
  });

  it("drops blank items", () => {
    expect(parseReleaseNotes("### New\n- \n- **  **\n- Real.")).toEqual({
      new: ["Real."],
    });
  });
});

describe("toChangelogEntry", () => {
  const release = {
    tag_name: "v0.11.0-alpha",
    draft: false,
    published_at: "2026-11-19T02:47:02Z",
    body: "### New\n- A changelog.",
  };

  it("builds an entry from a published release", () => {
    expect(toChangelogEntry(release)).toEqual({
      version: "v0.11.0-alpha",
      date: "2026-11-19",
      new: ["A changelog."],
    });
  });

  it("dates the release by the day it was published in Malaysia", () => {
    expect(
      toChangelogEntry({ ...release, published_at: "2026-11-12T17:36:53Z" })
        ?.date,
    ).toBe("2026-11-13");
  });

  it("skips drafts", () => {
    expect(
      toChangelogEntry({ ...release, draft: true, published_at: null }),
    ).toBeNull();
  });

  it("skips tags that aren't release versions", () => {
    expect(toChangelogEntry({ ...release, tag_name: "nightly" })).toBeNull();
    expect(toChangelogEntry({ ...release, tag_name: "0.11.0" })).toBeNull();
  });

  it("skips a release without a publish date", () => {
    expect(toChangelogEntry({ ...release, published_at: null })).toBeNull();
  });
});
