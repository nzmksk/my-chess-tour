# 0001. No code comments

- Status: Accepted
- Date: 2026-11-21
- Issue: #675

## Context

The codebase had about 5,500 comments in its TypeScript and JavaScript.
Most of them fell into one of four kinds:

- **Tautology**: repeats what the code already says.
- **Excuse**: explains away a hacky implementation, which then gets copied
  elsewhere as if it were the pattern.
- **Stale**: describes code or behavior that has since changed.
- **Decision record**: documents an important, non-obvious decision.

Only the last kind carries knowledge that the code can't. Even then, a comment
is a poor home for it: it sits next to one call site when the decision spans
several, and nothing tells a reader when it stops being true.

## Decision

Code comments aren't allowed. The `local/no-comments` ESLint rule
(`eslint-rules/no-comments.mjs`) reports every comment in `.ts`, `.tsx`,
`.js` and `.mjs` files, except tool directives: `eslint-*`, `@ts-expect-error`,
`@ts-nocheck`, `@ts-check`, `@vitest-environment` and `/// <reference>`.

Instead of a comment:

- **Tautology or stale**: delete it.
- **Excuse**: delete it and open an issue to fix the implementation.
- **Decision record**: move it to an ADR in this folder.

The rule is ratcheted with ESLint's bulk suppressions. `eslint-suppressions.json`
holds how many comments each file had when the rule landed. A file can't gain
comments, and when it loses some, `npx eslint` fails until the count is
lowered with `npx eslint --prune-suppressions`. The `/delete-comment` skill
(`.claude/skills/delete-comment/SKILL.md`) works through what's left.

SQL (`supabase/`), shell, YAML and HTML templates aren't linted by ESLint and
are outside the rule. The migrations in `supabase/migrations` are append-only
([database-migrations](../wiki/database-migrations.md)), so their comments
stay as written.

## Consequences

- Names, types and tests have to carry what comments used to explain.
- A reader looking for the reason behind some code checks `docs/adr/`, not
  the code itself. Each record names the files it governs, so it can be found
  by grepping for the file or the identifier.
- `npx eslint` fails on a new comment, so a reviewer doesn't have to catch it.
