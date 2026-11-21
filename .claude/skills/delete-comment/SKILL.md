---
name: delete-comment
description: Work down the code comments left in the codebase. Classify each comment as tautology, excuse, stale or decision record, then delete it, file an issue for it, or move it into an ADR in docs/adr/, and lower the ESLint suppression counts. Use when asked to clean up, delete or remove comments, to run /delete-comment, or to bring a file or folder under the local/no-comments rule.
argument-hint: "[path ...]  (defaults to the files with the most comments)"
---

# /delete-comment

Comments aren't allowed in this codebase ([ADR 0001](../../../docs/adr/0001-no-code-comments.md)).
The `local/no-comments` ESLint rule enforces that, and `eslint-suppressions.json`
holds the per-file counts of comments that were there before the rule. This
skill lowers those counts.

Run everything from the repository root.

## 1. Pick the scope

If the user named paths, use those. Otherwise look at what's left and pick one
area (a folder or feature) small enough to review properly, about 100 to 300
comments:

```sh
node .claude/skills/delete-comment/scripts/list-comments.mjs --summary [path ...]
```

The last line is the estimate of how many lines deleting every remaining
comment would shed.

## 2. Read every comment in context

```sh
node .claude/skills/delete-comment/scripts/list-comments.mjs <path ...>
```

Each entry prints the comment's key (`file:line:col`), the comment, and the next
line of code (`-->`). When that isn't enough to judge, open the file. Don't
classify a comment you haven't understood.

## 3. Classify each comment

| Kind                | It...                                                             | Action                                    |
| ------------------- | ----------------------------------------------------------------- | ----------------------------------------- |
| **Tautology**       | repeats what the code, a name, a type or a test already says      | Delete                                    |
| **Stale**           | describes code, behavior or an issue that's no longer true        | Delete                                    |
| **Excuse**          | apologises for or justifies a hack, workaround, shortcut or TODO  | Delete, and file an issue to fix the code |
| **Decision record** | explains an important, non-obvious _why_ that the code can't show | Move to an ADR, then delete               |

How to tell them apart:

- A JSDoc that restates the function name and parameters is a tautology. So
  is a section divider (`// ---- CSV ----`), an `// Arrange / Act / Assert`
  label, and a test comment that restates the `it(...)` name or the assertion.
- Check claims against the code. If the comment names a function, column,
  issue or behavior that isn't there any more, it's stale.
- Words like _workaround_, _hack_, _for now_, _temporary_, _TODO_, _until_,
  _cast because_, _not ideal_, or a `// eslint-disable` that needs a paragraph
  of justification usually mark an excuse.
- A decision record answers "why is it like this and not the obvious way?":
  a security guard (CSV injection, open redirects, leaking schema text), a
  compatibility constraint (Excel needs a BOM, Next must see a literal), a
  business rule (refund windows, rounding, who may see what), or a race it
  avoids. If deleting it would let a careful engineer "simplify" the code into
  a bug, it's a decision record.
- When a comment mixes kinds, split it: move the decision, drop the rest.
- Before writing an ADR, ask whether the code could say it instead: a better
  name, a named constant, an extracted function, or a test that fails if
  someone undoes the decision. Prefer that, and keep the change small.

## 4. Act

**Decision records.** Group related ones into a single ADR per decision, not
one per comment. Search `docs/adr/` first and extend an existing record if it
covers the same decision, rather than writing a near-duplicate. New records
follow `docs/adr/template.md`, take the next number, name the files and
identifiers they govern, and go in the index in `docs/adr/README.md`. Write
them for someone who hasn't seen the comment: the decision, the reason, and
what a change must preserve. Drop issue-tracker chatter but keep the issue
number.

**Excuses.** File one issue per hack (several comments about the same hack
share one), then delete the comments:

```sh
gh issue create --label refactoring --title "<what to fix>" --body "<where, what the comment said, why it's hacky, what a fix looks like>"
```

Link the issues in the PR description.

**Delete.** Put the keys of every comment to remove, including the ones moved to
ADRs, one per line in a file in the scratchpad (`# notes` after a key are
ignored), then:

```sh
node .claude/skills/delete-comment/scripts/delete-comments.mjs <keys-file>
```

It removes whole lines for comments on their own line, tidies the blank line
left behind, and strips trailing and JSX (`{/* */}`) comments. Keys go stale as
soon as a file changes, so list, classify and delete a file in one pass.

Tool directives (`eslint-disable*`, `@ts-expect-error`, `@vitest-environment`,
`/// <reference>`) aren't comments to the rule and aren't listed.

## 5. Verify

1. Format the touched files with
   `npx prettier --write --end-of-line auto <files>`, but only files that
   were prettier-clean at HEAD (the repo isn't). A deleted comment can leave
   an empty block that Prettier collapses, which is fine.
2. Re-read the diff. Nothing but comments, blank lines and formatting should
   change, apart from code you deliberately changed to make a comment
   unnecessary.
3. `npx tsc --noEmit` and `npx vitest run <touched folders>`.
4. Lower the counts: `npx eslint --prune-suppressions <touched files>`. Then
   `npx eslint <touched files>` must pass with no output. A full `npx eslint`
   takes minutes and fails if a count is too high (new comment) or too low
   (pruning forgotten).

## 6. Commit

One commit per area, containing the deletions, the ADRs they produced, and the
`eslint-suppressions.json` update, for example
`Delete comments in src/services/payouts; record payout decisions in ADRs (#675)`.
Report what was deleted, which ADRs were written, which issues were filed, and
the new `--summary` total.
