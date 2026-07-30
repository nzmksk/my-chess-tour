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
INSERT INTO storage.buckets (id, name, public)
VALUES ('oku-documents', 'oku-documents', false)
ON CONFLICT (id) DO NOTHING;

-- Owner can upload their own OKU document.
CREATE POLICY "Users can upload own OKU document"
ON storage.objects FOR INSERT
TO authenticated
WITH CHECK (
  bucket_id = 'oku-documents'
  AND (storage.foldername(name))[1] = 'users'
  AND (storage.foldername(name))[2] = app_user_id()::text
);

-- Owner can replace/delete their own OKU document (re-upload after rejection).
CREATE POLICY "Users can delete own OKU document"
ON storage.objects FOR DELETE
TO authenticated
USING (
  bucket_id = 'oku-documents'
  AND (storage.foldername(name))[1] = 'users'
  AND (storage.foldername(name))[2] = app_user_id()::text
);

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
