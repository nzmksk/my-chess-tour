# Releases and the app version

How a release is cut, and how the footer and bug reports know which release a deployment is running. Issue #621.

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

## Cutting a release

1. Merge the release's PRs into `staging` and wait for the staging deploy to finish.
2. Publish a GitHub pre-release with a new tag on `staging`. The tag must start with `v` and a digit (`vMAJOR.MINOR.PATCH-alpha`), or the resolver ignores it.
3. **Redeploy staging** (Netlify → staging site → Deploys → Trigger deploy → Deploy site). The deploy from step 1 was built before the tag existed, so until this redeploy the footer still shows the previous release plus the commit.
4. Check the footer on `staging.mychesstour.com` shows the new tag.

### Promoting to production

Production builds `master`, and shows the nearest tag reachable from `master`. Bring the release in with a **merge** of `staging` into `master`, not a squash or a rebase: those create new commits that the tag doesn't point at, and production would keep showing an older release.

The tag must already exist when production builds. If it was created afterwards, redeploy production too.
