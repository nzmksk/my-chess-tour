-- =============================================
-- AVATARS BUCKET
-- Upload convention:
--   users:         avatars/users/{user_id}/{filename}
--   organizations: avatars/organizations/{org_id}/{filename}
-- =============================================
INSERT INTO storage.buckets (id, name, public)
VALUES ('avatars', 'avatars', true)
ON CONFLICT (id) DO NOTHING;

-- Anyone can read avatars (public bucket)
CREATE POLICY "Avatars are publicly readable"
ON storage.objects FOR SELECT
TO public
USING (bucket_id = 'avatars');

-- Users can upload their own avatar
CREATE POLICY "Users can manage own avatar"
ON storage.objects FOR INSERT
TO authenticated
WITH CHECK (
  bucket_id = 'avatars'
  AND (storage.foldername(name))[1] = 'users'
  AND (storage.foldername(name))[2] = app_user_id()::text
);

-- Users can delete their own avatar
CREATE POLICY "Users can delete own avatar"
ON storage.objects FOR DELETE
TO authenticated
USING (
  bucket_id = 'avatars'
  AND (storage.foldername(name))[1] = 'users'
  AND (storage.foldername(name))[2] = app_user_id()::text
);

-- Org members with org.manage permission can upload org avatar
CREATE POLICY "Org managers can manage org avatar"
ON storage.objects FOR INSERT
TO authenticated
WITH CHECK (
  bucket_id = 'avatars'
  AND (storage.foldername(name))[1] = 'organizations'
  AND has_org_permission(app_user_id(), ((storage.foldername(name))[2])::uuid, 'org.manage')
);

-- Org members with org.manage permission can delete org avatar
CREATE POLICY "Org managers can delete org avatar"
ON storage.objects FOR DELETE
TO authenticated
USING (
  bucket_id = 'avatars'
  AND (storage.foldername(name))[1] = 'organizations'
  AND has_org_permission(app_user_id(), ((storage.foldername(name))[2])::uuid, 'org.manage')
);

-- =============================================
-- OKU DOCUMENTS BUCKET (private)
-- Upload convention: oku-documents/users/{user_id}/oku/{filename}
-- Sensitive government IDs — NOT public. Read only by the owner or a platform
-- admin (who views via a server-generated signed URL).
-- =============================================
-- file_size_limit and allowed_mime_types make Storage itself reject an
-- oversized or unsupported upload, so the API's assertUploadedObject check is a
-- second line rather than the only one. They mirror the route's constants
-- (5MB; png/jpeg/webp/pdf). DO UPDATE so the limits also land on a bucket row
-- that already exists. The type is still the one the client declares, not
-- sniffed from the bytes.
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'oku-documents', 'oku-documents', false, 5242880,
  ARRAY['image/png', 'image/jpeg', 'image/webp', 'application/pdf']
)
ON CONFLICT (id) DO UPDATE
  SET file_size_limit    = EXCLUDED.file_size_limit,
      allowed_mime_types = EXCLUDED.allowed_mime_types;

-- Owner can upload their own OKU document.
CREATE POLICY "Users can upload own OKU document"
ON storage.objects FOR INSERT
TO authenticated
WITH CHECK (
  bucket_id = 'oku-documents'
  AND (storage.foldername(name))[1] = 'users'
  AND (storage.foldername(name))[2] = app_user_id()::text
);

-- No DELETE (or UPDATE) policy, deliberately. With INSERT alone an object
-- cannot change once it exists: an upload to a taken name fails, and there is
-- no way to remove it first. That matters because the API validates the object
-- (assertUploadedObject) once, when its path is registered, and the admin's
-- signed URL later serves whatever sits at that path. Delete-then-reupload
-- under the same name would swap in a file that never passed that check.
-- The client never needs to delete: every upload, including a re-upload after
-- rejection, goes to a fresh timestamped path.

-- Owner or a platform admin can read OKU documents.
CREATE POLICY "OKU documents readable by owner or admin"
ON storage.objects FOR SELECT
TO authenticated
USING (
  bucket_id = 'oku-documents'
  AND (
    (storage.foldername(name))[2] = app_user_id()::text
    OR has_global_permission(app_user_id(), 'platform.manage')
  )
);

-- =============================================
-- ORGANIZATION DOCUMENTS BUCKET (private)
-- Upload convention: organization-documents/users/{user_id}/org-kyb/{uuid}.{ext}
-- Business-verification documents (SSM/ROS extracts, authorization letters,
-- identity documents). NOT public. Read only by the uploader or a platform
-- admin, who views via a server-generated signed URL.
--
-- USER-scoped, not org-scoped like the avatars bucket, because at upload time
-- the organization row DOES NOT EXIST YET — the application POST is what
-- creates it, and it does so in the same transaction that registers these
-- paths. An org-scoped policy would have nothing to check against. That makes
-- these policies a verbatim copy of the oku-documents ones above, which is the
-- whole reason to prefer this shape.
--
-- The path prefix is re-checked server-side when a path is registered (see
-- src/app/api/v1/organizations/applications/validators.ts): storage RLS stops a
-- user WRITING outside their folder, but only the API can stop them CLAIMING
-- someone else's path as their document.
-- =============================================
-- Same limits and reasoning as oku-documents above.
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'organization-documents', 'organization-documents', false, 5242880,
  ARRAY['image/png', 'image/jpeg', 'image/webp', 'application/pdf']
)
ON CONFLICT (id) DO UPDATE
  SET file_size_limit    = EXCLUDED.file_size_limit,
      allowed_mime_types = EXCLUDED.allowed_mime_types;

-- Uploader can add their own KYB document.
CREATE POLICY "Users can upload own org document"
ON storage.objects FOR INSERT
TO authenticated
WITH CHECK (
  bucket_id = 'organization-documents'
  AND (storage.foldername(name))[1] = 'users'
  AND (storage.foldername(name))[2] = app_user_id()::text
);

-- No DELETE policy, for the same reason as oku-documents: a registered KYB
-- document must stay the object that passed validation until an admin has
-- reviewed it.

-- Uploader or a platform admin can read KYB documents.
CREATE POLICY "Org documents readable by uploader or admin"
ON storage.objects FOR SELECT
TO authenticated
USING (
  bucket_id = 'organization-documents'
  AND (
    (storage.foldername(name))[2] = app_user_id()::text
    OR has_global_permission(app_user_id(), 'platform.manage')
  )
);
