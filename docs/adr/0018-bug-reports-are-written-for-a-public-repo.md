# 0018. Bug reports are written for a public repo

- Status: Accepted
- Date: 2026-11-21
- Issue: #616, #675

## Context

The in-app bug report files an issue on this repository, which is public. A
report is free text from anyone, signed in or not, so whatever it contains is
published under our name.

## Decision

`src/services/bug-reports/format.ts` builds the issue as text for
publication:

- **The reporter's text goes in fenced code blocks.** GitHub doesn't process
  @mentions, #references, HTML, images or links inside code, so a report can't
  ping anyone, cross-link into other issues, or hide content in an HTML
  comment. The fence is always longer than any backtick run in the text, so
  the text can't close it.
- **Hidden characters are stripped first**: C0/C1 controls (keeping tab and
  newline), zero-width and joiner characters, bidi embeddings, overrides and
  isolates, and the BOM. Then newlines are normalised and blank runs
  collapsed, and length limits apply to the result.
- **The title is plain text**, but GitHub still links `#123` there, so `@` and
  `#` are broken with a zero-width space. Table cells are single-line code
  spans with `|` escaped, because GFM splits cells on it even inside code.
- **No identity is published**: no email, name, user id or IP. Who sent the
  report is kept privately in `bug_reports`.
- **The page path is reduced and masked.** Origin, query string and fragment
  are dropped (they can carry tokens or an email address). An invitation
  token grants the membership it was sent for, so it's masked even in the
  private row, along with any long base64url-like or hex segment; tournament
  slugs (lowercase words and digits) survive. The published path also masks
  record ids, since `/profile/<id>` names a person.
- **The reporter sees a reference, not the issue link**: the first eight hex
  digits of the `bug_reports` id, short enough to read out, found with
  `id::text LIKE '<hex>%'`.

`src/services/bug-reports/github.ts` files the issue with labels `bug` and
`user-reported` (which must exist on the repo), using a `GITHUB_TOKEN` scoped
to Issues: write on this repo only. Its timeout is shorter than the function's,
so a slow GitHub can't hold the request; the route records the failure on the
row and support files it by hand.

## Consequences

- A report can't be used to deface the repo or reach anyone through it.
- Diagnosing a report may need the private row for context the issue leaves
  out.
