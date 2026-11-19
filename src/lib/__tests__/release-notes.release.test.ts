import { describe, expect, it } from "vitest";
import { isReleaseVersion } from "@/lib/changelog";
import { hasUserNotes } from "@/lib/release-notes";

/**
 * Checks the notes of the release being published or edited (#640). Run by
 * .github/workflows/release-notes.yml, which passes the release in
 * RELEASE_TAG and RELEASE_NOTES; skipped everywhere else.
 *
 * The notes are the changelog players and organizers read, so a release with
 * only GitHub's generated PR list fails here: write the notes, or mark a
 * release with nothing user-visible silent.
 */
const tag = process.env.RELEASE_TAG;
const notes = process.env.RELEASE_NOTES;

describe.skipIf(tag === undefined)(`release ${tag}`, () => {
  it("is tagged with a release version, or the changelog ignores it", () => {
    expect(
      isReleaseVersion(tag ?? ""),
      `"${tag}" must look like v0.12.0-alpha`,
    ).toBe(true);
  });

  it("has notes for users, or is marked silent", () => {
    expect(
      hasUserNotes(notes),
      "Add ### New, ### Improved or ### Fixed items above the developer notes, or <!-- silent --> for a release with nothing user-visible. See wiki/releases.md.",
    ).toBe(true);
  });
});
