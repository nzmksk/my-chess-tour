-- Fix infinite recursion in the organizer_members SELECT policy.
--
-- The original policy checked membership by querying organizer_members
-- from within organizer_members' own RLS policy, causing infinite
-- recursion. Replace it with get_org_role(), which is SECURITY DEFINER
-- and therefore bypasses RLS when it reads organizer_members.

DROP POLICY IF EXISTS "Members can view org members" ON organizer_members;

CREATE POLICY "Members can view org members"
ON organizer_members FOR SELECT
USING (
  get_org_role(auth.uid(), organizer_id) IS NOT NULL
);
 and 
