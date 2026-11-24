-- =============================================
-- #671: an organization application no longer asks for a bank account.
--
-- An applicant gave their payout account up front, before anyone had checked
-- the organization. A reporter asked for it to wait until approval, and there
-- is no reason to hold an unapproved applicant's account number: it is only
-- registered with CHIP Send on approval anyway. An approved organization adds
-- its payout account in its settings (PUT /api/v1/organizations/[orgId]/
-- bank-account), which already existed, and the dashboard asks for it until
-- one is on file.
--
-- create_organization_application and resubmit_organization_application no
-- longer touch organization_bank_accounts. Otherwise they are as in
-- 20261122090000_organization_registered_name.sql.
--
-- The bank parameters stay, moved to the end as optional and IGNORED, so the
-- app version deployed while this migration runs can still submit: PostgREST
-- matches a function by the names of the arguments it is called with. A later
-- migration can drop them once no deployed version sends them.
--
-- Existing applications are left as they are. A pending application that came
-- with an account keeps it, and approving it still registers it with CHIP
-- Send. A rejected application's account was deactivated when it was rejected
-- and is no longer reactivated on resubmission; once approved, the
-- organization adds an account in its settings like any other.
--
-- BANK_ACCOUNT_IN_USE and BANK_ACCOUNT_REQUIRED are no longer raised here.
-- set_organization_bank_account still enforces one active destination per
-- account for the settings route.
-- =============================================

DROP FUNCTION create_organization_application(
  uuid, varchar, varchar, org_entity_type, varchar, varchar, varchar, varchar, varchar,
  jsonb, text, jsonb, varchar, text, varchar, varchar
);

CREATE FUNCTION create_organization_application(
  p_created_by          uuid,
  p_name                varchar(255),
  p_email               varchar(255),
  p_entity_type         org_entity_type,
  p_agreement_version   varchar(20),
  p_documents           jsonb,
  p_description         text    DEFAULT NULL,
  p_links               jsonb   DEFAULT NULL,
  p_phone               varchar(20) DEFAULT NULL,
  p_past_tournament_refs text   DEFAULT NULL,
  p_registration_number varchar(100) DEFAULT NULL,
  p_registered_name     varchar(255) DEFAULT NULL,
  p_bank_code           varchar(11)  DEFAULT NULL,
  p_bank_name           varchar(100) DEFAULT NULL,
  p_account_holder      varchar(255) DEFAULT NULL,
  p_account_number      varchar(50)  DEFAULT NULL
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

  PERFORM set_organization_registered_name(v_org_id, p_registered_name);

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

DROP FUNCTION resubmit_organization_application(
  uuid, uuid, varchar, varchar, org_entity_type, varchar, boolean, uuid[], jsonb,
  varchar, varchar, varchar, varchar, text, jsonb, varchar, text, varchar, varchar
);

CREATE FUNCTION resubmit_organization_application(
  p_org_id              uuid,
  p_user_id             uuid,
  p_name                varchar(255),
  p_email               varchar(255),
  p_entity_type         org_entity_type,
  p_agreement_version   varchar(20),
  p_keep_document_ids   uuid[],
  p_new_documents       jsonb,
  p_description         text    DEFAULT NULL,
  p_links               jsonb   DEFAULT NULL,
  p_phone               varchar(20) DEFAULT NULL,
  p_past_tournament_refs text   DEFAULT NULL,
  p_registration_number varchar(100) DEFAULT NULL,
  p_registered_name     varchar(255) DEFAULT NULL,
  p_keep_bank_account   boolean      DEFAULT NULL,
  p_bank_code           varchar(11)  DEFAULT NULL,
  p_bank_name           varchar(100) DEFAULT NULL,
  p_account_holder      varchar(255) DEFAULT NULL,
  p_account_number      varchar(50)  DEFAULT NULL
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

  PERFORM set_organization_registered_name(p_org_id, p_registered_name);

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

REVOKE EXECUTE ON FUNCTION create_organization_application   FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION resubmit_organization_application FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION create_organization_application   TO service_role;
GRANT EXECUTE ON FUNCTION resubmit_organization_application TO service_role;
