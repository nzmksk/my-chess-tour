-- =============================================================================
-- Regression test: private document buckets are write-once for clients.
--
-- The API validates an uploaded KYB or OKU document (assertUploadedObject: size
-- and declared MIME type) once, when its path is registered. The admin's signed
-- URL later serves whatever sits at that path. A client DELETE policy let the
-- uploader delete the validated object and upload a different one under the
-- same name, so the file an admin reviewed need not be the one that passed the
-- check. 005_bucket_policies.sql now grants clients INSERT only on these
-- buckets, and sets bucket-level limits so Storage rejects bad uploads too.
--
-- Covers:
--   D1  no DELETE, UPDATE or ALL policy on storage.objects mentions either
--       private document bucket
--   D2  each bucket still has its INSERT (upload) and SELECT (read) policy
--   D3  each bucket is private, capped at 5MB, and limited to
--       png/jpeg/webp/pdf, matching the API routes' constants
--
-- HOW TO RUN: paste into the Supabase SQL editor AFTER applying the current
-- migrations. Read-only, inside a transaction that ROLLBACKs. A failing
-- assertion RAISEs; on success it prints "ALL SCENARIOS PASSED" via NOTICE.
-- =============================================================================

BEGIN;

DO $$
DECLARE
  v_buckets   text[] := ARRAY['oku-documents', 'organization-documents'];
  v_bucket    text;
  v_offending text;
  v_cmd       text;
  v_public    boolean;
  v_limit     bigint;
  v_mimes     text[];
BEGIN
  -- ===== D1 ===============================================================
  FOREACH v_bucket IN ARRAY v_buckets LOOP
    SELECT string_agg(format('%s (%s)', policyname, cmd), ', ')
      INTO v_offending
      FROM pg_policies
      WHERE schemaname = 'storage' AND tablename = 'objects'
        AND cmd IN ('DELETE', 'UPDATE', 'ALL')
        AND (coalesce(qual, '') || coalesce(with_check, '')) LIKE '%' || v_bucket || '%';

    IF v_offending IS NOT NULL THEN
      RAISE EXCEPTION 'D1 FAIL: % has client policies that can replace a validated object: %',
        v_bucket, v_offending;
    END IF;
  END LOOP;
  RAISE NOTICE 'D1 PASS — no DELETE/UPDATE policy on either document bucket';

  -- ===== D2 ===============================================================
  FOREACH v_bucket IN ARRAY v_buckets LOOP
    FOREACH v_cmd IN ARRAY ARRAY['INSERT', 'SELECT'] LOOP
      IF NOT EXISTS (
        SELECT 1 FROM pg_policies
        WHERE schemaname = 'storage' AND tablename = 'objects'
          AND cmd = v_cmd
          AND (coalesce(qual, '') || coalesce(with_check, '')) LIKE '%' || v_bucket || '%'
      ) THEN
        RAISE EXCEPTION 'D2 FAIL: % has no % policy — uploads or reads would break',
          v_bucket, v_cmd;
      END IF;
    END LOOP;
  END LOOP;
  RAISE NOTICE 'D2 PASS — upload and read policies still present';

  -- ===== D3 ===============================================================
  FOREACH v_bucket IN ARRAY v_buckets LOOP
    SELECT public, file_size_limit, allowed_mime_types
      INTO v_public, v_limit, v_mimes
      FROM storage.buckets WHERE id = v_bucket;

    IF NOT FOUND THEN
      RAISE EXCEPTION 'D3 FAIL: bucket % does not exist', v_bucket;
    END IF;
    IF v_public THEN
      RAISE EXCEPTION 'D3 FAIL: bucket % is public', v_bucket;
    END IF;
    IF v_limit IS DISTINCT FROM 5242880 THEN
      RAISE EXCEPTION 'D3 FAIL: bucket % file_size_limit is % (expected 5242880)', v_bucket, v_limit;
    END IF;
    IF v_mimes IS NULL
       OR NOT (v_mimes @> ARRAY['image/png', 'image/jpeg', 'image/webp', 'application/pdf']
               AND v_mimes <@ ARRAY['image/png', 'image/jpeg', 'image/webp', 'application/pdf'])
    THEN
      RAISE EXCEPTION 'D3 FAIL: bucket % allowed_mime_types is % (expected png/jpeg/webp/pdf)',
        v_bucket, v_mimes;
    END IF;
  END LOOP;
  RAISE NOTICE 'D3 PASS — both buckets private, 5MB, png/jpeg/webp/pdf';

  RAISE NOTICE 'ALL SCENARIOS PASSED';
END $$;

ROLLBACK;
