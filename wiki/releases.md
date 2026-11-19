# Releases and the app version

How a release is cut, how the footer and bug reports know which release a deployment is running (#621), and how users hear what changed (#622).

## Git tags are the source of truth

The release version exists in exactly one place: the git tag of the GitHub release (`v0.10.0-alpha`, for example). `package.json` carries no version, so there is nothing to forget to bump and nothing to drift.

At build time, `next.config.ts` calls `resolveReleaseVersion()` (`src/lib/release-version.ts`), which runs:

```sh
git describe --tags --abbrev=0 --match "v[0-9]*"
```

That is the nearest release tag reachable from the commit being built. The result is inlined as `APP_VERSION`, next to `APP_COMMIT` (the short `COMMIT_REF` Netlify sets during the build). Nothing reads git at runtime; Netlify functions have no repository.

| Where | What it shows |
| -- | -- |
| Footer, production | `v0.10.0-alpha` |
| Footer, staging, branch deploys, deploy previews, local | `v0.10.0-alpha · 2579032` (commit appended when `COMMIT_REF` is set, so builds between two releases can be told apart) |
| Bug reports (`/api/v1/feedback`, #616) | `v0.10.0-alpha (2579032)` |

### On Netlify

Netlify clones shallow and without tags, and a cached clone can hold stale ones. So when `NETLIFY=true`, the resolver first runs `git fetch --force --tags` (plus `--unshallow` on a shallow clone) against `origin`, falling back to `REPOSITORY_URL`. Then:

- If the fetch fails but a tag is still found locally, the build continues with a warning in the build log (`Could not fetch git tags`). The version may be stale.
- If no tag is reachable at all, **the build fails**, and Netlify keeps serving the previous deploy. Showing testers the wrong version is worse than a failed deploy.

**Override.** Setting `APP_VERSION` in the site's environment skips git entirely and uses that value. It is for an emergency deploy when git can't be reached. Remove it afterwards, or every later build will show the same version.

### Locally

`npm run dev` and `npm run build` use whatever tags your clone has and never fetch. Run `git fetch --tags` if the footer shows an old version. A clone with no tags at all shows `dev`.

## The changelog

GitHub's release notes list PR titles for developers. Users get their own changelog, kept in the repo at `src/content/changelog.ts`: one entry per release, newest first, written for players and organizers. It is bundled at build time, so nothing calls GitHub at runtime.

```ts
{
  version: "v0.11.0-alpha", // the tag, exactly
  date: "2026-11-19",       // the day the release is published
  headline: "Optional one-line summary.",
  new: ["What people can do now that they couldn't before."],
  improved: ["What works better."],
  fixed: ["What was broken and now works."],
}
```

- **Write for someone who has never seen the code.** "Organizers can download their participant list as a CSV or Excel file", not "Participant CSV/Excel export (#90)". Leave out refactors, dependency bumps and internal tooling.
- **`silent: true`** for a release with nothing user-visible. It is still listed on `/changelogs`, but never announced in the dialog.
- **Entries ahead of their tag stay hidden.** A build only lists entries at or before its own version, so merging the entry before cutting the tag doesn't show an unreleased version on staging.

Where it shows up:

| Where | What |
| -- | -- |
| `/changelogs` | Every release, newest first, with an anchor per version (`/changelogs#v0.11.0-alpha`) |
| Footer | A "Changelog" link, and the version text links to that release's entry |
| "What's new" dialog | Once per browser after a new release, on the first ordinary page view (see below) |

**The "What's new" dialog** (`src/components/WhatsNew.tsx`) keeps the last version seen in `localStorage` under `mct:lastSeenVersion`, so it works signed out. A first-ever visit stores the version without showing anything. A visitor who skipped several releases sees one dialog, for the newest non-silent one. It never appears on checkout and payment return (`/tournaments/[slug]/register/**`), sign-in, sign-up, verify and password reset (`/auth/**`, since a signed-out player opening `/register` is sent to sign in first) or `/prize-funding/**`; it waits for the next ordinary page. With storage blocked it never shows. To see it again while testing, delete the key in devtools (Application → Local Storage) or set it to an older version.

**CI enforces it.** `src/content/__tests__/changelog.test.ts` fails when any `v*` tag reachable from the checked-out commit has no entry, or when the entries are out of order or malformed. The Tests workflow checks out full history with tags for this, and also runs on every published release, which is what catches a tag cut without an entry.

## Cutting a release

1. **Write the changelog entry** in `src/content/changelog.ts`, in a PR to `staging` (usually the last PR of the release). Use the exact tag you are about to create, and the date you will publish it.
2. Merge the release's PRs into `staging` and wait for the staging deploy to finish.
3. Publish a GitHub pre-release with that tag on `staging`. The tag must start with `v` and a digit (`vMAJOR.MINOR.PATCH-alpha`), or the resolver ignores it.
4. Check the **Tests** workflow run for the release passed (Actions tab). If it failed with "Add these releases to src/content/changelog.ts", the entry is missing or its `version` doesn't match the tag: fix it in a PR, then redeploy.
5. **Redeploy staging** (Netlify → staging site → Deploys → Trigger deploy → Deploy site). The deploy from step 2 was built before the tag existed, so until this redeploy the footer still shows the previous release plus the commit, and the new entry stays hidden.
6. On `staging.mychesstour.com`, check that the footer shows the new tag, that `/changelogs` lists it, and that the "What's new" dialog appears (set `mct:lastSeenVersion` to the previous version first).

### Promoting to production

Production builds `master`, and shows the nearest tag reachable from `master`. Bring the release in with a **merge** of `staging` into `master`, not a squash or a rebase: those create new commits that the tag doesn't point at, and production would keep showing an older release.

The tag must already exist when production builds. If it was created afterwards, redeploy production too.

**Migrate production's database first** if the release adds files to `supabase/migrations`: run `supabase db push --include-all --dry-run` and then without `--dry-run` against production, before merging. Staging is migrated automatically; production isn't. See [database-migrations.md](database-migrations.md#production).
