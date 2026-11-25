-- =============================================================================
-- DROP ALL — full teardown of the MY Chess Tour schema
-- Reverses every migration in supabase/migrations so you can re-apply them from
-- scratch. Tables, functions and enums are found in the catalog rather than
-- listed, since everything in `public` belongs to this app, so a new one can't
-- be left behind.
--
-- Scope: drops everything this app owns in `public`, the avatars,
-- oku-documents and organization-documents storage buckets and their policies,
-- the auth trigger this app adds to auth.users, every auth account, and the
-- Supabase CLI's migration history. It does NOT otherwise touch
-- Supabase-managed schemas (auth/storage) beyond those app-owned objects, and
-- does NOT drop the `public` schema itself (so role grants / extensions stay
-- intact).
--
-- DESTRUCTIVE. Intended for local/staging resets only. Run in the Supabase SQL
-- editor or psql, then rebuild with `supabase db push` and load
-- supabase/staging/seed.sql (docs/wiki/database-migrations.md).
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
DROP POLICY IF EXISTS "Players and those acting for them can upload an OKU document" ON storage.objects;
DROP POLICY IF EXISTS "OKU documents readable by those acting for the player or admin" ON storage.objects;

-- organization-documents bucket (private)
DROP POLICY IF EXISTS "Users can upload own org document"     ON storage.objects;
DROP POLICY IF EXISTS "Org documents readable by uploader or admin" ON storage.objects;

-- Uploaded files, then the buckets themselves. Dropping the policies alone left
-- both behind: avatars, OKU documents and organization KYB documents are all
-- keyed by users.id, so after the users table is recreated below they would be
-- orphaned blobs whose paths point at ids that no longer exist — and OKU cards
-- and KYB documents are scanned identity documents, so leaving them in a "full
-- teardown" is the wrong default. Objects first: they FK to buckets. 005
-- recreates the buckets, so this is safe to re-apply.
--
-- Supabase guards both tables with statement triggers (protect_objects_delete /
-- protect_buckets_delete → storage.protect_delete()) that reject any direct
-- DELETE unless storage.allow_delete_query = 'true'. That setting is the guard's
-- own opt-in, so it is turned on for exactly these two statements and reset
-- straight after. SET/RESET rather than SET LOCAL so it works whether or not the
-- SQL editor wraps the script in a transaction.
--
-- NOTE: this removes the storage METADATA rows only. The files themselves live
-- in Supabase's object store and are not deleted by SQL — that is what the
-- guard is warning about. They become unreachable (no row, no bucket), but to
-- actually erase them — the OKU and KYB scans especially — empty the three
-- buckets from the dashboard or the Storage API BEFORE running this script.
SET storage.allow_delete_query = 'true';
DELETE FROM storage.objects
  WHERE bucket_id IN ('avatars', 'oku-documents', 'organization-documents');
DELETE FROM storage.buckets
  WHERE id        IN ('avatars', 'oku-documents', 'organization-documents');
RESET storage.allow_delete_query;

-- -----------------------------------------------------------------------------
-- 2. Auth trigger this app adds to auth.users (migration 003)
--    (Dropped explicitly because auth.users itself is not dropped below.)
-- -----------------------------------------------------------------------------
DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
DROP TRIGGER IF EXISTS on_auth_user_confirmed ON auth.users;

-- -----------------------------------------------------------------------------
-- 3. View (migration 001)
-- -----------------------------------------------------------------------------
DROP VIEW IF EXISTS public.tournament_payout_summary CASCADE;

-- -----------------------------------------------------------------------------
-- 4. Tables (migration 001): every table in `public`. CASCADE also removes
--    their RLS policies, triggers, indexes and foreign keys.
-- -----------------------------------------------------------------------------
DO $$
DECLARE
  r record;
BEGIN
  FOR r IN
    SELECT c.oid::regclass AS tbl
    FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public' AND c.relkind IN ('r', 'p')
  LOOP
    EXECUTE 'DROP TABLE IF EXISTS ' || r.tbl || ' CASCADE';
  END LOOP;
END $$;

-- -----------------------------------------------------------------------------
-- 5. Functions (migrations 003 / 006). Drops every function in `public`
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
-- 6. Enums (migration 001): every enum type in `public`.
-- -----------------------------------------------------------------------------
DO $$
DECLARE
  r record;
BEGIN
  FOR r IN
    SELECT t.oid::regtype AS typ
    FROM pg_type t
    JOIN pg_namespace n ON n.oid = t.typnamespace
    WHERE n.nspname = 'public' AND t.typtype = 'e'
  LOOP
    EXECUTE 'DROP TYPE IF EXISTS ' || r.typ || ' CASCADE';
  END LOOP;
END $$;

-- -----------------------------------------------------------------------------
-- 7. Auth accounts. Deleting from auth.users cascades to auth.identities.
--
--    ALL of them, not just the seed accounts (supabase/staging/seed.sql).
--    public.users is dropped above, and on_auth_user_created only fires on
--    INSERT, so any account left here comes back from a rebuild with no users
--    record linked to it. Such an account can still sign in but has no profile, and is
--    invisible to every lookup keyed on public.users — e.g. inviting it to an
--    organization fails with "already been registered" (#565). A teardown that
--    keeps some accounts therefore leaves them broken, not preserved.
-- -----------------------------------------------------------------------------
DELETE FROM auth.users;

-- -----------------------------------------------------------------------------
-- 8. Migration history (#631). Without this, `supabase db push` would still
--    see every migration as applied and leave the database empty.
-- -----------------------------------------------------------------------------
DROP SCHEMA IF EXISTS supabase_migrations CASCADE;

-- -----------------------------------------------------------------------------
-- Verification (all should return 0)
-- -----------------------------------------------------------------------------
SELECT 'public_tables_and_views' AS check, count(*)
FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
WHERE n.nspname = 'public' AND c.relkind IN ('r', 'p', 'v', 'm');

SELECT 'public_enums' AS check, count(*)
FROM pg_type t JOIN pg_namespace n ON n.oid = t.typnamespace
WHERE n.nspname = 'public' AND t.typtype = 'e';

SELECT 'public_functions' AS check, count(*)
FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
WHERE n.nspname = 'public';

SELECT 'auth_users' AS check, count(*)
FROM auth.users;

SELECT 'app_buckets' AS check, count(*)
FROM storage.buckets
WHERE id IN ('avatars', 'oku-documents', 'organization-documents');

SELECT 'app_storage_objects' AS check, count(*)
FROM storage.objects
WHERE bucket_id IN ('avatars', 'oku-documents', 'organization-documents');

SELECT 'app_storage_policies' AS check, count(*)
FROM pg_policies
WHERE schemaname = 'storage' AND tablename = 'objects'
  AND concat(qual, with_check) ~ '(avatars|oku-documents|organization-documents)';

SELECT 'app_auth_triggers' AS check, count(*)
FROM pg_trigger
WHERE tgrelid = 'auth.users'::regclass AND NOT tgisinternal
  AND tgname IN ('on_auth_user_created', 'on_auth_user_confirmed');
