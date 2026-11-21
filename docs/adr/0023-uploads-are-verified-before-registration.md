# 0023. Uploads are verified before their path is recorded

- Status: Accepted
- Date: 2026-11-21
- Issue: #675

## Context

Private documents (organizer KYB documents, OKU cards) go from the browser
straight to Supabase Storage, and the browser then POSTs the path to register
it. The file never passes through the API, so the API never sees its size or
type. Limits in the uploader component are a UX affordance, not a control: a
client that skips it can register a path to a 500 MB blob, or to nothing, and
the row is a dangling reference until a signed URL 404s for an admin.

## Decision

`assertUploadedObject` (`src/services/supabase/storage.ts`) checks that the
object exists and is within the size and content-type limits before its path
is recorded. A missing content type is a failure, since an object with none
wasn't put there through the normal path.

Storage RLS stops a user _writing_ outside their own folder, but not
_claiming_ a path, so callers also check the path's prefix against the
caller's id (the organizer-document and OKU validators).

`removeAllUnder(prefix)` deletes everything under a prefix. Storage's `list`
returns one page of one level, and a client with an insert policy can upload
any number of files at any depth its prefix allows, so it recurses into
folders and re-lists each level until it comes back empty. A pass that removes
nothing is an error, not a loop; a failure part-way leaves the rest for a
retry.

Documents are read through signed URLs minted per view, never stored links,
because the buckets are private. A reviewer's links last
`DOCUMENT_URL_TTL_SECONDS` (300, `src/services/payouts/review.ts`), as on the
application review page: these are identity documents, and a signed URL that
outlives the review is a credential sitting in a browser history.

## Consequences

- Every new browser-to-storage flow needs both checks: the prefix and
  `assertUploadedObject`.
