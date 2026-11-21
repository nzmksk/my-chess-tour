# Releases and the app version

How a release is cut, how the footer and bug reports know which release a deployment is running (#621), and how users hear what changed (#622, #640).

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

The changelog is the GitHub release notes (#640). Each release's notes are written for players and organizers, and the site reads them from the GitHub API at runtime. Nothing is kept in the repo, so fixing a typo is an edit on GitHub, with no PR and no deploy.

### Writing the notes

```md
Optional one-line headline.

### New
- What people can do now that they couldn't before.

### Improved
- What works better.

### Fixed
- What was broken and now works.

<!-- developer notes -->

## What's Changed
* … (from "Generate release notes")
```

- **Write for someone who has never seen the code.** "Organizers can download their participant list as a CSV or Excel file", not "Participant CSV/Excel export (#90)". Leave out refactors, dependency bumps and internal tooling.
- **Everything from `<!-- developer notes -->` on is never shown.** GitHub's generated `## What's Changed`, `## New Contributors` and `**Full Changelog**` end the part for users too. So press "Generate release notes" first, then write the notes for users above the list.
- **Only `New`, `Improved` and `Fixed` are read**, at any heading level and in any case. Items under any other heading, and list items before the first heading, are dropped. Text before the first heading is the headline.
- **Items are plain text.** A link keeps its text; bold, italics and code formatting are dropped.
- **`<!-- silent -->`** for a release with nothing user-visible. It is still listed on `/changelogs`, but never announced in the dialog. A release with no items at all is treated as silent too, and `/changelogs` shows "Behind-the-scenes improvements." for it.
- **The date is the day the release was published, in Malaysia.** Drafts never show; pre-releases do.

Where it shows up:

| Where | What |
| -- | -- |
| `/changelogs` | Every release, newest first, 10 per page (`/changelogs?page=2`), with an anchor per version (`/changelogs#v0.11.0-alpha`) |
| Footer | A "Changelog" link, and the version text links to that release's entry, which is always first on page 1 |
| "What's new" dialog | Once per browser after a new release, on the first ordinary page view (see below) |

### How the site reads them

- **Cached with no time limit.** `getChangelog()` (`src/services/github/releases.ts`) lists every published release, parses the notes (`src/lib/release-notes.ts`) and caches the result under the `github-releases` tag. It uses `GITHUB_TOKEN` when it is set; without one GitHub allows 60 requests an hour per IP address, shared with whatever else runs there.
- **The release webhook invalidates it.** GitHub calls `/api/v1/webhooks/github` on every release event (published, edited, deleted, ...), and the route invalidates the tag. The first request after that is still served the old notes while new ones load, and the next one gets them. If GitHub fails during that reload, the old notes stay.
- **A failure is never cached.** `/changelogs` says it couldn't load the changelog and links to the releases on GitHub; the dialog stays quiet and tries again on the next page load. The error goes to Sentry.
- **Releases ahead of the build stay hidden.** A build only lists releases at or before its own version (`APP_VERSION`). A release published on staging doesn't show on production until production carries its tag, and on staging it shows after the redeploy that picks up the tag.

**Setting up the webhook**, once per site (repository Settings → Webhooks → Add webhook):

- Payload URL: `https://staging.mychesstour.com/api/v1/webhooks/github`, or `https://www.mychesstour.com/api/v1/webhooks/github` for production.
- Content type: `application/json`.
- Secret: generate one with `openssl rand -hex 32` and set the same value as `GITHUB_WEBHOOK_SECRET` on that Netlify site. A delivery with a missing or wrong signature gets a 401; with the variable unset, every delivery gets a 500.
- Events: "Let me select individual events" → **Releases** only.

GitHub sends a `ping` when the webhook is created; its Recent Deliveries tab should show a 200. Without a working webhook, a site keeps serving the releases it already cached, so edits and new releases don't reach it.

**The "What's new" dialog** (`src/components/WhatsNew.tsx`) keeps the last version seen in `localStorage` under `mct:lastSeenVersion`, so it works signed out. A first-ever visit stores the version without showing anything. Only when the browser has missed a release does the dialog fetch the releases since, from `/api/v1/changelog?after=<last seen>`; if that fails, nothing is stored or shown. A visitor who skipped several releases sees one dialog, for the newest non-silent one. It never appears on checkout and payment return (`/tournaments/[slug]/register/**`), sign-in, sign-up, verify and password reset (`/auth/**`, since a signed-out player opening `/register` is sent to sign in first) or `/prize-funding/**`; it waits for the next ordinary page, and drops a fetch still in flight when the visitor moves into one. With storage blocked it never shows. To see it again while testing, delete the key in devtools (Application → Local Storage) or set it to an older version.

## Cutting a release

1. Merge the release's PRs into `staging` and wait for the staging deploy to finish.
2. Draft a GitHub pre-release with a new tag on `staging`. The tag must start with `v` and a digit (`vMAJOR.MINOR.PATCH-alpha`), or the resolver and the changelog ignore it. Press **Generate release notes**, then write the notes for users above the generated list, with `<!-- developer notes -->` between them ([format](#writing-the-notes)). Drafts never show on the site, so take your time.
3. **Publish** the release.
4. **Redeploy staging** (Netlify → staging site → Deploys → Trigger deploy → Deploy site). The deploy from step 1 was built before the tag existed, so until this redeploy the footer still shows the previous release plus the commit, and the new release stays hidden.
5. On `staging.mychesstour.com`, check that the footer shows the new tag, that `/changelogs` lists it with your notes, and that the "What's new" dialog appears (set `mct:lastSeenVersion` to the previous version first).

To fix the notes later, edit the release on GitHub. Both sites pick up the change through the webhook, without a deploy.

### Promoting to production

Production builds `master`, and shows the nearest tag reachable from `master`. Bring the release in with a **merge** of `staging` into `master`, not a squash or a rebase: those create new commits that the tag doesn't point at, and production would keep showing an older release.

The tag must already exist when production builds. If it was created afterwards, redeploy production too.

**Migrate production's database first** if the release adds files to `supabase/migrations`: run `supabase db push --include-all --dry-run` and then without `--dry-run` against production, before merging. Staging is migrated automatically; production isn't. See [database-migrations.md](database-migrations.md#production).
