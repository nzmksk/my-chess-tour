CREATE POLICY "Public poster read access"
ON storage.objects FOR SELECT
USING (bucket_id = 'posters');

-- Upload convention: When uploading from your app,
-- use the user's ID as a folder prefix: {userId}/{uuid}.jpg.
-- This way the delete policy correctly scopes access.
CREATE POLICY "Authenticated users can upload posters"
ON storage.objects FOR INSERT
WITH CHECK (
  bucket_id = 'posters'
  AND auth.role() = 'authenticated'
);

CREATE POLICY "Users can delete own uploads"
ON storage.objects FOR DELETE
USING (
  bucket_id = 'posters'
  AND auth.uid()::text = (storage.foldername(name))[1]
);
