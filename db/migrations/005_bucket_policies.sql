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
  AND (storage.foldername(name))[2] = auth.uid()::text
);

-- Users can delete their own avatar
CREATE POLICY "Users can delete own avatar"
ON storage.objects FOR DELETE
TO authenticated
USING (
  bucket_id = 'avatars'
  AND (storage.foldername(name))[1] = 'users'
  AND (storage.foldername(name))[2] = auth.uid()::text
);

-- Org members with org.manage permission can upload org avatar
CREATE POLICY "Org managers can manage org avatar"
ON storage.objects FOR INSERT
TO authenticated
WITH CHECK (
  bucket_id = 'avatars'
  AND (storage.foldername(name))[1] = 'organizations'
  AND has_org_permission(auth.uid(), ((storage.foldername(name))[2])::uuid, 'org.manage')
);

-- Org members with org.manage permission can delete org avatar
CREATE POLICY "Org managers can delete org avatar"
ON storage.objects FOR DELETE
TO authenticated
USING (
  bucket_id = 'avatars'
  AND (storage.foldername(name))[1] = 'organizations'
  AND has_org_permission(auth.uid(), ((storage.foldername(name))[2])::uuid, 'org.manage')
);
