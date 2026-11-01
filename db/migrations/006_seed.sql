-- =============================================================================
-- Migration 006 — Seed Data
-- MY Chess Tour
--
-- Creates: RBAC roles & permissions · 5 organizers · 50 players
--          · 15 tournaments · ~200 registrations, one payment attempt each
--
-- Dates are relative to the moment the seed runs, so re-run it (on a fresh
-- database) when the seeded tournaments have drifted into the past: the
-- listing hides anything that ended more than 30 days ago.
--
-- Prerequisites: migrations 001–005 and 007 must be applied first (the
-- registration amounts come from compute_registration_amounts in 007).
-- Password for all seed accounts: Abcd!234
--
-- Identity note: inserting into auth.users fires on_auth_user_created, which
-- already writes public.users with auth_user_id = id. The public.users inserts
-- below nonetheless set auth_user_id explicitly (and re-assert it in the
-- ON CONFLICT branch) rather than relying on that trigger having run — a seed
-- account whose auth_user_id ended up NULL would resolve app_user_id() to NULL
-- on every request, so it could authenticate and then silently have no rows and
-- no permissions. Cheap to state outright, confusing to debug otherwise.
-- =============================================================================

-- Tag all audit log entries created during seeding
SET LOCAL app.audit_context = 'seed';

-- =============================================
-- RBAC: Roles, Permissions, Role-Permission Mappings
-- =============================================
DO $$
DECLARE
  -- Role IDs
  r_platform_admin integer;
  r_owner          integer;
  r_admin          integer;
  r_member         integer;

  -- Permission IDs
  p_platform_manage  integer;
  p_org_manage       integer;
  p_org_invite       integer;
  p_tournament_create integer;
  p_tournament_edit   integer;
  p_tournament_delete integer;
  p_tournament_view   integer;
  p_registration_view integer;
  p_payment_view      integer;
  p_refund_manage     integer;
  p_bank_account_manage integer;
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
  -- Owner-only. Where the organization's money lands is not something a
  -- delegated org `admin` should be able to read or redirect.
  INSERT INTO permissions (key) VALUES ('bank_account.manage') RETURNING id INTO p_bank_account_manage;

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
    (r_owner, p_refund_manage),
    (r_owner, p_bank_account_manage);

  -- admin: all except org.manage, tournament.delete and bank_account.manage
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

  RAISE NOTICE '[0/4] RBAC seeded: 4 roles, 11 permissions';
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
  r_owner_id          integer;
  r_platform_admin_id integer;

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
  pwd_hash     text := crypt('Abcd!234', gen_salt('bf'));

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
  k            integer;
  n_regs       integer;
  t_pick       integer;
  v_t          tournaments;
  v_pp         player_profiles;
  v_r          jsonb;
  v_rating     integer;
  v_eligible   boolean;
  v_tier       text;
  v_base_cents integer;
  v_amounts    record;
  v_win_start  timestamptz;
  v_win_end    timestamptz;
  v_reg_at     timestamptz;
  v_settled_at timestamptz;
  new_pay_id   uuid;
  n_confirmed  integer := 0;
  n_failed     integer := 0;
  n_expired    integer := 0;

  -- Tournament vars
  -- Start date of each tournament, in days from today. 1–2 ended within the
  -- listing's 30-day "past" window, 3 is ongoing, 4–12 are upcoming with
  -- registration still open (deadline = start - 7 days), 13–15 are drafts.
  t_offset_days integer[] := ARRAY[
    -20, -6, -1,
     10, 17, 24, 31, 38, 45, 52, 59, 66,
     80, 94, 108
  ];
  n_published  integer := 12;
  t_published_at timestamptz;
  t_start      date;
  t_end        date;
  t_deadline   timestamptz;
  t_status     tournament_status;
  t_fee          integer;
  v_idx          integer;
  f_idx          integer;
  t_restrictions jsonb;
  t_local_end    timestamp;
  t_utc_offset   interval;
  t_valid_until  text;

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
    'Selangor','W.P. Kuala Lumpur','Pulau Pinang','Johor','Perak',
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
    'organizer1@mct.com','organizer2@mct.com','organizer3@mct.com',
    'organizer4@mct.com','organizer5@mct.com'
  ];
  org_first   text[] := ARRAY['Ahmad','Mohd','Wei','Raj','Siti'];
  org_last    text[] := ARRAY['Kamaruddin','Yusof','Ming','Krishnan','Rahman'];
  -- Payout destinations. Seeded as 'verified' because every payout phase from
  -- #519 onward needs a usable recipient to develop against, and because an
  -- unverified seed org would open its dashboard behind the bank-account banner.
  -- SWIFT codes must exist in MALAYSIAN_BANKS (src/lib/malaysian-banks.ts).
  org_bank_codes   text[] := ARRAY['MBBEMYKL','CIBBMYKL','PBBEMYKL','RHBBMYKL','HLBBMYKL'];
  org_bank_names   text[] := ARRAY['Maybank','CIMB Bank','Public Bank','RHB Bank','Hong Leong Bank'];
  -- tournaments.organizer_commission_pct per organizer: how much of the
  -- platform fee the organizer absorbs (0 = player pays it all, 10 = organizer
  -- absorbs it all). Varied so seeded payments exercise every split
  -- compute_registration_amounts can produce.
  org_commission_pct smallint[] := ARRAY[0, 3, 10, 0, 5];

  t_names text[] := ARRAY[
    'KL Open Chess Championship',        'Selangor Rapid Chess Tournament',
    'Penang International Chess Festival','Johor Chess Open',
    'Perak State Championship',          'National Age Group Championship',
    -- Names 7–9 pair with the non-Malaysian venues at the same indices below.
    'Bangkok Open Chess Championship',   'Jakarta Rapid Chess Open',
    'Singapore Blitz Chess Open',        'Sabah Chess Open',
    'Sarawak Heritage Chess Festival',   'Kedah Open Chess Tournament',
    'Pahang Chess Classic',              'Negeri Sembilan Chess Open',
    'KL Junior Chess Championship'
  ];
  -- Venues carry their own state/region and timezone: a tournament's dates are
  -- calendar dates at its venue, so the two have to agree (tournaments.timezone;
  -- picklist in VENUE_TIME_ZONES, src/lib/datetime.ts).
  --
  -- Positions 7–9 are outside Malaysia. Venue index is (idx - 1) % 11 and
  -- tournaments 7–9 are published and upcoming, so those three non-Malaysian
  -- venues reach discovery — two at UTC+7, which is what makes a seeded
  -- database disagree with Malaysia about what day it is.
  venue_names text[] := ARRAY[
    'KL Convention Centre',           'Sunway Pyramid Convention Centre',
    'Penang Chess Academy',           'Johor Bahru Chess Club',
    'Ipoh Chess Centre',              'Alor Setar Municipal Hall',
    'Bangkok Chess Club',             'Jakarta Chess Arena',
    'Singapore Chess Centre',
    'Kota Kinabalu Convention Centre','Kuching Chess Federation Hall'
  ];
  venue_addrs text[] := ARRAY[
    'Kuala Lumpur City Centre, 50088 Kuala Lumpur',
    'Persiaran Lagoon, Bandar Sunway, 47500 Petaling Jaya',
    '10 Jalan Masjid Negeri, 11600 George Town, Penang',
    '15 Jalan Abdul Samad, 80100 Johor Bahru, Johor',
    '5 Jalan Sultan Idris Shah, 30000 Ipoh, Perak',
    'Jalan Badlishah, 05000 Alor Setar, Kedah',
    '88 Sukhumvit Road, Khlong Toei, Bangkok 10110',
    'Jalan Jenderal Sudirman 52, Jakarta 12190',
    '1 Marina Boulevard, Singapore 018989',
    'Jalan Tun Razak, 88000 Kota Kinabalu, Sabah',
    '22 Jalan Padungan, 93100 Kuching, Sarawak'
  ];
  venue_states text[] := ARRAY[
    'W.P. Kuala Lumpur','Selangor','Pulau Pinang','Johor',
    'Perak','Kedah',
    'Bangkok','Jakarta','Singapore',
    'Sabah','Sarawak'
  ];
  venue_tz text[] := ARRAY[
    'Asia/Kuala_Lumpur','Asia/Kuala_Lumpur','Asia/Kuala_Lumpur','Asia/Kuala_Lumpur',
    'Asia/Kuala_Lumpur','Asia/Kuala_Lumpur',
    'Asia/Bangkok','Asia/Jakarta','Asia/Singapore',
    'Asia/Kuala_Lumpur','Asia/Kuala_Lumpur'
  ];
  -- ISO 3166-1 alpha-2 of each venue (tournaments.venue_country). Deliberately
  -- separate from the timezone above: the country decides which payout rails and
  -- currency the money moves on, the timezone decides how the dates read. A
  -- country can span several zones, so neither derives from the other.
  --
  -- Positions 7–9 are TH/ID/SG, which are NOT in SUPPORTED_COUNTRIES
  -- (src/lib/venues.ts is MY-only today) — exactly as their venue_states above
  -- already sit outside the Malaysian region list. They exist to exercise
  -- cross-country reads; editing one through the creation wizard would fall back
  -- to MY, which is the accepted cost of seeding venues the picklist cannot yet
  -- express. Widening SUPPORTED_COUNTRIES is what makes them round-trip.
  venue_countries text[] := ARRAY[
    'MY','MY','MY','MY',
    'MY','MY',
    'TH','ID','SG',
    'MY','MY'
  ];
  -- Prize funding. Entry fees never fund prizes (src/lib/prize-funding.ts), so
  -- every category carrying money must name an external source and the party
  -- putting it up. Publish validation rejects one that doesn't, so seeded
  -- tournaments have to declare it or they could not be re-published.
  funding_srcs text[] := ARRAY['sponsor','grant','organizer'];
  funder_names text[] := ARRAY[
    'Maybank Foundation',
    'Ministry of Youth and Sports',
    NULL  -- 'organizer' names the organizing body itself; filled in per row
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
  SELECT id INTO r_platform_admin_id FROM roles WHERE name = 'platform_admin';

  -- ===========================================================================
  -- 0. PLATFORM ADMIN
  -- A global-scope admin (platform.manage) — assigned via user_global_roles, not
  -- an organization membership. Used to review CHIP applications, etc.
  -- ===========================================================================
  RAISE NOTICE '[0b/4] Seeding platform admin...';

  new_user_id := gen_random_uuid();

  INSERT INTO auth.users (
    id, instance_id, aud, role,
    email, encrypted_password,
    email_confirmed_at,
    raw_app_meta_data, raw_user_meta_data,
    created_at, updated_at,
    confirmation_token, recovery_token, email_change,
    email_change_token_new, email_change_token_current,
    phone_change, phone_change_token, reauthentication_token
  ) VALUES (
    new_user_id,
    '00000000-0000-0000-0000-000000000000',
    'authenticated', 'authenticated',
    'review@chip.com', pwd_hash,
    now(),
    '{"provider":"email","providers":["email"]}',
    -- terms_version rides in the metadata exactly as the signup route sends it,
    -- so handle_new_user records the acceptance the same way it does in
    -- production. Keep in step with TERMS_VERSION in src/lib/legal.ts.
    json_build_object('first_name', 'CHIP', 'last_name', 'Review',
                      'terms_version', '2026-08-02'),
    now(), now(),
    '', '', '', '', '', '', '', ''
  );

  -- Email/password sign-in resolves through auth.identities; raw inserts into
  -- auth.users bypass the Auth Admin API, so create the identity explicitly.
  INSERT INTO auth.identities (
    provider_id, user_id, identity_data, provider,
    last_sign_in_at, created_at, updated_at
  ) VALUES (
    new_user_id::text, new_user_id,
    jsonb_build_object('sub', new_user_id::text, 'email', 'review@chip.com',
                       'email_verified', true, 'phone_verified', false),
    'email', now(), now(), now()
  );

  -- Mark verified so the account is immediately login-ready.
  INSERT INTO public.users (id, auth_user_id, email, first_name, last_name, is_verified, verified_at)
  VALUES (new_user_id, new_user_id, 'review@chip.com', 'CHIP', 'Review', true, now())
  ON CONFLICT (id) DO UPDATE SET
    auth_user_id = EXCLUDED.auth_user_id,
    is_verified = true,
    verified_at = now();

  -- Grant the global platform_admin role.
  INSERT INTO public.user_global_roles (user_id, role_id)
  VALUES (new_user_id, r_platform_admin_id);

  RAISE NOTICE '  > 1 platform admin created (review@chip.com)';

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
      created_at, updated_at,
      confirmation_token, recovery_token, email_change,
      email_change_token_new, email_change_token_current,
      phone_change, phone_change_token, reauthentication_token
    ) VALUES (
      new_user_id,
      '00000000-0000-0000-0000-000000000000',
      'authenticated', 'authenticated',
      org_emails[i], pwd_hash,
      now(),
      '{"provider":"email","providers":["email"]}',
      json_build_object('first_name', org_first[i], 'last_name', org_last[i],
                        'terms_version', '2026-08-02'),
      now(), now(),
      '', '', '', '', '', '', '', ''
    );

    -- Email/password sign-in resolves through auth.identities; raw inserts into
    -- auth.users bypass the Auth Admin API, so create the identity explicitly.
    INSERT INTO auth.identities (
      provider_id, user_id, identity_data, provider,
      last_sign_in_at, created_at, updated_at
    ) VALUES (
      new_user_id::text, new_user_id,
      jsonb_build_object('sub', new_user_id::text, 'email', org_emails[i],
                         'email_verified', true, 'phone_verified', false),
      'email', now(), now(), now()
    );

    -- The trigger already created the row (is_verified=false); mark seed
    -- accounts verified so they're immediately login-ready.
    INSERT INTO public.users (id, auth_user_id, email, first_name, last_name, is_verified, verified_at)
    VALUES (new_user_id, new_user_id, org_emails[i], org_first[i], org_last[i], true, now())
    ON CONFLICT (id) DO UPDATE SET
      auth_user_id = EXCLUDED.auth_user_id,
      is_verified = true,
      verified_at = now();

    org_user_ids := array_append(org_user_ids, new_user_id);

    -- Seeded organizations accept the current Organizer Agreement, otherwise
    -- every seeded dashboard opens behind the re-acceptance gate. Keep this
    -- literal in step with ORGANIZER_AGREEMENT_VERSION in src/lib/legal.ts —
    -- a mismatch here surfaces as the gate appearing on every seeded org.
    INSERT INTO public.organizations (
      name, description, email,
      phone, approval_status, reviewed_at,
      reviewed_by, created_by,
      entity_type, registration_number,
      agreement_version, agreement_accepted_at, agreement_accepted_by
    ) VALUES (
      org_names[i], org_descs[i], org_emails[i],
      '+601' || (i + 1)::text || '-' || (1000000 + i * 123456)::text,
      'approved', now(),
      new_user_id, new_user_id,
      'society', 'PPM-' || lpad(i::text, 3, '0') || '-14-01012020',
      '2026-08-02', now(), new_user_id
    ) RETURNING id INTO new_org_id;

    org_profile_ids := array_append(org_profile_ids, new_org_id);

    -- Inserted directly rather than through set_organization_bank_account,
    -- which can only ever produce a 'pending' row (CHIP Send is what verifies,
    -- from #519). A seed needs the end state, not the starting one — including
    -- the CHIP Send recipient id a verified account carries. The ids are fake;
    -- nothing calls CHIP with them until payouts run against a sandbox.
    INSERT INTO public.organization_bank_accounts (
      organization_id, bank_name, bank_code, account_holder, account_number,
      status, chip_bank_account_id, verified_at, created_by
    ) VALUES (
      new_org_id, org_bank_names[i], org_bank_codes[i], org_names[i],
      '5140' || lpad((1000000 + i * 98765)::text, 8, '0'),
      'verified', 900000 + i, now(), new_user_id
    );

    INSERT INTO public.organization_memberships (organization_id, user_id, role_id)
    VALUES (new_org_id, new_user_id, r_owner_id);
  END LOOP;

  RAISE NOTICE '  > 5 organizers created (each with a verified payout bank account)';

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

    p_email  := lower(p_first) || '.' || lower(p_last) || i || '@mct.com';
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
      created_at, updated_at,
      confirmation_token, recovery_token, email_change,
      email_change_token_new, email_change_token_current,
      phone_change, phone_change_token, reauthentication_token
    ) VALUES (
      new_user_id,
      '00000000-0000-0000-0000-000000000000',
      'authenticated', 'authenticated',
      p_email, pwd_hash,
      now(),
      '{"provider":"email","providers":["email"]}',
      json_build_object('first_name', p_first, 'last_name', p_last,
                        'terms_version', '2026-08-02'),
      now() - (i || ' days')::interval,
      now() - (i || ' days')::interval,
      '', '', '', '', '', '', '', ''
    );

    -- Email/password sign-in resolves through auth.identities; raw inserts into
    -- auth.users bypass the Auth Admin API, so create the identity explicitly.
    INSERT INTO auth.identities (
      provider_id, user_id, identity_data, provider,
      last_sign_in_at, created_at, updated_at
    ) VALUES (
      new_user_id::text, new_user_id,
      jsonb_build_object('sub', new_user_id::text, 'email', p_email,
                         'email_verified', true, 'phone_verified', false),
      'email',
      now() - (i || ' days')::interval,
      now() - (i || ' days')::interval,
      now() - (i || ' days')::interval
    );

    -- Mark seed accounts verified so they're immediately login-ready.
    INSERT INTO public.users (id, auth_user_id, email, first_name, last_name, is_verified, verified_at)
    VALUES (new_user_id, new_user_id, p_email, p_first, p_last, true, now())
    ON CONFLICT (id) DO UPDATE SET
      auth_user_id = EXCLUDED.auth_user_id,
      is_verified = true,
      verified_at = now();

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
      -- Every 5th player is a junior (born 2009–2013) so the under-18 and
      -- under-21 restricted tournaments have someone eligible to enter them.
      CASE WHEN i % 5 = 0
        THEN date '2009-01-01' + (i * 97) % 1800
        ELSE (date '1985-01-01' + ((i * 173) % 9131 || ' days')::interval)::date
      END,
      p_gender::gender,
      'Malaysia'
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

      t_start    := current_date + t_offset_days[idx];
      t_end      := t_start + (idx % 3) + 1;
      t_deadline := (t_start - 7)::timestamptz;

      t_status := CASE
        WHEN idx <= n_published THEN 'published'::tournament_status
        ELSE                         'draft'::tournament_status
      END;

      -- Published three weeks ago, or two weeks before the start if that is
      -- earlier, so it is never in the future and always leaves a registration
      -- window before the deadline. Satisfies chk_published_at (<= deadline).
      t_published_at := LEAST((t_start - 14)::timestamptz, now() - interval '21 days');

      t_fee := fee_opts[((idx - 1) % 5) + 1];
      v_idx := ((idx - 1) % array_length(venue_names, 1)) + 1;
      f_idx := (idx % array_length(funding_srcs, 1)) + 1;

      -- An early-bird tier's `valid_until` is the instant its last day ENDS at
      -- the venue, not the deadline instant itself: consumers test it with
      -- `new Date(valid_until) < now`, so midnight would expire the tier for
      -- the whole of the day the UI says is still included.
      --
      -- Built to be byte-identical to toValidUntilTimestamp() in
      -- src/app/my/organizations/[orgId]/tournaments/create/_components/entryFees.ts
      -- ("YYYY-MM-DDTHH:MI:SS+HH:MM"). entry_fees is jsonb and the money-field
      -- freeze compares it exactly, so a seed row in any other shape would look
      -- like a fee change the moment an organizer saved an unrelated edit — and
      -- be refused, because these tournaments have paid registrations.
      t_local_end  := (t_deadline AT TIME ZONE venue_tz[v_idx])::date + time '23:59:59';
      t_utc_offset := t_local_end - ((t_local_end AT TIME ZONE venue_tz[v_idx]) AT TIME ZONE 'UTC');
      t_valid_until := to_char(t_local_end, 'YYYY-MM-DD"T"HH24:MI:SS')
                    || CASE WHEN t_utc_offset < interval '0' THEN '-' ELSE '+' END
                    -- No abs() for intervals, and `@` was dropped in PG 14.
                    || to_char(
                         CASE WHEN t_utc_offset < interval '0'
                              THEN -t_utc_offset ELSE t_utc_offset END,
                         'HH24:MI'
                       );

      -- Vary restrictions: open, nationality, age, gender, rating, combined
      t_restrictions := CASE (idx % 6)
        WHEN 0 THEN NULL                                                                            -- open
        WHEN 1 THEN '[{"type":"nationality","value":"Malaysia"}]'::jsonb                           -- nationals only
        WHEN 2 THEN '[{"type":"age","max":18}]'::jsonb                                             -- under 18
        WHEN 3 THEN '[{"type":"gender","value":"female"}]'::jsonb                                  -- women only
        WHEN 4 THEN '[{"type":"rating","max":1799}]'::jsonb                                        -- under 1800
        WHEN 5 THEN '[{"type":"nationality","value":"Malaysia"},{"type":"age","max":20}]'::jsonb   -- nationals + under 21
      END;

      INSERT INTO public.tournaments (
        organization_id, name, slug, description,
        venue_name, venue_state, venue_address, venue_country, timezone,
        start_date, end_date, registration_deadline,
        format, time_control,
        is_fide_rated, is_mcf_rated,
        entry_fees, prizes, restrictions,
        max_participants, organizer_commission_pct, status,
        published_by, published_at, registration_closed_at
      ) VALUES (
        org_profile_ids[i],
        t_names[idx],
        -- Published tournaments get a public slug (matches slugify() in
        -- src/lib/slugs.ts); drafts have none. Seed names are unique → no collision.
        CASE
          WHEN t_status = 'published'::tournament_status
          THEN regexp_replace(
                 regexp_replace(lower(t_names[idx]), '[^a-z0-9]+', '-', 'g'),
                 '(^-+|-+$)', '', 'g'
               )
          ELSE NULL
        END,
        t_names[idx] || ' — a competitive chess event open to all rated players.',
        venue_names[v_idx],
        venue_states[v_idx],
        venue_addrs[v_idx],
        venue_countries[v_idx],
        venue_tz[v_idx],
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
              'valid_until', t_valid_until
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
              -- Every category carrying money names its source and funder;
              -- publish validation refuses one that doesn't.
              'funding', json_build_object(
                'source', funding_srcs[f_idx],
                'funder_name', COALESCE(funder_names[f_idx], org_names[i])
              ),
              'entries', json_build_array(
                json_build_object('place', '1st', 'amount_cents', t_fee * 20),
                json_build_object('place', '2nd', 'amount_cents', t_fee * 12),
                json_build_object('place', '3rd', 'amount_cents', t_fee * 8)
              )
            )
          ),
          -- Special prizes are flat — one name, one amount, its own funding —
          -- not category-shaped (SpecialPrizeJson, src/lib/prize-funding.ts).
          -- The eligibility rule lives in the name because nothing reads a
          -- structured condition: the wizard's SpecialPrize has no field for one.
          'special', json_build_array(
            json_build_object(
              'name', 'Best Under-1500',
              'funding', json_build_object(
                'source', funding_srcs[f_idx],
                'funder_name', COALESCE(funder_names[f_idx], org_names[i])
              ),
              'amount_cents', t_fee * 5
            ),
            json_build_object(
              'name', 'Best Female Player',
              'funding', json_build_object(
                'source', funding_srcs[f_idx],
                'funder_name', COALESCE(funder_names[f_idx], org_names[i])
              ),
              'amount_cents', t_fee * 5
            )
          ),
          -- Who hands the money to the winners. Mostly the organizer directly;
          -- every 5th tournament appoints the platform, so the ring-fenced
          -- prize balance Phase 8 needs has seed data to work against.
          'distribution', CASE WHEN idx % 5 = 0 THEN 'platform' ELSE 'organizer' END
        ),
        t_restrictions,
        max_parts[(idx % 5) + 1],
        org_commission_pct[i],
        t_status::tournament_status,
        CASE WHEN t_status = 'published'::tournament_status THEN org_user_ids[i] ELSE NULL END,
        CASE WHEN t_status = 'published'::tournament_status THEN t_published_at ELSE NULL END,
        -- registration_closed_at defaults to the deadline at publish; drafts NULL.
        CASE WHEN t_status = 'published'::tournament_status THEN t_deadline ELSE NULL END
      ) RETURNING id INTO new_t_id;

      tourney_ids := array_append(tourney_ids, new_t_id);
    END LOOP;
  END LOOP;

  RAISE NOTICE '  > 15 tournaments created: 2 recently ended, 1 ongoing, 9 upcoming, 3 drafts (3 venues outside Malaysia)';

  -- ===========================================================================
  -- 4. REGISTRATIONS & PAYMENTS
  --
  -- Shaped like what the payment functions in 007 produce, not hand-rolled:
  --   * every registration has one payment attempt (payments is a per-attempt
  --     ledger) and points at it through registrations.current_payment_id;
  --   * amounts come from compute_registration_amounts on the tournament's own
  --     fee for the tier, under its commission settings;
  --   * end states only, because a pending_payment row older than the 10-minute
  --     hold is something the expiry sweep would immediately cancel:
  --       confirmed          payment 'paid'   (settle_registration_payment, paid)
  --       failed_payment     payment 'failed' (settle_registration_payment, declined)
  --       cancelled_payment  payment left 'pending', reason 'payment_expired'
  --                          (expire_stale_pending_payments; the pending row is
  --                          what lets a late `paid` webhook still rescue it).
  -- Players only register for published tournaments they are eligible for, and
  -- only inside the registration window (published_at .. deadline, never in the
  -- future). Inserted directly rather than through the functions because those
  -- stamp now() and the seed needs back-dated history.
  -- ===========================================================================
  RAISE NOTICE '[4/4] Seeding registrations and payments...';

  FOR i IN 1..50 LOOP
    SELECT * INTO v_pp FROM player_profiles WHERE user_id = player_user_ids[i];
    n_regs := 0;

    -- Walk the published tournaments starting from a per-player offset and take
    -- the first four the player may enter.
    FOR k IN 0..(n_published - 1) LOOP
      EXIT WHEN n_regs = 4;
      t_pick := ((i - 1 + k) % n_published) + 1;
      SELECT * INTO v_t FROM tournaments WHERE id = tourney_ids[t_pick];

      -- Eligibility, mirroring checkRestrictions / resolvePlayerRating
      -- (src/app/api/v1/tournaments/[slug]/registrations/validators.ts,
      -- src/app/tournaments/utils.ts) for the restriction kinds seeded above.
      v_eligible := true;
      FOR v_r IN SELECT * FROM jsonb_array_elements(COALESCE(v_t.restrictions, '[]'::jsonb)) LOOP
        CASE v_r->>'type'
          WHEN 'gender' THEN
            v_eligible := v_eligible AND v_pp.gender::text = v_r->>'value';
          WHEN 'nationality' THEN
            v_eligible := v_eligible AND v_pp.nationality = v_r->>'value';
          WHEN 'age' THEN
            -- Not yet `max` on the start date: DOB >= start_date - max years.
            v_eligible := v_eligible AND v_pp.date_of_birth
              >= (v_t.start_date - make_interval(years => (v_r->>'max')::integer))::date;
          WHEN 'rating' THEN
            -- FIDE-rated: the FIDE list for the format. Otherwise MCF-rated (all
            -- seeded tournaments are): the national rating. Unrated passes a max.
            v_rating := CASE
              WHEN v_t.is_fide_rated THEN (v_pp.fide_rating->>(
                CASE v_t.format->>'type'
                  WHEN 'blitz' THEN 'blitz' WHEN 'rapid' THEN 'rapid' ELSE 'standard'
                END))::integer
              ELSE v_pp.national_rating
            END;
            v_eligible := v_eligible AND (v_rating IS NULL OR v_rating <= (v_r->>'max')::integer);
          ELSE NULL;
        END CASE;
      END LOOP;
      CONTINUE WHEN NOT v_eligible;

      reg_status := CASE
        WHEN reg_idx % 10 < 8 THEN 'confirmed'
        WHEN reg_idx % 10 = 8 THEN 'failed_payment'
        ELSE                       'cancelled_payment'
      END;

      -- Somewhere in the registration window, deterministically spread.
      v_win_start := v_t.published_at + interval '1 hour';
      v_win_end   := LEAST(now(), v_t.registration_deadline) - interval '1 hour';
      v_reg_at    := v_win_start + (v_win_end - v_win_start) * (((reg_idx * 37) % 97) / 97.0);
      v_settled_at := v_reg_at + make_interval(mins => 2 + reg_idx % 7);

      -- Early bird is valid through the deadline day, which bounds the window,
      -- so either tier is a price the player could genuinely have been charged.
      v_tier := CASE WHEN reg_idx % 3 = 0 THEN 'standard' ELSE 'early_bird' END;
      v_base_cents := CASE v_tier
        WHEN 'standard' THEN (v_t.entry_fees->'standard'->>'amount_cents')::integer
        ELSE (SELECT (e->>'amount_cents')::integer
                FROM jsonb_array_elements(v_t.entry_fees->'additional') e
               WHERE e->>'type' = 'early_bird')
      END;
      SELECT * INTO v_amounts FROM compute_registration_amounts(
        v_base_cents, v_t.commission_rate, v_t.organizer_commission_pct
      );

      INSERT INTO public.registrations (
        user_id, tournament_id, fee_tier, status,
        registered_at, confirmed_at, cancelled_at, cancellation_reason
      ) VALUES (
        player_user_ids[i], v_t.id, v_tier, reg_status::registration_status,
        v_reg_at,
        CASE WHEN reg_status = 'confirmed' THEN v_settled_at END,
        CASE WHEN reg_status = 'cancelled_payment' THEN v_reg_at + interval '10 minutes' END,
        CASE WHEN reg_status = 'cancelled_payment' THEN 'payment_expired' END
      ) RETURNING id INTO new_reg_id;

      INSERT INTO public.payments (
        type, tournament_id, registration_id, user_id, organization_id,
        gross_amount_cents, platform_fee_cents,
        organizer_commission_cents, player_commission_cents, net_amount_cents,
        currency, payment_method, chip_transaction_id,
        status, paid_at, created_at
      ) VALUES (
        'registration', v_t.id, new_reg_id, player_user_ids[i], v_t.organization_id,
        v_amounts.gross_amount_cents, v_amounts.platform_fee_cents,
        v_amounts.organizer_commission_cents, v_amounts.player_commission_cents,
        v_amounts.net_amount_cents,
        'MYR',
        -- CHIP's transaction_data.payment_method values, as the webhook records them.
        CASE WHEN reg_status = 'confirmed'
          THEN (ARRAY['fpx_b2c','visa','mastercard','duitnow_qr','fpx_b2c'])[(reg_idx % 5) + 1]
        END,
        -- Every attempt had a CHIP purchase created for it, paid or not.
        'SEED-' || upper(substring(md5(new_reg_id::text), 1, 12)),
        CASE reg_status
          WHEN 'confirmed'      THEN 'paid'::payment_status
          WHEN 'failed_payment' THEN 'failed'::payment_status
          ELSE                       'pending'::payment_status
        END,
        CASE WHEN reg_status = 'confirmed' THEN v_settled_at END,
        v_reg_at
      ) RETURNING id INTO new_pay_id;

      UPDATE public.registrations SET current_payment_id = new_pay_id WHERE id = new_reg_id;

      CASE reg_status
        WHEN 'confirmed'      THEN n_confirmed := n_confirmed + 1;
        WHEN 'failed_payment' THEN n_failed    := n_failed + 1;
        ELSE                       n_expired   := n_expired + 1;
      END CASE;

      n_regs  := n_regs + 1;
      reg_idx := reg_idx + 1;
    END LOOP;
  END LOOP;

  RAISE NOTICE '  > % registrations, each with one payment attempt (% confirmed/paid, % failed, % expired)',
    reg_idx, n_confirmed, n_failed, n_expired;
  RAISE NOTICE '';
  RAISE NOTICE '=== Seed complete ===';
  RAISE NOTICE 'All accounts are verified and login-ready. Password: Abcd!234';

END;
$$;

RESET app.audit_context;
