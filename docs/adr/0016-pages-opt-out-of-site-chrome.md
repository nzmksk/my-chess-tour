# 0016. Pages opt out of site chrome

- Status: Accepted
- Date: 2026-11-21
- Issue: #643, #675

## Context

The root layout renders the navbar and footer for every route, but it can't
tell a 404 from any other path, and the platform admin console is an internal
tool whose staff have no use for public site chrome.

## Decision

- A page that shouldn't show the footer marks itself with `data-no-footer`,
  as the 404 page does, and CSS hides the footer (`src/components/Footer.tsx`).
  CSS rather than a client-side check, so the footer never flashes in before
  being removed.
- `HideOnAdmin` (`src/components/HideOnAdmin.tsx`) wraps chrome that has no
  place under `/admin`. Its children stay server-rendered; it only decides
  whether to show them.

## Consequences

- Hiding chrome is the page's decision, made in the page, not a list of paths
  kept in the layout.
