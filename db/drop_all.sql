-- =============================================================================
-- DROP ALL — full teardown of the MY Chess Tour schema
-- Reverses migrations 001–007 so you can re-apply them from scratch.
--
-- Scope: drops everything this app owns in `public`, the avatars,
-- oku-documents and organization-documents storage buckets and their policies,
-- the auth trigger this app adds to auth.users, and the seed
-- accounts. It does NOT touch Supabase-managed schemas (auth/storage) beyond
-- those app-owned objects, and does NOT drop the `public` schema itself (so
-- role grants / extensions stay intact).
--
-- DESTRUCTIVE. Intended for local/staging resets only. Run in the Supabase SQL
-- editor or psql, then re-run 001 → 007.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1. Storage (migration 005): policies, objects, bucket
-- -----------------------------------------------------------------------------
-- avatars bucket (public)
DROP POLICY IF EXISTS "Avatars are publicly readable" ON storage.objects;
DROP POLICY IF EXISTS "Users can manage own avatar"    ON storage.objects;
DROP POLICY IF EXISTS "Users can delete own avatar"    ON storage.objects;
DROP POLICY IF EXISTS "Org managers can manage org avatar" ON storage.objects;
DROP POLICY IF EXISTS "Org managers can delete org avatar" ON storage.objects;

-- oku-documents bucket (private)
DROP POLICY IF EXISTS "Users can upload own OKU document"     ON storage.objects;
DROP POLICY IF EXISTS "Users can delete own OKU document"     ON storage.objects;
DROP POLICY IF EXISTS "OKU documents readable by owner or admin" ON storage.objects;

-- organization-documents bucket (private)
DROP POLICY IF EXISTS "Users can upload own org document"     ON storage.objects;
DROP POLICY IF EXISTS "Users can delete own org document"     ON storage.objects;
DROP POLICY IF EXISTS "Org documents readable by uploader or admin" ON storage.objects;

-- Uploaded files, then the buckets themselves. Dropping the policies alone left
-- both behind: avatars, OKU documents and organization KYB documents are all
-- keyed by users.id, so after the users table is recreated below they would be
-- orphaned blobs whose paths point at ids that no longer exist — and OKU cards
-- and KYB documents are scanned identity documents, so leaving them in a "full
-- teardown" is the wrong default. Objects first: they FK to buckets. 005
-- recreates the buckets (ON CONFLICT DO NOTHING), so this is safe to re-apply.
DELETE FROM storage.objects
  WHERE bucket_id IN ('avatars', 'oku-documents', 'organization-documents');
DELETE FROM storage.buckets
  WHERE id        IN ('avatars', 'oku-documents', 'organization-documents');

-- -----------------------------------------------------------------------------
-- 2. Auth trigger this app adds to auth.users (migration 003)
--    (Dropped explicitly because auth.users itself is not dropped below.)
-- -----------------------------------------------------------------------------
DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;

-- -----------------------------------------------------------------------------
-- 3. View (migration 001)
-- -----------------------------------------------------------------------------
DROP VIEW IF EXISTS public.tournament_payout_summary CASCADE;

-- -----------------------------------------------------------------------------
-- 4. Tables (migrations 001 / 007). CASCADE also removes their RLS policies,
--    triggers, indexes, and foreign keys.
-- -----------------------------------------------------------------------------
DROP TABLE IF EXISTS public.audit_logs              CASCADE;
DROP TABLE IF EXISTS public.tournament_cancellation_requests CASCADE;
DROP TABLE IF EXISTS public.refunds                 CASCADE;
DROP TABLE IF EXISTS public.payments                CASCADE;
DROP TABLE IF EXISTS public.registrations           CASCADE;
DROP TABLE IF EXISTS public.tournaments             CASCADE;
DROP TABLE IF EXISTS public.organization_memberships CASCADE;
DROP TABLE IF EXISTS public.organization_documents  CASCADE;
DROP TABLE IF EXISTS public.organization_bank_accounts CASCADE;
DROP TABLE IF EXISTS public.organizations           CASCADE;
DROP TABLE IF EXISTS public.player_profiles         CASCADE;
DROP TABLE IF EXISTS public.user_global_roles       CASCADE;
DROP TABLE IF EXISTS public.users                   CASCADE;
DROP TABLE IF EXISTS public.role_permissions        CASCADE;
DROP TABLE IF EXISTS public.permissions             CASCADE;
DROP TABLE IF EXISTS public.roles                   CASCADE;
DROP TABLE IF EXISTS public.waitlist                CASCADE;

-- -----------------------------------------------------------------------------
-- 5. Functions (migrations 003 / 007). Drops every function in `public`
--    (all are app-owned), including any that backed the dropped trigger.
--    This is what removes app_user_id() / can_act_for() / the identity guard
--    (003) without needing to name them — the guard's own trigger went with
--    public.users above, and the users grants revoked in 004 died with the table.
-- -----------------------------------------------------------------------------
DO $$
DECLARE
  r record;
BEGIN
  FOR r IN
    SELECT p.oid::regprocedure AS sig
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public'
  LOOP
    EXECUTE 'DROP FUNCTION IF EXISTS ' || r.sig || ' CASCADE';
  END LOOP;
END $$;

-- -----------------------------------------------------------------------------
-- 6. Enums / types (migration 001)
-- -----------------------------------------------------------------------------
DROP TYPE IF EXISTS public.role_scope           CASCADE;
DROP TYPE IF EXISTS public.gender               CASCADE;
DROP TYPE IF EXISTS public.chess_title          CASCADE;
DROP TYPE IF EXISTS public.oku_status           CASCADE;
DROP TYPE IF EXISTS public.approval_status      CASCADE;
DROP TYPE IF EXISTS public.org_entity_type      CASCADE;
DROP TYPE IF EXISTS public.org_document_type    CASCADE;
DROP TYPE IF EXISTS public.bank_account_status  CASCADE;
DROP TYPE IF EXISTS public.tournament_status    CASCADE;
DROP TYPE IF EXISTS public.registration_status  CASCADE;
DROP TYPE IF EXISTS public.payment_type         CASCADE;
DROP TYPE IF EXISTS public.payment_status       CASCADE;
DROP TYPE IF EXISTS public.refund_status        CASCADE;

-- -----------------------------------------------------------------------------
-- 7. Seed accounts (migration 006). Deleting from auth.users cascades to
--    auth.identities. Scoped to seed/admin emails only.
-- -----------------------------------------------------------------------------
DELETE FROM auth.users
WHERE email LIKE '%@mct.com'
   OR email = 'review@chip.com';

-- -----------------------------------------------------------------------------
-- Verification (all should return 0)
-- -----------------------------------------------------------------------------
SELECT 'app_tables' AS check, count(*)
FROM information_schema.tables
WHERE table_schema = 'public'
  AND table_name IN (
    'roles','permissions','role_permissions','users','user_global_roles',
    'player_profiles','organizations','organization_memberships',
    'organization_bank_accounts','organization_documents','tournaments',
    'registrations','payments','refunds','tournament_cancellation_requests',
    'audit_logs','waitlist'
  );

SELECT 'app_enums' AS check, count(*)
FROM pg_type t
JOIN pg_namespace n ON n.oid = t.typnamespace
WHERE n.nspname = 'public'
  AND t.typname IN (
    'role_scope','gender','chess_title','oku_status','approval_status',
    'org_entity_type','org_document_type','bank_account_status',
    'tournament_status','registration_status','payment_type','payment_status',
    'refund_status'
  );

SELECT 'public_functions' AS check, count(*)
FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
WHERE n.nspname = 'public';

SELECT 'seed_auth_users' AS check, count(*)
FROM auth.users
WHERE email LIKE '%@mct.com' OR email = 'review@chip.com';

SELECT 'app_buckets' AS check, count(*)
FROM storage.buckets
WHERE id IN ('avatars', 'oku-documents', 'organization-documents');

SELECT 'app_storage_objects' AS check, count(*)
FROM storage.objects
WHERE bucket_id IN ('avatars', 'oku-documents', 'organization-documents');
