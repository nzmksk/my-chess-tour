-- =============================================
-- #374: the name an organization's payouts must be paid to.
--
-- CHIP Send only checks that a payout account number exists. It does not check
-- the holder name; it returns the bank's holder name instead (#551). The bank's
-- name is matched against a name the organization can't change on its own, so
-- an account in someone else's name is held back for review.
-- organizations.name doesn't work for this: it's a display name, editable after
-- approval. So the application now asks for the REGISTERED name:
--   company / society -> the name on the SSM / ROS registration
--   individual        -> the name on the identity document
-- The admin checks it against the KYB documents when reviewing the application.
-- Like entity_type and registration_number it's set at application (and on a
-- resubmission of a rejected one) and never edited after that.
--
-- Its own table, not a column on organizations: that table's public SELECT
-- policy has no column restriction, and an individual organizer's legal name is
-- personal data, not public record. Server-only, like
-- organization_application_events.
--
-- Organizations that applied before this have no row. Their payout accounts are
-- matched against the submitted account holder instead
-- (src/services/payouts/holder-name.ts).
--
-- p_registered_name is a trailing optional parameter on both application
-- functions, so the app version deployed while this migration runs keeps
-- working. The route requires it.
-- =============================================

CREATE TABLE organization_registered_names (
  organization_id uuid PRIMARY KEY REFERENCES organizations(id) ON DELETE CASCADE,
  registered_name varchar(255) NOT NULL,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT chk_registered_name_not_blank CHECK (btrim(registered_name) <> '')
);

CREATE TRIGGER set_updated_at BEFORE UPDATE ON organization_registered_names
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

ALTER TABLE organization_registered_names ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON organization_registered_names FROM anon, authenticated;

-- Records p_name as the organization's registered name, or leaves it untouched
-- when p_name is blank.
CREATE OR REPLACE FUNCTION set_organization_registered_name(
  p_org_id uuid,
  p_name   varchar(255)
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_name varchar(255) := NULLIF(btrim(p_name), '');
BEGIN
  IF v_name IS NULL THEN
    RETURN;
  END IF;

  INSERT INTO organization_registered_names (organization_id, registered_name)
    VALUES (p_org_id, v_name)
    ON CONFLICT (organization_id) DO UPDATE SET registered_name = EXCLUDED.registered_name;
END;
$$;

-- =============================================
-- CREATE ORGANIZATION APPLICATION
-- As in 20261120165346_amend_rejected_org_application.sql, plus
-- p_registered_name.
-- =============================================
DROP FUNCTION create_organization_application(
  uuid, varchar, varchar, org_entity_type, varchar, varchar, varchar, varchar, varchar,
  jsonb, text, jsonb, varchar, text, varchar
);

CREATE FUNCTION create_organization_application(
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
  p_registration_number varchar(100) DEFAULT NULL,
  p_registered_name     varchar(255) DEFAULT NULL
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
-- As in 20261120165346_amend_rejected_org_application.sql, plus
-- p_registered_name. A blank one keeps the registered name already on file.
-- =============================================
DROP FUNCTION resubmit_organization_application(
  uuid, uuid, varchar, varchar, org_entity_type, varchar, boolean, uuid[], jsonb,
  varchar, varchar, varchar, varchar, text, jsonb, varchar, text, varchar
);

CREATE FUNCTION resubmit_organization_application(
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
  p_registration_number varchar(100) DEFAULT NULL,
  p_registered_name     varchar(255) DEFAULT NULL
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

  PERFORM set_organization_registered_name(p_org_id, p_registered_name);

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
-- EXECUTE PRIVILEGES (see the block at the end of 003_functions_triggers.sql)
-- =============================================
REVOKE EXECUTE ON FUNCTION set_organization_registered_name  FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION create_organization_application   FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION resubmit_organization_application FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION set_organization_registered_name  TO service_role;
GRANT EXECUTE ON FUNCTION create_organization_application   TO service_role;
GRANT EXECUTE ON FUNCTION resubmit_organization_application TO service_role;
