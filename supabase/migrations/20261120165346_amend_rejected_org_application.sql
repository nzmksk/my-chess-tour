-- =============================================
-- #582: a rejected organizer applicant amends their application and resubmits
-- it, and an organization name is only taken once it is approved.
--
--   1. Name uniqueness: idx_organizations_name_active now covers APPROVED
--      organizations only. Any number of pending or rejected applications may
--      share a name; the first to be approved takes it, and approving another
--      with the same name raises NAME_TAKEN (the admin rejects it, and the
--      applicant amends the name).
--   2. Amend and resubmit: resubmit_organization_application edits the rejected
--      application in place and sends it back to 'pending'. The applicant keeps
--      or replaces the payout account and each document, and accepts the current
--      Organizer Agreement again.
--   3. Review history: organization_application_events records every
--      submission, resubmission and review decision, so overwriting a rejection
--      on resubmit doesn't lose it. The admin review page lists it.
--
-- Rejecting still deactivates the application's payout account, so the account
-- isn't held by an application that may never come back
-- (uniq_active_bank_destination). Resubmitting registers it again.
-- An admin still cannot approve a rejected application directly: the applicant
-- has to resubmit it first, which puts it back in the review queue.
-- =============================================

-- 1. Name uniqueness among approved organizations only.
DROP INDEX idx_organizations_name_active;
CREATE UNIQUE INDEX idx_organizations_name_active ON organizations (lower(name))
  WHERE deleted_at IS NULL AND approval_status = 'approved';

-- Free the payout accounts of applications already rejected. They were never
-- registered with CHIP Send (that happens on approval), so there is nothing to
-- undo there.
UPDATE organization_bank_accounts b
   SET is_active = false
  FROM organizations o
 WHERE b.organization_id = o.id
   AND b.is_active
   AND o.approval_status = 'rejected';

-- =============================================
-- ORGANIZATION APPLICATION EVENTS
-- One row per submission, resubmission and review decision on an application.
-- organizations holds only the latest state (a resubmission clears the
-- rejection), so this is where an application's history lives.
-- Server-only: written by the application functions, read by the admin review
-- page through the service role.
-- =============================================
CREATE TYPE org_application_event AS ENUM ('submitted', 'resubmitted', 'approved', 'rejected');

CREATE TABLE organization_application_events (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  event           org_application_event NOT NULL,
  reason          text,                    -- the rejection reason, on 'rejected'
  actor_id        uuid REFERENCES users(id) ON DELETE SET NULL,
  created_at      timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT chk_application_event_reason CHECK (reason IS NULL OR event = 'rejected')
);

CREATE INDEX idx_org_application_events_org
  ON organization_application_events (organization_id, created_at);

ALTER TABLE organization_application_events ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON organization_application_events FROM anon, authenticated;

-- Backfill: each existing application's submission, and its latest review.
INSERT INTO organization_application_events (organization_id, event, actor_id, created_at)
SELECT id, 'submitted', created_by, created_at
  FROM organizations;

INSERT INTO organization_application_events (organization_id, event, reason, actor_id, created_at)
SELECT id,
       approval_status::text::org_application_event,
       CASE WHEN approval_status = 'rejected' THEN rejection_reason END,
       reviewed_by,
       reviewed_at
  FROM organizations
 WHERE reviewed_at IS NOT NULL
   AND approval_status IN ('approved', 'rejected');

-- =============================================
-- ORGANIZATION APPLICATION RULES
-- Shared by create_organization_application and
-- resubmit_organization_application, so a first submission and a resubmission
-- can't drift apart.
-- =============================================

-- Raises NAME_TAKEN if an approved organization other than p_except_org_id
-- already uses p_name (case-insensitive). A pending or rejected one doesn't
-- count. Not a race guard on its own: two approvals of the same name are
-- stopped by idx_organizations_name_active.
CREATE OR REPLACE FUNCTION assert_org_name_available(
  p_name          varchar(255),
  p_except_org_id uuid DEFAULT NULL
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM organizations
     WHERE lower(name) = lower(p_name)
       AND approval_status = 'approved'
       AND deleted_at IS NULL
       AND id IS DISTINCT FROM p_except_org_id
  ) THEN
    RAISE EXCEPTION 'NAME_TAKEN: an approved organization already uses this name'
      USING ERRCODE = 'P0001';
  END IF;
END;
$$;

-- Normalises the registration number and checks the documents match the
-- entity, raising ENTITY_DOCS_REQUIRED otherwise. p_doc_types is the full set
-- of document types the application will hold.
CREATE OR REPLACE FUNCTION assert_org_entity_documents(
  p_entity_type         org_entity_type,
  p_registration_number varchar(100),
  p_doc_types           text[]
)
RETURNS varchar(100)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_reg_no varchar(100);
BEGIN
  IF p_entity_type IS NULL THEN
    RAISE EXCEPTION 'ENTITY_DOCS_REQUIRED: an entity type is required'
      USING ERRCODE = 'P0001';
  END IF;

  IF p_entity_type IN ('company', 'society') THEN
    v_reg_no := NULLIF(btrim(p_registration_number), '');

    IF v_reg_no IS NULL THEN
      RAISE EXCEPTION 'ENTITY_DOCS_REQUIRED: a % must supply its registration number', p_entity_type
        USING ERRCODE = 'P0001';
    END IF;

    -- The registry that matches the entity, not either one: a company is
    -- registered with SSM and a society with ROS.
    IF NOT (CASE p_entity_type WHEN 'company' THEN 'ssm' ELSE 'ros' END = ANY (COALESCE(p_doc_types, '{}'))) THEN
      RAISE EXCEPTION 'ENTITY_DOCS_REQUIRED: a % must supply an % document',
        p_entity_type,
        CASE p_entity_type WHEN 'company' THEN 'SSM' ELSE 'ROS' END
        USING ERRCODE = 'P0001';
    END IF;
  ELSE
    -- An individual has no registry entry to cite. Normalised to NULL rather
    -- than rejected, so the column means exactly one thing.
    v_reg_no := NULL;

    IF NOT (COALESCE(p_doc_types, '{}') && ARRAY['identity_document', 'authorization_letter']) THEN
      RAISE EXCEPTION 'ENTITY_DOCS_REQUIRED: an individual organizer must supply an identity document or authorization letter'
        USING ERRCODE = 'P0001';
    END IF;
  END IF;

  RETURN v_reg_no;
END;
$$;

-- =============================================
-- CREATE ORGANIZATION APPLICATION
-- Creates the organization, its payout bank account, its KYB document rows and
-- its agreement stamp in ONE transaction, all or nothing.
--
-- The name only has to be free of APPROVED organizations (#582): a pending or
-- rejected application with the same name doesn't block this one.
--
-- Failures RAISE with a stable sentinel prefix so the route can map them to
-- distinct HTTP codes.
-- =============================================
CREATE OR REPLACE FUNCTION create_organization_application(
  p_created_by          uuid,
  p_name                varchar(255),
  p_email               varchar(255),
  p_entity_type         org_entity_type,
  p_agreement_version   varchar(20),
  p_bank_code           varchar(11),
  p_bank_name           varchar(100),
  p_account_holder      varchar(255),
  p_account_number      varchar(50),
  p_documents           jsonb,
  p_description         text    DEFAULT NULL,
  p_links               jsonb   DEFAULT NULL,
  p_phone               varchar(20) DEFAULT NULL,
  p_past_tournament_refs text   DEFAULT NULL,
  p_registration_number varchar(100) DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_org_id    uuid;
  v_docs      jsonb := COALESCE(p_documents, '[]'::jsonb);
  v_reg_no    varchar(100);
  v_accepted  timestamptz := now();
BEGIN
  v_reg_no := assert_org_entity_documents(
    p_entity_type,
    p_registration_number,
    ARRAY(SELECT d->>'doc_type' FROM jsonb_array_elements(v_docs) d)
  );

  PERFORM assert_org_name_available(p_name);

  INSERT INTO organizations (
    name, description, links, email, phone, past_tournament_refs,
    entity_type, registration_number, created_by,
    agreement_version, agreement_accepted_at, agreement_accepted_by
  ) VALUES (
    p_name, p_description, p_links, p_email, p_phone, p_past_tournament_refs,
    p_entity_type, v_reg_no, p_created_by,
    p_agreement_version, v_accepted, p_created_by
  )
  RETURNING id INTO v_org_id;

  BEGIN
    PERFORM set_organization_bank_account(
      v_org_id, p_bank_code, p_bank_name, p_account_holder, p_account_number, p_created_by
    );
  EXCEPTION
    WHEN unique_violation THEN
      -- uniq_active_bank_destination (002_indexes.sql).
      RAISE EXCEPTION 'BANK_ACCOUNT_IN_USE: this bank account is already the payout destination for another organization'
        USING ERRCODE = 'P0001';
  END;

  INSERT INTO organization_documents (
    organization_id, doc_type, storage_path, original_filename, uploaded_by
  )
  SELECT
    v_org_id,
    (d->>'doc_type')::org_document_type,
    d->>'storage_path',
    NULLIF(d->>'original_filename', ''),
    p_created_by
  FROM jsonb_array_elements(v_docs) d;

  INSERT INTO organization_application_events (organization_id, event, actor_id, created_at)
    VALUES (v_org_id, 'submitted', p_created_by, v_accepted);

  RETURN jsonb_build_object(
    'id',                    v_org_id,
    'name',                  p_name,
    'approval_status',       'pending',
    'entity_type',           p_entity_type,
    'registration_number',   v_reg_no,
    'agreement_version',     p_agreement_version,
    'agreement_accepted_at', v_accepted
  );
END;
$$;

-- =============================================
-- RESUBMIT ORGANIZATION APPLICATION (#582)
-- The applicant amends their REJECTED application and sends it back for
-- review, in one transaction:
--   * every field is replaced by what they submit;
--   * the payout account is either kept (p_keep_bank_account: the latest
--     account on the application is registered again, so its number never has
--     to leave the database) or replaced by the one given;
--   * documents in p_keep_document_ids stay, the application's other documents
--     are removed, and p_new_documents are added. The removed rows' storage
--     paths are returned so the route can delete the files: Supabase doesn't
--     allow deleting storage objects from SQL;
--   * the Organizer Agreement is stamped again at p_agreement_version;
--   * the status goes back to 'pending' and the rejection is cleared, with the
--     resubmission recorded in organization_application_events (the rejection
--     already is).
--
-- Refuses with:
--   APPLICATION_NOT_FOUND    (P0002) no such application created by p_user_id
--   APPLICATION_NOT_REJECTED (P0001) only a rejected application is amended
--   NAME_TAKEN, ENTITY_DOCS_REQUIRED, BANK_ACCOUNT_IN_USE as on creation
--   BANK_ACCOUNT_REQUIRED    (P0001) asked to keep an account it never had
--   TOO_MANY_DOCUMENTS       (P0001) more than 10 documents after the change
-- =============================================
CREATE OR REPLACE FUNCTION resubmit_organization_application(
  p_org_id              uuid,
  p_user_id             uuid,
  p_name                varchar(255),
  p_email               varchar(255),
  p_entity_type         org_entity_type,
  p_agreement_version   varchar(20),
  p_keep_bank_account   boolean,
  p_keep_document_ids   uuid[],
  p_new_documents       jsonb,
  p_bank_code           varchar(11)  DEFAULT NULL,
  p_bank_name           varchar(100) DEFAULT NULL,
  p_account_holder      varchar(255) DEFAULT NULL,
  p_account_number      varchar(50)  DEFAULT NULL,
  p_description         text    DEFAULT NULL,
  p_links               jsonb   DEFAULT NULL,
  p_phone               varchar(20) DEFAULT NULL,
  p_past_tournament_refs text   DEFAULT NULL,
  p_registration_number varchar(100) DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_org        organizations;
  v_keep       uuid[] := COALESCE(p_keep_document_ids, '{}');
  v_new_docs   jsonb  := COALESCE(p_new_documents, '[]'::jsonb);
  v_doc_types  text[];
  v_doc_count  integer;
  v_reg_no     varchar(100);
  v_bank       organization_bank_accounts;
  v_removed    text[];
  v_now        timestamptz := now();
BEGIN
  SELECT * INTO v_org
    FROM organizations
    WHERE id = p_org_id AND created_by = p_user_id AND deleted_at IS NULL
    FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'APPLICATION_NOT_FOUND: no such application' USING ERRCODE = 'P0002';
  END IF;

  IF v_org.approval_status <> 'rejected' THEN
    RAISE EXCEPTION 'APPLICATION_NOT_REJECTED: only a rejected application can be amended'
      USING ERRCODE = 'P0001';
  END IF;

  -- Kept documents must be this application's own. Anything else in the list
  -- is ignored rather than adopted from another application.
  SELECT COALESCE(array_agg(doc_type::text), '{}'), count(*)
    INTO v_doc_types, v_doc_count
    FROM organization_documents
    WHERE organization_id = p_org_id AND id = ANY (v_keep);

  v_doc_types := v_doc_types
    || ARRAY(SELECT d->>'doc_type' FROM jsonb_array_elements(v_new_docs) d);
  v_doc_count := v_doc_count + jsonb_array_length(v_new_docs);

  IF v_doc_count > 10 THEN
    RAISE EXCEPTION 'TOO_MANY_DOCUMENTS: at most 10 documents can be submitted'
      USING ERRCODE = 'P0001';
  END IF;

  v_reg_no := assert_org_entity_documents(p_entity_type, p_registration_number, v_doc_types);

  PERFORM assert_org_name_available(p_name, p_org_id);

  UPDATE organizations
    SET name                  = p_name,
        description           = p_description,
        links                 = p_links,
        email                 = p_email,
        phone                 = p_phone,
        past_tournament_refs  = p_past_tournament_refs,
        entity_type           = p_entity_type,
        registration_number   = v_reg_no,
        agreement_version     = p_agreement_version,
        agreement_accepted_at = v_now,
        agreement_accepted_by = p_user_id,
        approval_status       = 'pending',
        rejection_reason      = NULL,
        reviewed_by           = NULL,
        reviewed_at           = NULL
    WHERE id = p_org_id;

  -- Payout account. Rejecting deactivated it, so either way this registers an
  -- active one again.
  IF p_keep_bank_account THEN
    SELECT * INTO v_bank
      FROM organization_bank_accounts
      WHERE organization_id = p_org_id
      ORDER BY created_at DESC
      LIMIT 1;

    IF NOT FOUND THEN
      RAISE EXCEPTION 'BANK_ACCOUNT_REQUIRED: this application has no bank account to keep'
        USING ERRCODE = 'P0001';
    END IF;
  END IF;

  BEGIN
    IF p_keep_bank_account THEN
      PERFORM set_organization_bank_account(
        p_org_id, v_bank.bank_code, v_bank.bank_name, v_bank.account_holder,
        v_bank.account_number, p_user_id
      );
    ELSE
      PERFORM set_organization_bank_account(
        p_org_id, p_bank_code, p_bank_name, p_account_holder, p_account_number, p_user_id
      );
    END IF;
  EXCEPTION
    WHEN unique_violation THEN
      RAISE EXCEPTION 'BANK_ACCOUNT_IN_USE: this bank account is already the payout destination for another organization'
        USING ERRCODE = 'P0001';
  END;

  WITH removed AS (
    DELETE FROM organization_documents
      WHERE organization_id = p_org_id AND NOT (id = ANY (v_keep))
      RETURNING storage_path
  )
  SELECT COALESCE(array_agg(storage_path), '{}') INTO v_removed FROM removed;

  INSERT INTO organization_documents (
    organization_id, doc_type, storage_path, original_filename, uploaded_by
  )
  SELECT
    p_org_id,
    (d->>'doc_type')::org_document_type,
    d->>'storage_path',
    NULLIF(d->>'original_filename', ''),
    p_user_id
  FROM jsonb_array_elements(v_new_docs) d;

  INSERT INTO organization_application_events (organization_id, event, actor_id, created_at)
    VALUES (p_org_id, 'resubmitted', p_user_id, v_now);

  RETURN jsonb_build_object(
    'id',                    p_org_id,
    'name',                  p_name,
    'approval_status',       'pending',
    'entity_type',           p_entity_type,
    'registration_number',   v_reg_no,
    'agreement_version',     p_agreement_version,
    'agreement_accepted_at', v_now,
    'removed_storage_paths', to_jsonb(v_removed)
  );
END;
$$;

-- =============================================
-- REVIEW ORGANIZATION APPLICATION
-- Called by the admin applications handler (service_role) to approve or reject
-- an organization application. Performs the status update and, on approval, the
-- creation of the applicant's owner membership atomically in one transaction:
--   p_action = 'approve' -> approval_status 'approved' + owner membership row
--   p_action = 'reject'  -> approval_status 'rejected' + rejection_reason set,
--                           and the application's bank account deactivated
-- Every decision is recorded in organization_application_events.
-- Re-approving is idempotent: the owner membership is created at most once.
-- Refuses with:
--   APPLICATION_REJECTED (P0001) approving a rejected application: the
--                        applicant amends and resubmits it first (#582)
--   NAME_TAKEN           (P0001) approving while another approved organization
--                        has the same name: reject it so the applicant can
--                        amend the name
-- =============================================
CREATE OR REPLACE FUNCTION review_organization_application(
  p_org_id            uuid,
  p_reviewer_id       uuid,
  p_action            text,
  p_rejection_reason  text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_org           organizations;
  v_owner_role_id integer;
  v_new_status    approval_status;
  v_reviewed_at   timestamptz := now();
BEGIN
  -- Lock the organization row so concurrent reviews serialize.
  SELECT * INTO v_org
    FROM organizations
    WHERE id = p_org_id AND deleted_at IS NULL
    FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'organization % not found', p_org_id USING ERRCODE = 'P0002';
  END IF;

  -- Its payout account was released when it was rejected, and the applicant
  -- may be part-way through amending it.
  IF p_action = 'approve' AND v_org.approval_status = 'rejected' THEN
    RAISE EXCEPTION 'APPLICATION_REJECTED: a rejected application cannot be approved; the applicant must amend and resubmit it'
      USING ERRCODE = 'P0001';
  END IF;

  v_new_status := CASE p_action WHEN 'approve' THEN 'approved' ELSE 'rejected' END;

  BEGIN
    UPDATE organizations
      SET approval_status  = v_new_status,
          reviewed_by      = p_reviewer_id,
          reviewed_at      = v_reviewed_at,
          rejection_reason = CASE WHEN p_action = 'reject' THEN p_rejection_reason ELSE NULL END
      WHERE id = p_org_id;
  EXCEPTION
    WHEN unique_violation THEN
      -- idx_organizations_name_active: another organization with this name
      -- was approved first.
      RAISE EXCEPTION 'NAME_TAKEN: an approved organization already uses this name'
        USING ERRCODE = 'P0001';
  END;

  IF p_action = 'approve' THEN
    SELECT id INTO v_owner_role_id
      FROM roles
      WHERE name = 'owner' AND scope = 'organization';

    IF v_owner_role_id IS NULL THEN
      RAISE EXCEPTION 'owner role not found';
    END IF;

    INSERT INTO organization_memberships (organization_id, user_id, role_id)
      VALUES (p_org_id, v_org.created_by, v_owner_role_id)
      ON CONFLICT (organization_id, user_id) DO NOTHING;
  ELSE
    -- Frees the destination while the application is out of review
    -- (uniq_active_bank_destination). Never registered with CHIP Send: that
    -- only happens on approval. A resubmission registers it again.
    UPDATE organization_bank_accounts
      SET is_active = false
      WHERE organization_id = p_org_id AND is_active;
  END IF;

  INSERT INTO organization_application_events (organization_id, event, reason, actor_id, created_at)
    VALUES (
      p_org_id,
      v_new_status::text::org_application_event,
      CASE WHEN p_action = 'reject' THEN p_rejection_reason END,
      p_reviewer_id,
      v_reviewed_at
    );

  RETURN jsonb_build_object(
    'id', v_org.id,
    'name', v_org.name,
    'approval_status', v_new_status,
    'reviewed_at', v_reviewed_at
  );
END;
$$;

-- =============================================
-- EXECUTE PRIVILEGES (see the block at the end of 003_functions_triggers.sql)
-- =============================================
REVOKE EXECUTE ON FUNCTION assert_org_name_available         FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION assert_org_entity_documents       FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION resubmit_organization_application FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION assert_org_name_available         TO service_role;
GRANT EXECUTE ON FUNCTION assert_org_entity_documents       TO service_role;
GRANT EXECUTE ON FUNCTION resubmit_organization_application TO service_role;
