-- =============================================================================
-- Migration 006 — Seed Data
-- MY Chess Tour
--
-- Creates: RBAC roles & permissions · 5 organizers · 50 players
--          · 15 tournaments · 200 registrations + payments
--
-- Prerequisites: migrations 001–005 must be applied first.
-- Password for all seed accounts: Password123!
-- =============================================================================

-- Tag all audit log entries created during seeding
SET LOCAL app.audit_context = 'seed';

-- =============================================
-- RBAC: Roles, Permissions, Role-Permission Mappings
-- =============================================
DO $$
DECLARE
  -- Role IDs
  r_platform_admin uuid;
  r_owner          uuid;
  r_admin          uuid;
  r_member         uuid;

  -- Permission IDs
  p_platform_manage  uuid;
  p_org_manage       uuid;
  p_org_invite       uuid;
  p_tournament_create uuid;
  p_tournament_edit   uuid;
  p_tournament_delete uuid;
  p_tournament_view   uuid;
  p_registration_view uuid;
  p_payment_view      uuid;
  p_refund_manage     uuid;
BEGIN
  -- Roles
  INSERT INTO roles (name, scope) VALUES ('platform_admin', 'global') RETURNING id INTO r_platform_admin;
  INSERT INTO roles (name, scope) VALUES ('owner', 'organization') RETURNING id INTO r_owner;
  INSERT INTO roles (name, scope) VALUES ('admin', 'organization') RETURNING id INTO r_admin;
  INSERT INTO roles (name, scope) VALUES ('member', 'organization') RETURNING id INTO r_member;

  -- Permissions
  INSERT INTO permissions (key) VALUES ('platform.manage') RETURNING id INTO p_platform_manage;
  INSERT INTO permissions (key) VALUES ('org.manage') RETURNING id INTO p_org_manage;
  INSERT INTO permissions (key) VALUES ('org.invite') RETURNING id INTO p_org_invite;
  INSERT INTO permissions (key) VALUES ('tournament.create') RETURNING id INTO p_tournament_create;
  INSERT INTO permissions (key) VALUES ('tournament.edit') RETURNING id INTO p_tournament_edit;
  INSERT INTO permissions (key) VALUES ('tournament.delete') RETURNING id INTO p_tournament_delete;
  INSERT INTO permissions (key) VALUES ('tournament.view') RETURNING id INTO p_tournament_view;
  INSERT INTO permissions (key) VALUES ('registration.view') RETURNING id INTO p_registration_view;
  INSERT INTO permissions (key) VALUES ('payment.view') RETURNING id INTO p_payment_view;
  INSERT INTO permissions (key) VALUES ('refund.manage') RETURNING id INTO p_refund_manage;

  -- platform_admin: platform.manage (implies all)
  INSERT INTO role_permissions (role_id, permission_id) VALUES (r_platform_admin, p_platform_manage);

  -- owner: all org permissions
  INSERT INTO role_permissions (role_id, permission_id) VALUES
    (r_owner, p_org_manage),
    (r_owner, p_org_invite),
    (r_owner, p_tournament_create),
    (r_owner, p_tournament_edit),
    (r_owner, p_tournament_delete),
    (r_owner, p_tournament_view),
    (r_owner, p_registration_view),
    (r_owner, p_payment_view),
    (r_owner, p_refund_manage);

  -- admin: all except org.manage and tournament.delete
  INSERT INTO role_permissions (role_id, permission_id) VALUES
    (r_admin, p_org_invite),
    (r_admin, p_tournament_create),
    (r_admin, p_tournament_edit),
    (r_admin, p_tournament_view),
    (r_admin, p_registration_view),
    (r_admin, p_payment_view),
    (r_admin, p_refund_manage);

  -- member: view-only
  INSERT INTO role_permissions (role_id, permission_id) VALUES
    (r_member, p_tournament_view),
    (r_member, p_registration_view);

  RAISE NOTICE '[0/4] RBAC seeded: 4 roles, 10 permissions';
END;
$$;

-- =============================================
-- USERS, ORGANIZATIONS, TOURNAMENTS, REGISTRATIONS
-- =============================================
DO $$
DECLARE
  -- Tracked IDs
  org_profile_ids  uuid[] := '{}';
  org_user_ids     uuid[] := '{}';
  player_user_ids  uuid[] := '{}';
  tourney_ids      uuid[] := '{}';

  -- RBAC role IDs (look them up)
  r_owner_id       uuid;

  -- Loop / temp vars
  i            integer;
  j            integer;
  idx          integer;
  reg_idx      integer := 0;
  new_user_id  uuid;
  new_org_id   uuid;
  new_t_id     uuid;
  new_reg_id   uuid;

  -- Pre-compute bcrypt hash once
  pwd_hash     text := crypt('Password123!', gen_salt('bf'));

  -- Player derivation vars
  p_first      text;
  p_last       text;
  p_email      text;
  p_state      text;
  p_gender     varchar(10);
  p_fide_std   integer;
  p_fide_rpd   integer;
  p_fide_blz   integer;
  p_nat        integer;

  -- Registration vars
  reg_status   text;
  confirmed_ts timestamptz;
  cancelled_ts timestamptz;
  fee_cents    integer;

  -- Tournament vars
  t_offset_wk  integer;
  t_start      date;
  t_end        date;
  t_deadline   timestamptz;
  t_status     text;
  t_fee        integer;
  v_idx        integer;

  -- Name pools
  malay_first  text[] := ARRAY[
    'Ahmad','Muhammad','Ali','Ibrahim','Hassan','Aziz','Razif',
    'Farid','Hafiz','Zaid','Ammar','Faris','Danish','Izzat',
    'Arif','Syafiq','Rizal','Amirul','Khairul','Siti',
    'Nur','Farah','Aisyah','Zara','Amirah','Fatimah'
  ];
  malay_last   text[] := ARRAY[
    'Abdullah','Rahman','Ismail','Hassan','Ibrahim','Ahmad',
    'Kamaruddin','Yusof','Hamid','Ghani','Zainal','Azman',
    'Rashid','Talib','Osman','Mansor','Salleh','Daud','Zakaria'
  ];
  chinese_first text[] := ARRAY[
    'Wei','Ming','Jian','Hui','Xin','Kai','Jun','Ying','Hao','Ling'
  ];
  chinese_last  text[] := ARRAY[
    'Tan','Lee','Lim','Wong','Ng','Yap','Ong','Chin','Goh'
  ];
  indian_first  text[] := ARRAY[
    'Raj','Vijay','Kumar','Suresh','Priya','Murali','Ganesan'
  ];
  indian_last   text[] := ARRAY[
    'Krishnan','Rajan','Kumar','Chandran','Pillai','Nair','Gopal'
  ];

  states text[] := ARRAY[
    'Selangor','Kuala Lumpur','Penang','Johor','Perak',
    'Kedah','Sabah','Sarawak','Negeri Sembilan','Pahang',
    'Terengganu','Kelantan','Melaka'
  ];

  org_names   text[] := ARRAY[
    'Kuala Lumpur Chess Association',
    'Selangor Chess Federation',
    'Penang Chess Association',
    'Johor Chess Association',
    'Malaysian Chess Federation'
  ];
  org_descs   text[] := ARRAY[
    'Organising premier chess events in Kuala Lumpur and the Klang Valley since 1992.',
    'The governing body for competitive chess in Selangor, hosting state and national events.',
    'Promoting chess excellence across Penang through regular tournaments and coaching.',
    'Dedicated to growing the chess community in Johor through competitive and grassroots events.',
    'The national governing body for chess in Malaysia, affiliated with FIDE.'
  ];
  org_emails  text[] := ARRAY[
    'organizer1@mct-seed.local','organizer2@mct-seed.local','organizer3@mct-seed.local',
    'organizer4@mct-seed.local','organizer5@mct-seed.local'
  ];
  org_first   text[] := ARRAY['Ahmad','Mohd','Wei','Raj','Siti'];
  org_last    text[] := ARRAY['Kamaruddin','Yusof','Ming','Krishnan','Rahman'];

  t_names text[] := ARRAY[
    'KL Open Chess Championship',        'Selangor Rapid Chess Tournament',
    'Penang International Chess Festival','Johor Chess Open',
    'Perak State Championship',          'National Age Group Championship',
    'MSSM Chess Championship',           'MCF National Rapid Championship',
    'Malaysia Blitz Chess Open',         'Sabah Chess Open',
    'Sarawak Heritage Chess Festival',   'Kedah Open Chess Tournament',
    'Pahang Chess Classic',              'Negeri Sembilan Chess Open',
    'KL Junior Chess Championship'
  ];
  venue_names text[] := ARRAY[
    'KL Convention Centre',           'Sunway Pyramid Convention Centre',
    'Penang Chess Academy',           'Johor Bahru Chess Club',
    'Ipoh Chess Centre',              'Alor Setar Municipal Hall',
    'Kota Kinabalu Convention Centre','Kuching Chess Federation Hall'
  ];
  venue_addrs text[] := ARRAY[
    'Kuala Lumpur City Centre, 50088 Kuala Lumpur',
    'Persiaran Lagoon, Bandar Sunway, 47500 Petaling Jaya',
    '10 Jalan Masjid Negeri, 11600 George Town, Penang',
    '15 Jalan Abdul Samad, 80100 Johor Bahru, Johor',
    '5 Jalan Sultan Idris Shah, 30000 Ipoh, Perak',
    'Jalan Badlishah, 05000 Alor Setar, Kedah',
    'Jalan Tun Razak, 88000 Kota Kinabalu, Sabah',
    '22 Jalan Padungan, 93100 Kuching, Sarawak'
  ];
  t_types   text[]    := ARRAY['rapid','blitz','classical','rapid','blitz'];
  t_rounds  integer[] := ARRAY[7, 9, 9, 7, 11];
  t_base    integer[] := ARRAY[15, 5, 90, 10, 3];
  t_inc     integer[] := ARRAY[10, 3, 30,  5, 2];
  fee_opts  integer[] := ARRAY[3000, 4000, 5000, 6000, 8000];
  max_parts integer[] := ARRAY[64, 80, 100, 128, 150];

BEGIN

  -- Look up the owner role ID
  SELECT id INTO r_owner_id FROM roles WHERE name = 'owner';

  -- ===========================================================================
  -- 1. ORGANIZERS
  -- ===========================================================================
  RAISE NOTICE '[1/4] Seeding organizers...';

  FOR i IN 1..5 LOOP
    new_user_id := gen_random_uuid();

    INSERT INTO auth.users (
      id, instance_id, aud, role,
      email, encrypted_password,
      email_confirmed_at,
      raw_app_meta_data, raw_user_meta_data,
      created_at, updated_at
    ) VALUES (
      new_user_id,
      '00000000-0000-0000-0000-000000000000',
      'authenticated', 'authenticated',
      org_emails[i], pwd_hash,
      now(),
      '{"provider":"email","providers":["email"]}',
      json_build_object('first_name', org_first[i], 'last_name', org_last[i], 'password_hash', pwd_hash),
      now(), now()
    );

    INSERT INTO public.users (id, email, password, first_name, last_name)
    VALUES (new_user_id, org_emails[i], pwd_hash, org_first[i], org_last[i])
    ON CONFLICT (id) DO NOTHING;

    org_user_ids := array_append(org_user_ids, new_user_id);

    INSERT INTO public.organizations (
      name, description, email,
      phone, approval_status, reviewed_at
    ) VALUES (
      org_names[i], org_descs[i], org_emails[i],
      '+601' || (i + 1)::text || '-' || (1000000 + i * 123456)::text,
      'approved', now()
    ) RETURNING id INTO new_org_id;

    org_profile_ids := array_append(org_profile_ids, new_org_id);

    INSERT INTO public.organization_memberships (organization_id, user_id, role_id)
    VALUES (new_org_id, new_user_id, r_owner_id);
  END LOOP;

  RAISE NOTICE '  > 5 organizers created';

  -- ===========================================================================
  -- 2. PLAYERS
  -- ===========================================================================
  RAISE NOTICE '[2/4] Seeding players...';

  FOR i IN 1..50 LOOP
    new_user_id := gen_random_uuid();

    IF i % 10 < 7 THEN
      p_first := malay_first[((i - 1) % array_length(malay_first,  1)) + 1];
      p_last  := malay_last [((i - 1) % array_length(malay_last,   1)) + 1];
    ELSIF i % 10 < 9 THEN
      p_first := chinese_first[((i - 1) % array_length(chinese_first, 1)) + 1];
      p_last  := chinese_last [((i - 1) % array_length(chinese_last,  1)) + 1];
    ELSE
      p_first := indian_first[((i - 1) % array_length(indian_first, 1)) + 1];
      p_last  := indian_last [((i - 1) % array_length(indian_last,  1)) + 1];
    END IF;

    p_email  := lower(p_first) || '.' || lower(p_last) || i || '@mct-seed.local';
    p_state  := states[((i - 1) % array_length(states, 1)) + 1];
    p_gender := CASE WHEN i % 4 = 0 THEN 'female' ELSE 'male' END;
    -- Deterministic but varied ratings
    p_fide_std := CASE WHEN i % 3 != 0 THEN 1000 + (i * 23) % 1200 ELSE NULL END;
    p_fide_rpd := CASE WHEN p_fide_std IS NOT NULL THEN p_fide_std - 50 + (i % 100) ELSE NULL END;
    p_fide_blz := CASE WHEN p_fide_std IS NOT NULL THEN p_fide_std - 100 + (i % 80) ELSE NULL END;
    p_nat    := 800 + (i * 31) % 1300;

    INSERT INTO auth.users (
      id, instance_id, aud, role,
      email, encrypted_password,
      email_confirmed_at,
      raw_app_meta_data, raw_user_meta_data,
      created_at, updated_at
    ) VALUES (
      new_user_id,
      '00000000-0000-0000-0000-000000000000',
      'authenticated', 'authenticated',
      p_email, pwd_hash,
      now(),
      '{"provider":"email","providers":["email"]}',
      json_build_object('first_name', p_first, 'last_name', p_last, 'password_hash', pwd_hash),
      now() - (i || ' days')::interval,
      now() - (i || ' days')::interval
    );

    INSERT INTO public.users (id, email, password, first_name, last_name)
    VALUES (new_user_id, p_email, pwd_hash, p_first, p_last)
    ON CONFLICT (id) DO NOTHING;

    player_user_ids := array_append(player_user_ids, new_user_id);

    INSERT INTO public.player_profiles (
      user_id, fide_id, mcf_id,
      fide_rating, national_rating,
      date_of_birth, gender, nationality
    ) VALUES (
      new_user_id,
      CASE WHEN p_fide_std IS NOT NULL THEN 10000000 + i * 7 ELSE NULL END,
      CASE WHEN i % 2 = 0 THEN 20000 + i ELSE NULL END,
      CASE WHEN p_fide_std IS NOT NULL THEN
        json_build_object('standard', p_fide_std, 'rapid', p_fide_rpd, 'blitz', p_fide_blz)::jsonb
      ELSE NULL END,
      p_nat,
      (date '1985-01-01' + ((i * 173) % 9131 || ' days')::interval)::date,
      p_gender::gender,
      'Malaysian'
    )
    ON CONFLICT (user_id) DO UPDATE SET
      fide_id         = EXCLUDED.fide_id,
      mcf_id          = EXCLUDED.mcf_id,
      fide_rating     = EXCLUDED.fide_rating,
      national_rating = EXCLUDED.national_rating,
      date_of_birth   = EXCLUDED.date_of_birth,
      gender          = EXCLUDED.gender,
      nationality     = EXCLUDED.nationality;
  END LOOP;

  RAISE NOTICE '  > 50 players created';

  -- ===========================================================================
  -- 3. TOURNAMENTS (3 per organizer = 15 total)
  -- ===========================================================================
  RAISE NOTICE '[3/4] Seeding tournaments...';

  FOR i IN 1..5 LOOP
    FOR j IN 1..3 LOOP
      idx := (i - 1) * 3 + j;

      t_offset_wk := (idx - 8) * 2;
      t_start    := current_date + (t_offset_wk * 7 || ' days')::interval;
      t_end      := t_start + ((1 + (idx % 3)) || ' days')::interval;
      t_deadline := (t_start - '7 days'::interval)::timestamptz;

      t_status := CASE
        WHEN t_offset_wk < 4 THEN 'published'
        ELSE                      'draft'
      END;

      t_fee := fee_opts[((idx - 1) % 5) + 1];
      v_idx := ((idx - 1) % 8) + 1;

      INSERT INTO public.tournaments (
        organization_id, name, description,
        venue_name, venue_state, venue_address,
        start_date, end_date, registration_deadline,
        format, time_control,
        is_fide_rated, is_mcf_rated,
        entry_fees, prizes, restrictions,
        max_participants, status,
        published_at
      ) VALUES (
        org_profile_ids[i],
        t_names[idx],
        t_names[idx] || ' — a competitive chess event open to all Malaysian-rated players.',
        venue_names[v_idx],
        states[((idx - 1) % array_length(states, 1)) + 1],
        venue_addrs[v_idx],
        t_start, t_end, t_deadline,
        json_build_object(
          'type',   t_types  [(idx % 5) + 1],
          'system', 'swiss',
          'rounds', t_rounds [(idx % 5) + 1]
        ),
        json_build_object(
          'base_minutes',      t_base[(idx % 5) + 1],
          'increment_seconds', t_inc [(idx % 5) + 1],
          'delay_seconds',     0
        ),
        (idx % 2 = 0),
        true,
        json_build_object(
          'standard', json_build_object('amount_cents', t_fee),
          'additional', json_build_array(
            json_build_object(
              'type', 'early_bird',
              'amount_cents', (t_fee * 0.8)::integer,
              'valid_until', t_deadline
            ),
            json_build_object(
              'type', 'age_based',
              'amount_cents', (t_fee * 0.6)::integer,
              'age_min', 0, 'age_max', 12
            )
          )
        ),
        json_build_object(
          'categories', json_build_array(
            json_build_object(
              'name', 'Open',
              'entries', json_build_array(
                json_build_object('place', '1st', 'amount_cents', t_fee * 20),
                json_build_object('place', '2nd', 'amount_cents', t_fee * 12),
                json_build_object('place', '3rd', 'amount_cents', t_fee * 8)
              )
            )
          ),
          'subcategories', json_build_array(
            json_build_object(
              'name', 'Best Under-1500',
              'entries', json_build_array(
                json_build_object('place', '1st', 'amount_cents', t_fee * 5)
              ),
              'conditions', json_build_object('max_rating', 1499)
            ),
            json_build_object(
              'name', 'Best Female Player',
              'entries', json_build_array(
                json_build_object('place', '1st', 'amount_cents', t_fee * 5)
              ),
              'conditions', json_build_object('gender', 'female')
            )
          )
        ),
        '[{"type":"nationality","value":"Malaysian"}]'::jsonb,
        max_parts[(idx % 5) + 1],
        t_status::tournament_status,
        CASE WHEN t_status = 'published' THEN now() ELSE NULL END
      ) RETURNING id INTO new_t_id;

      tourney_ids := array_append(tourney_ids, new_t_id);
    END LOOP;
  END LOOP;

  RAISE NOTICE '  > 15 tournaments created';

  -- ===========================================================================
  -- 4. REGISTRATIONS & PAYMENTS
  -- ===========================================================================
  RAISE NOTICE '[4/4] Seeding registrations and payments...';

  FOR i IN 1..50 LOOP
    FOR j IN 0..3 LOOP

      reg_status := CASE
        WHEN reg_idx < 120 THEN 'confirmed'
        WHEN reg_idx < 170 THEN 'pending_payment'
        ELSE                    'cancelled_payment'
      END;

      confirmed_ts := CASE
        WHEN reg_status = 'confirmed'
        THEN now() - ((30 - (reg_idx % 25)) || ' days')::interval
        ELSE NULL
      END;

      cancelled_ts := CASE
        WHEN reg_status = 'cancelled_payment'
        THEN now() - ((reg_idx % 15) || ' days')::interval
        ELSE NULL
      END;

      fee_cents := fee_opts[(reg_idx % 5) + 1];

      INSERT INTO public.registrations (
        user_id, tournament_id,
        fee_tier, status,
        registered_at, confirmed_at, cancelled_at, cancellation_reason
      ) VALUES (
        player_user_ids[i],
        tourney_ids[((i - 1 + j) % 15) + 1],
        CASE WHEN j < 2 THEN 'early_bird' ELSE 'standard' END,
        reg_status::registration_status,
        now() - ((60 - (reg_idx % 45)) || ' days')::interval,
        confirmed_ts,
        cancelled_ts,
        CASE
          WHEN reg_status = 'cancelled_payment'
          THEN (ARRAY[
            'Unable to attend due to scheduling conflict',
            'Personal reasons',
            'Work commitment'
          ])[(reg_idx % 3) + 1]
          ELSE NULL
        END
      ) RETURNING id INTO new_reg_id;

      IF reg_status = 'confirmed' THEN
        INSERT INTO public.payments (
          type,
          tournament_id,
          registration_id,
          user_id,
          gross_amount_cents,
          platform_fee_cents,
          net_amount_cents,
          currency,
          payment_method,
          chip_transaction_id,
          status,
          paid_at
        ) VALUES (
          'registration',
          tourney_ids[((i - 1 + j) % 15) + 1],
          new_reg_id,
          player_user_ids[i],
          fee_cents,
          (fee_cents * 0.10)::integer,
          fee_cents - (fee_cents * 0.10)::integer,
          'MYR',
          (ARRAY[
            'online_banking','credit_card','chip',
            'online_banking','credit_card'
          ])[(reg_idx % 5) + 1],
          'CHIP-' || upper(substring(md5(new_reg_id::text), 1, 8)),
          'paid',
          confirmed_ts
        );
      END IF;

      reg_idx := reg_idx + 1;
    END LOOP;
  END LOOP;

  RAISE NOTICE '  > % registrations created (120 confirmed, 50 pending, 30 cancelled)', reg_idx;
  RAISE NOTICE '  > 120 payment records created';
  RAISE NOTICE '';
  RAISE NOTICE '=== Seed complete ===';
  RAISE NOTICE 'All accounts use password: Password123!';

END;
$$;

RESET app.audit_context;
