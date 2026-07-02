Handoff — Profile / eligibility / OKU verification arc

Repo: my-chess-tour (Next.js 16 App Router, TS, Tailwind v4, Supabase). Branch: oku-verification-flow (clean working tree; all work committed). State: npm run build, npx eslint, and npx vitest run (1357 tests, 95 files) all green as of last run.

What shipped (three sequential features)

1. Progressive profiling — PR #384 restructure-signup-flow
Removed the signup profile step; after email verify users land on /tournaments. /settings (src/app/settings/_components/ProfileClient.tsx) is the canonical profile editor.

2. Just-in-time completion + rated/restriction enforcement — PR #385 tournament-registration-profiling
- Missing self-serviceable fields (date_of_birth, gender, fide_id, mcf_id, nationality) are collected inline at registration via src/app/tournaments/[slug]/register/_components/CompleteProfilePrompt.tsx. Logic in RegisterForm.tsx: getMissingProfileFields (collectable-if-null) vs checkHardEligibility (unfixable blocks).
- Eligibility is data-driven in src/app/api/v1/tournaments/[slug]/registrations/validators.ts (checkRestrictions, checkFeeTierEligibility, checkRatedRequirements); client mirrors it.
- FIDE/MCF-rated tournaments require fide_id/mcf_id. Nationality restrictions match via nationalityMatches in src/lib/countries.ts (canonical alpha-3, no fallback).
- Wizard restrictions now persist normalized via src/app/my/organizations/[orgId]/tournaments/create/_components/restrictions.ts (toPersistedRestrictions/fromPersistedRestrictions); Gender + Nationality restriction inputs are constrained selects/CountryDropdown. (Previously wizard restrictions silently didn't enforce.)
- Dismissible profile nudge on /tournaments (src/app/tournaments/_components/ProfileNudge.tsx).

3. OKU document verification — commit 617d48a (latest, not yet a PR)
Replaced the self-declared is_oku boolean with admin-verified status.
- Schema (flattened into base migrations, pre-launch): db/migrations/001_tables.sql — player_profiles dropped is_oku/show_oku/show_age; added oku_status enum (none|pending|verified|rejected) + oku_document_path, oku_reviewed_by, oku_reviewed_at, oku_rejection_reason. Private oku-documents bucket + RLS in db/migrations/005_bucket_policies.sql. (There is no migration 008 — it was folded in.)
- Player flow: src/app/settings/_components/OkuVerificationCard.tsx uploads the card to the private bucket → POST /api/v1/profile/oku sets pending. PATCH /api/v1/profile no longer accepts is_oku/show_*.
- Admin review: /admin/oku + /admin/oku/[userId] (doc via signed URL, approve/reject-with-reason), mirroring /admin/applications; guarded by platform.manage. PATCH /api/v1/admin/oku/[userId] does a pending-guarded status flip. Dashboard links added.
- Gate: eligibility now requires oku_status === 'verified' (OKU is a hard block, never self-served by the prompt).
- Public profile: age + OKU badge are always public (badge shows iff verified); show_* toggles removed. See src/app/profile/_data/getPublicProfile.ts.

Remaining follow-ups (none started)

1. Player banking/payouts — bank_name/bank_account_holder/bank_account_number columns exist on player_profiles, no UI/API. Collect just-in-time at prize claim / refund.
2. OKU approve/reject email notifications — the org-application flow has none either; Resend infra exists at src/services/email/.
3. FIDE rating auto-fetch when fide_id is set inline (rating-restricted + FIDE-rated edge case).
