-- =============================================================================
-- Staging seed data
-- MY Chess Tour
--
-- Creates: 1 platform admin · 5 organizers · 50 players (40 with their own
--          account, 10 juniors who are dependents of a parent among them, and
--          one adult helped by another) · 59 tournaments · ~400 registrations,
--          one payment attempt each
--
-- Tournaments:
--   * The 2027 calendar: one published tournament every Saturday of 2027
--     (2 January to 25 December) and a year-end blitz on Friday 31 December,
--     so every week of the year has at least one. Fixed dates.
--   * Six relative to the day the seed runs, for the flows a fixed calendar
--     can't keep current: two that ended within the listing's 30-day "past"
--     window, one ongoing, two drafts, and one published but waiting for its
--     prize pool (pending_funding).
--
-- Run it on a freshly built database (supabase/staging/drop_all.sql, then
-- `supabase db push`): migrations 001–007 first, since the roles come from
-- 007 and compute_registration_amounts / create_dependent from 003 and 006.
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

DO $$
DECLARE
  -- Keep in step with src/lib/reference/legal.ts: TERMS_VERSION (players and
  -- guardians) and, through current_organizer_agreement_version(), the
  -- Organizer Agreement. An older version here opens every seeded account
  -- behind the re-acceptance gate.
  c_terms_version constant text := '2026-11-24';

  -- Tracked IDs
  v_admin_id       uuid;
  org_profile_ids  uuid[] := '{}';
  org_user_ids     uuid[] := '{}';
  player_user_ids  uuid[] := '{}';
  -- Who pays for each player's registrations: themselves, or for a junior
  -- dependent, their parent.
  payer_user_ids   uuid[] := '{}';
  tourney_ids      uuid[] := '{}';

  -- RBAC role IDs (look them up)
  r_owner_id          integer;
  r_platform_admin_id integer;

  -- Loop / temp vars
  i            integer;
  idx          integer;
  w            integer;
  reg_idx      integer := 0;
  new_user_id  uuid;
  new_org_id   uuid;
  new_t_id     uuid;
  new_reg_id   uuid;
  v_dependent  jsonb;
  v_guardianship_id uuid;
  v_org_created timestamptz;
  v_org_reviewed timestamptz;

  -- Pre-compute bcrypt hash once
  pwd_hash     text := crypt('Abcd!234', gen_salt('bf'));

  -- Player derivation vars
  p_first      text;
  p_last       text;
  p_email      text;
  p_gender     varchar(10);
  p_dob        date;
  p_fide_std   integer;
  p_fide_rpd   integer;
  p_fide_blz   integer;
  p_nat        integer;

  -- Registration vars
  reg_status   text;
  k            integer;
  n_regs       integer;
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
  scenario_ids  uuid[];
  cal_restricted_ids uuid[];
  cal_open_ids  uuid[];
  cand_ids      uuid[];
  n_restricted  integer;

  -- Prize funding vars
  v_funder       record;
  new_fund_id    uuid;
  v_chip_id      text;
  v_funder_email text;
  n_funded       integer := 0;

  -- The tournament plan, one entry per tournament, built before inserting.
  pl_name     text[] := '{}';
  pl_start    date[] := '{}';
  pl_status   tournament_status[] := '{}';
  pl_org      integer[] := '{}';
  pl_venue    integer[] := '{}';
  pl_format   text[] := '{}';
  pl_restr    integer[] := '{}';
  pl_platform boolean[] := '{}';
  s           integer;

  -- Tournament vars
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
  junior_first  text[] := ARRAY[
    'Adam','Aiman','Mei','Iman','Arjun','Sofia','Hakim','Xin Yi','Rayyan','Kavya'
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
  -- SWIFT codes must exist in MALAYSIAN_BANKS (src/lib/reference/malaysian-banks.ts).
  org_bank_codes   text[] := ARRAY['MBBEMYKL','CIBBMYKL','PBBEMYKL','RHBBMYKL','HLBBMYKL'];
  org_bank_names   text[] := ARRAY['Maybank','CIMB Bank','Public Bank','RHB Bank','Hong Leong Bank'];
  -- tournaments.organizer_commission_pct per organizer: how much of the
  -- platform fee the organizer absorbs (0 = player pays it all, 10 = organizer
  -- absorbs it all). Varied so seeded payments exercise every split
  -- compute_registration_amounts can produce.
  org_commission_pct smallint[] := ARRAY[0, 3, 10, 0, 5];

  -- Venues carry their own state/region and timezone: a tournament's dates are
  -- calendar dates at its venue, so the two have to agree (tournaments.timezone;
  -- picklist in VENUE_TIME_ZONES, src/lib/tournaments/datetime.ts).
  --
  -- Positions 7–9 are outside Malaysia, two at UTC+7, which is what makes a
  -- seeded database disagree with Malaysia about what day it is.
  venue_names text[] := ARRAY[
    'KL Convention Centre',           'Sunway Pyramid Convention Centre',
    'Penang Chess Academy',           'Johor Bahru Chess Club',
    'Ipoh Chess Centre',              'Alor Setar Municipal Hall',
    'Bangkok Chess Club',             'Jakarta Chess Arena',
    'Singapore Chess Centre',
    'Kota Kinabalu Convention Centre','Kuching Chess Federation Hall',
    'Seremban Chess Hall',            'Kuantan Sports Complex'
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
    '22 Jalan Padungan, 93100 Kuching, Sarawak',
    'Jalan Dato Bandar Tunggal, 70000 Seremban, Negeri Sembilan',
    'Jalan Stadium, 25200 Kuantan, Pahang'
  ];
  venue_states text[] := ARRAY[
    'W.P. Kuala Lumpur','Selangor','Pulau Pinang','Johor',
    'Perak','Kedah',
    'Bangkok','Jakarta','Singapore',
    'Sabah','Sarawak',
    'Negeri Sembilan','Pahang'
  ];
  venue_tz text[] := ARRAY[
    'Asia/Kuala_Lumpur','Asia/Kuala_Lumpur','Asia/Kuala_Lumpur','Asia/Kuala_Lumpur',
    'Asia/Kuala_Lumpur','Asia/Kuala_Lumpur',
    'Asia/Bangkok','Asia/Jakarta','Asia/Singapore',
    'Asia/Kuala_Lumpur','Asia/Kuala_Lumpur',
    'Asia/Kuala_Lumpur','Asia/Kuala_Lumpur'
  ];
  -- ISO 3166-1 alpha-2 of each venue (tournaments.venue_country). Deliberately
  -- separate from the timezone above: the country decides which payout rails and
  -- currency the money moves on, the timezone decides how the dates read.
  --
  -- TH/ID/SG are NOT in SUPPORTED_COUNTRIES (src/lib/tournaments/venues.ts is
  -- MY-only today). They exist to exercise cross-country reads; editing one
  -- through the creation wizard falls back to MY, the accepted cost of seeding
  -- venues the picklist cannot yet express.
  venue_countries text[] := ARRAY[
    'MY','MY','MY','MY',
    'MY','MY',
    'TH','ID','SG',
    'MY','MY',
    'MY','MY'
  ];

  -- The 2027 calendar cycles through these series week by week, so each runs
  -- four times a year, about three months apart. The month goes in the name,
  -- which keeps names (and so slugs) unique.
  -- Restriction codes: 0 open, 1 Malaysians only, 2 under 18, 3 women only,
  -- 4 under 1800, 5 Malaysians under 21.
  series_names text[] := ARRAY[
    'KL Open Chess Championship',        'Selangor Rapid Chess Tournament',
    'Penang International Chess Festival','Johor Chess Open',
    'Perak State Championship',          'Kedah Open Chess Tournament',
    'Bangkok Open Chess Championship',   'Jakarta Rapid Chess Open',
    'Singapore Blitz Chess Open',        'Sabah Rapid Chess Open',
    'Sarawak Women''s Chess Festival',   'National Age Group Championship',
    'KL Junior Chess Championship'
  ];
  series_venue  integer[] := ARRAY[1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 1, 2];
  series_format text[] := ARRAY[
    'classical', 'rapid', 'classical', 'rapid', 'classical', 'rapid',
    'classical', 'rapid', 'blitz', 'rapid', 'classical', 'classical', 'rapid'
  ];
  series_restr  integer[] := ARRAY[0, 0, 0, 0, 1, 4, 0, 0, 0, 0, 3, 5, 2];

  -- Prize funding. Entry fees never fund prizes (src/lib/tournaments/prize-funding.ts), so
  -- every category carrying money must name an external source and the party
  -- putting it up. Publish validation rejects one that doesn't, so seeded
  -- tournaments have to declare it or they could not be re-published.
  funding_srcs text[] := ARRAY['sponsor','grant','organizer'];
  funder_names text[] := ARRAY[
    'Maybank Foundation',
    'Ministry of Youth and Sports',
    NULL  -- 'organizer' names the organizing body itself; filled in per row
  ];
  fee_opts  integer[] := ARRAY[3000, 4000, 5000, 6000, 8000];
  max_parts integer[] := ARRAY[64, 80, 100, 128, 150];

BEGIN

  SELECT id INTO r_owner_id FROM roles WHERE name = 'owner';
  SELECT id INTO r_platform_admin_id FROM roles WHERE name = 'platform_admin';

  -- ===========================================================================
  -- 0. PLATFORM ADMIN
  -- A global-scope admin (platform.manage) — assigned via user_global_roles, not
  -- an organization membership. Reviews organizer applications, CHIP checks, etc.
  -- ===========================================================================
  RAISE NOTICE '[0/5] Seeding platform admin...';

  v_admin_id := gen_random_uuid();

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
    v_admin_id,
    '00000000-0000-0000-0000-000000000000',
    'authenticated', 'authenticated',
    'review@chip.com', pwd_hash,
    now(),
    '{"provider":"email","providers":["email"]}',
    -- terms_version rides in the metadata exactly as the signup route sends it,
    -- so handle_new_user records the acceptance the same way it does in
    -- production.
    json_build_object('first_name', 'CHIP', 'last_name', 'Review',
                      'terms_version', c_terms_version),
    now(), now(),
    '', '', '', '', '', '', '', ''
  );

  -- Email/password sign-in resolves through auth.identities; raw inserts into
  -- auth.users bypass the Auth Admin API, so create the identity explicitly.
  INSERT INTO auth.identities (
    provider_id, user_id, identity_data, provider,
    last_sign_in_at, created_at, updated_at
  ) VALUES (
    v_admin_id::text, v_admin_id,
    jsonb_build_object('sub', v_admin_id::text, 'email', 'review@chip.com',
                       'email_verified', true, 'phone_verified', false),
    'email', now(), now(), now()
  );

  -- Mark verified so the account is immediately login-ready.
  INSERT INTO public.users (id, auth_user_id, email, first_name, last_name, is_verified, verified_at)
  VALUES (v_admin_id, v_admin_id, 'review@chip.com', 'CHIP', 'Review', true, now())
  ON CONFLICT (id) DO UPDATE SET
    auth_user_id = EXCLUDED.auth_user_id,
    is_verified = true,
    verified_at = now();

  INSERT INTO public.user_global_roles (user_id, role_id)
  VALUES (v_admin_id, r_platform_admin_id);

  RAISE NOTICE '  > 1 platform admin created (review@chip.com)';

  -- ===========================================================================
  -- 1. ORGANIZERS
  -- Each applied four months ago and was approved by the platform admin the
  -- next day, as create_organization_application and
  -- review_organization_application would leave it: the organization, its
  -- registered name, its application history and its owner membership.
  -- ===========================================================================
  RAISE NOTICE '[1/5] Seeding organizers...';

  FOR i IN 1..5 LOOP
    new_user_id := gen_random_uuid();
    v_org_created  := now() - interval '120 days' + make_interval(hours => i);
    v_org_reviewed := v_org_created + interval '1 day';

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
                        'terms_version', c_terms_version),
      now(), now(),
      '', '', '', '', '', '', '', ''
    );

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

    -- Adult organizers: a date of birth, as signup now asks for one.
    UPDATE public.player_profiles
      SET date_of_birth = date '1975-03-01' + i * 400, nationality = 'Malaysia'
      WHERE user_id = new_user_id;

    org_user_ids := array_append(org_user_ids, new_user_id);

    -- Seeded organizations accept the current Organizer Agreement, otherwise
    -- every seeded dashboard opens behind the re-acceptance gate.
    INSERT INTO public.organizations (
      name, description, email,
      phone, approval_status, reviewed_at,
      reviewed_by, created_by,
      entity_type, registration_number,
      agreement_version, agreement_accepted_at, agreement_accepted_by,
      created_at
    ) VALUES (
      org_names[i], org_descs[i], org_emails[i],
      '+601' || (i + 1)::text || '-' || (1000000 + i * 123456)::text,
      'approved', v_org_reviewed,
      v_admin_id, new_user_id,
      'society', 'PPM-' || lpad(i::text, 3, '0') || '-14-01012020',
      current_organizer_agreement_version(), v_org_created, new_user_id,
      v_org_created
    ) RETURNING id INTO new_org_id;

    org_profile_ids := array_append(org_profile_ids, new_org_id);

    -- A society's registered name is the one on its ROS registration, which
    -- payout holder names are matched against (#374).
    INSERT INTO public.organization_registered_names (organization_id, registered_name, created_at, updated_at)
    VALUES (new_org_id, upper(org_names[i]), v_org_created, v_org_created);

    INSERT INTO public.organization_application_events (organization_id, event, actor_id, created_at)
    VALUES
      (new_org_id, 'submitted', new_user_id, v_org_created),
      (new_org_id, 'approved',  v_admin_id,  v_org_reviewed);

    INSERT INTO public.organization_memberships (organization_id, user_id, role_id, joined_at)
    VALUES (new_org_id, new_user_id, r_owner_id, v_org_reviewed);

    -- Inserted directly rather than through set_organization_bank_account,
    -- which can only ever produce a 'pending' row (CHIP Send is what verifies,
    -- from #519). A seed needs the end state, not the starting one: the CHIP
    -- Send recipient id a verified account carries, and the holder name the
    -- bank returned, which matched. The ids are fake; nothing calls CHIP with
    -- them until payouts run against a sandbox.
    INSERT INTO public.organization_bank_accounts (
      organization_id, bank_name, bank_code, account_holder, account_number,
      status, chip_bank_account_id, verified_at, bank_holder_name, created_by
    ) VALUES (
      new_org_id, org_bank_names[i], org_bank_codes[i], org_names[i],
      '5140' || lpad((1000000 + i * 98765)::text, 8, '0'),
      'verified', 900000 + i, now(), upper(org_names[i]), new_user_id
    );
  END LOOP;

  RAISE NOTICE '  > 5 approved organizers created (each with a verified payout bank account)';

  -- ===========================================================================
  -- 2. PLAYERS
  -- Every 5th player is a junior. Under-18s can't hold an account (#710), so a
  -- junior is a managed dependent of the player before them, created the way
  -- the app creates one (create_dependent): no login, a 'minor' guardianship
  -- with their parent, who accepted the Terms for them.
  -- ===========================================================================
  RAISE NOTICE '[2/5] Seeding players...';

  FOR i IN 1..50 LOOP
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

    p_gender := CASE WHEN i % 4 = 0 THEN 'female' ELSE 'male' END;
    -- Deterministic but varied ratings
    p_fide_std := CASE WHEN i % 3 != 0 THEN 1000 + (i * 23) % 1200 ELSE NULL END;
    p_fide_rpd := CASE WHEN p_fide_std IS NOT NULL THEN p_fide_std - 50 + (i % 100) ELSE NULL END;
    p_fide_blz := CASE WHEN p_fide_std IS NOT NULL THEN p_fide_std - 100 + (i % 80) ELSE NULL END;
    p_nat    := 800 + (i * 31) % 1300;

    IF i % 5 = 0 THEN
      -- Aged 8 to 15 on the day the seed runs, so none turns 18 during 2027
      -- and sets off the age-out emails (#721).
      p_dob := (current_date - make_interval(years => 8 + (i / 5) % 8))::date - (i * 13) % 300;
      v_dependent := create_dependent(
        p_guardian_user_id => player_user_ids[i - 1],
        p_first_name       => junior_first[i / 5],
        -- The parent's surname.
        p_last_name        => (SELECT last_name FROM users WHERE id = player_user_ids[i - 1]),
        p_date_of_birth    => p_dob,
        p_relationship     => (CASE WHEN i % 10 = 0 THEN 'legal_guardian' ELSE 'parent' END)::guardianship_relationship,
        p_basis            => 'minor',
        p_terms_version    => c_terms_version,
        p_gender           => p_gender::gender,
        p_nationality      => 'Malaysia'
      );
      new_user_id := (v_dependent ->> 'dependent_id')::uuid;

      UPDATE public.player_profiles SET
        fide_id         = CASE WHEN p_fide_std IS NOT NULL THEN 10000000 + i * 7 END,
        mcf_id          = 20000 + i,
        fide_rating     = CASE WHEN p_fide_std IS NOT NULL THEN
                            json_build_object('standard', p_fide_std, 'rapid', p_fide_rpd, 'blitz', p_fide_blz)::jsonb
                          END,
        national_rating = p_nat
      WHERE user_id = new_user_id;

      player_user_ids := array_append(player_user_ids, new_user_id);
      payer_user_ids  := array_append(payer_user_ids, player_user_ids[i - 1]);
      CONTINUE;
    END IF;

    new_user_id := gen_random_uuid();
    p_email  := lower(p_first) || '.' || lower(p_last) || i || '@mct.com';
    -- Aged 19 to 43 on the day the seed runs.
    p_dob := (current_date - interval '19 years')::date - (i * 173) % 9000;

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
      -- date_of_birth rides in the metadata as signup sends it (#710).
      json_build_object('first_name', p_first, 'last_name', p_last,
                        'terms_version', c_terms_version,
                        'date_of_birth', p_dob),
      now() - (i || ' days')::interval,
      now() - (i || ' days')::interval,
      '', '', '', '', '', '', '', ''
    );

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
    payer_user_ids  := array_append(payer_user_ids, new_user_id);

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
      p_dob,
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

  -- A helper (#719): player 3 invited player 2 to help with their account, and
  -- player 2 accepted. The accepted invitation and the 'authorised'
  -- guardianship it created, as accept_helper_invitation leaves them.
  INSERT INTO public.guardianships (
    guardian_user_id, dependent_user_id, relationship, basis,
    terms_version, terms_accepted_at, authorisation_method, created_at
  ) VALUES (
    player_user_ids[2], player_user_ids[3], 'carer', 'authorised',
    c_terms_version, now() - interval '9 days', 'player_invite', now() - interval '9 days'
  ) RETURNING id INTO v_guardianship_id;

  INSERT INTO public.helper_invitations (
    player_user_id, email, relationship, token_hash, status,
    created_at, expires_at, responded_at, responded_by, guardianship_id
  ) VALUES (
    player_user_ids[3],
    (SELECT email FROM users WHERE id = player_user_ids[2]),
    'carer',
    encode(sha256(convert_to(gen_random_uuid()::text, 'UTF8')), 'hex'),
    'accepted',
    now() - interval '10 days', now() - interval '10 days' + interval '72 hours',
    now() - interval '9 days', player_user_ids[2], v_guardianship_id
  );

  RAISE NOTICE '  > 50 players created: 40 accounts, 10 junior dependents, 1 helper';

  -- ===========================================================================
  -- 3. TOURNAMENTS
  -- Planned first, then inserted in one loop. The six relative ones come
  -- first, then the 2027 calendar.
  -- ===========================================================================
  RAISE NOTICE '[3/5] Seeding tournaments...';

  -- Relative to the day the seed runs.
  pl_name     := ARRAY['Klang Valley Weekend Swiss', 'Penang Heritage Rapid',
                       'Ipoh Chess Centre Classic', 'Negeri Sembilan Chess Open',
                       'Pahang Chess Classic', 'Merdeka Prize Chess Open'];
  pl_start    := ARRAY[current_date - 20, current_date - 6, current_date - 1,
                       current_date + 80, current_date + 94, current_date + 108];
  pl_status   := ARRAY['published', 'published', 'published',
                       'draft', 'draft', 'pending_funding']::tournament_status[];
  pl_org      := ARRAY[1, 2, 3, 4, 5, 5];
  pl_venue    := ARRAY[1, 3, 5, 12, 13, 1];
  pl_format   := ARRAY['rapid', 'rapid', 'classical', 'classical', 'classical', 'classical'];
  pl_restr    := ARRAY[0, 1, 0, 0, 4, 0];
  -- The pending_funding one distributes its prizes through the platform, so
  -- publishing it parked it there: visible to its organizer, hidden from the
  -- public. Seeded without funder contacts, so no funding request exists: the
  -- daily reconcile run reports the missing addresses instead of creating CHIP
  -- purchases and emailing sponsors from staging.
  pl_platform := ARRAY[false, false, false, false, false, true];

  -- Every Saturday of 2027, then the year-end blitz on Friday 31 December, the
  -- one week (27–31 December) without a Saturday in 2027. Every 5th week's
  -- prizes go through the platform, funded below.
  FOR w IN 1..52 LOOP
    s := ((w - 1) % array_length(series_names, 1)) + 1;
    pl_name     := pl_name || (series_names[s] || ' (' || to_char(date '2027-01-02' + (w - 1) * 7, 'FMMonth YYYY') || ')');
    pl_start    := pl_start || (date '2027-01-02' + (w - 1) * 7);
    pl_status   := pl_status || 'published'::tournament_status;
    pl_org      := pl_org || ((w - 1) % 5 + 1);
    pl_venue    := pl_venue || series_venue[s];
    pl_format   := pl_format || series_format[s];
    pl_restr    := pl_restr || series_restr[s];
    pl_platform := pl_platform || (w % 5 = 0);
  END LOOP;
  pl_name     := pl_name || 'KL Year-End Blitz (December 2027)'::text;
  pl_start    := pl_start || date '2027-12-31';
  pl_status   := pl_status || 'published'::tournament_status;
  pl_org      := pl_org || 5;
  pl_venue    := pl_venue || 1;
  pl_format   := pl_format || 'blitz'::text;
  pl_restr    := pl_restr || 0;
  pl_platform := pl_platform || false;

  FOR idx IN 1..array_length(pl_name, 1) LOOP
    t_start    := pl_start[idx];
    -- Classical events run over the weekend; rapid and blitz finish in a day.
    t_end      := t_start + CASE WHEN pl_format[idx] = 'classical' THEN 1 ELSE 0 END;
    t_deadline := (t_start - 7)::timestamptz;
    t_status   := pl_status[idx];
    i          := pl_org[idx];
    v_idx      := pl_venue[idx];

    -- Published three weeks before the seed ran, or two weeks before the
    -- start if that is earlier, so it is never in the future and always leaves
    -- a registration window before the deadline. Satisfies chk_published_at.
    t_published_at := LEAST((t_start - 14)::timestamptz, now() - interval '21 days');

    t_fee := fee_opts[((idx - 1) % 5) + 1];
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

    t_restrictions := CASE pl_restr[idx]
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
      pl_name[idx],
      -- Published tournaments get a public slug (matches slugify() in
      -- src/lib/tournaments/slugs.ts), pending_funding included; drafts have
      -- none. Seed names are unique → no collision.
      CASE
        WHEN t_status <> 'draft'::tournament_status
        THEN regexp_replace(
               regexp_replace(lower(pl_name[idx]), '[^a-z0-9]+', '-', 'g'),
               '(^-+|-+$)', '', 'g'
             )
        ELSE NULL
      END,
      pl_name[idx] || ' — a competitive ' || pl_format[idx] || ' chess event.',
      venue_names[v_idx],
      venue_states[v_idx],
      venue_addrs[v_idx],
      venue_countries[v_idx],
      venue_tz[v_idx],
      t_start, t_end, t_deadline,
      json_build_object(
        'type',   pl_format[idx],
        'system', 'swiss',
        'rounds', CASE pl_format[idx] WHEN 'classical' THEN 7 WHEN 'rapid' THEN 9 ELSE 11 END
      ),
      CASE pl_format[idx]
        WHEN 'classical' THEN json_build_object('base_minutes', 90, 'increment_seconds', 30, 'delay_seconds', 0)
        WHEN 'rapid'     THEN json_build_object('base_minutes', 15, 'increment_seconds', 10, 'delay_seconds', 0)
        ELSE                  json_build_object('base_minutes', 3,  'increment_seconds', 2,  'delay_seconds', 0)
      END,
      (pl_format[idx] = 'classical' OR idx % 2 = 0),
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
        -- not category-shaped (SpecialPrizeJson, src/lib/tournaments/prize-funding.ts).
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
        -- Who hands the money to the winners: the organizer, or the platform
        -- out of a ring-fenced, sponsor-funded pool.
        'distribution', CASE WHEN pl_platform[idx] THEN 'platform' ELSE 'organizer' END
      ),
      t_restrictions,
      max_parts[((idx - 1) % 5) + 1],
      org_commission_pct[i],
      t_status,
      CASE WHEN t_status <> 'draft'::tournament_status THEN org_user_ids[i] ELSE NULL END,
      CASE WHEN t_status <> 'draft'::tournament_status THEN t_published_at ELSE NULL END,
      -- registration_closed_at defaults to the deadline at publish; drafts NULL.
      CASE WHEN t_status <> 'draft'::tournament_status THEN t_deadline ELSE NULL END
    ) RETURNING id INTO new_t_id;

    tourney_ids := array_append(tourney_ids, new_t_id);
  END LOOP;

  RAISE NOTICE '  > % tournaments created: 53 on the 2027 calendar, 2 recently ended, 1 ongoing, 1 awaiting prize funding, 2 drafts',
    array_length(tourney_ids, 1);

  -- ===========================================================================
  -- 4. PRIZE FUNDING
  --
  -- A platform-distributed tournament is only listed once its prize pool is
  -- fully funded (release_funded_tournament, 006); until then it waits in
  -- 'pending_funding' and nobody can register. So every published one here must
  -- carry its sponsors' paid contributions, or it would be listed with the
  -- registration button disabled (#660). Shaped like what the app produces:
  --   * one prize_funder_contacts row per funder, as the organizer enters them;
  --   * one prize_fundings request per funder for its declared share
  --     (reconcile_prize_funding_requests), settled as settle_prize_funding
  --     settles a paid one: a type='prize_funding' ledger row in payments, which
  --     is what prize_pool_position counts as funded.
  -- Paid half an hour after publishing, which releases the tournament before
  -- the first registration (an hour after publishing, section 5).
  -- ===========================================================================
  RAISE NOTICE '[4/5] Seeding prize funding...';

  FOR v_t IN
    SELECT * FROM tournaments
    WHERE id = ANY(tourney_ids)
      AND status = 'published'
      AND prizes->>'distribution' = 'platform'
  LOOP
    FOR v_funder IN SELECT * FROM declared_prize_funders(v_t.prizes) LOOP
      new_fund_id  := gen_random_uuid();
      v_settled_at := v_t.published_at + interval '30 minutes';
      v_chip_id    := 'SEED-' || upper(substring(md5(new_fund_id::text), 1, 12));
      -- example.com never receives mail, should anything ever email it.
      v_funder_email := 'prizes@'
        || regexp_replace(
             regexp_replace(v_funder.funder_key, '[^a-z0-9]+', '-', 'g'),
             '(^-+|-+$)', '', 'g'
           )
        || '.example.com';

      INSERT INTO public.prize_funder_contacts (tournament_id, funder_name, funder_email, created_at, updated_at)
      VALUES (v_t.id, v_funder.funder_name, v_funder_email, v_t.published_at, v_t.published_at);

      INSERT INTO public.payments (
        type, tournament_id, user_id, organization_id,
        gross_amount_cents, platform_fee_cents, organizer_commission_cents,
        player_commission_cents, net_amount_cents, currency,
        payment_method, chip_transaction_id, status, paid_at, created_at
      ) VALUES (
        'prize_funding', v_t.id, NULL, v_t.organization_id,
        v_funder.amount_cents, 0, 0,
        0, v_funder.amount_cents, 'MYR',
        'fpx_b2c', v_chip_id, 'paid', v_settled_at, v_settled_at
      ) RETURNING id INTO new_pay_id;

      INSERT INTO public.prize_fundings (
        id, tournament_id, funder_name, funder_email, amount_cents,
        status, chip_transaction_id, payment_method, payment_id, paid_at,
        created_at, updated_at
      ) VALUES (
        new_fund_id, v_t.id, v_funder.funder_name, v_funder_email, v_funder.amount_cents,
        'paid', v_chip_id, 'fpx_b2c', new_pay_id, v_settled_at,
        v_t.published_at, v_settled_at
      );
    END LOOP;

    IF NOT (SELECT p.fully_funded FROM prize_pool_position(v_t.id) p) THEN
      RAISE EXCEPTION 'seed: % is listed but its prize pool is not fully funded', v_t.name;
    END IF;
    n_funded := n_funded + 1;
  END LOOP;

  RAISE NOTICE '  > % listed platform-distributed tournaments fully funded', n_funded;

  -- ===========================================================================
  -- 5. REGISTRATIONS & PAYMENTS
  --
  -- Shaped like what the payment functions in 006 produce, not hand-rolled:
  --   * every registration has one payment attempt (payments is a per-attempt
  --     ledger) and points at it through registrations.current_payment_id;
  --   * the payer is kept apart from the participant (#708): a junior's
  --     registration is the junior's (registrations.user_id), made and paid
  --     for by their parent (registered_by, payments.user_id);
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
  --
  -- Each player tries two of the three ended / ongoing tournaments (so the
  -- payout flows have plenty of paid entries), then up to three restricted 2027
  -- events they're eligible for (so the junior, women's and rating-capped
  -- events have entrants), then the open ones, each list starting from the
  -- player's own week, until they have eight registrations.
  -- ===========================================================================
  RAISE NOTICE '[5/5] Seeding registrations and payments...';

  scenario_ids := tourney_ids[1:3];
  SELECT array_agg(id ORDER BY start_date) FILTER (WHERE restrictions IS NOT NULL),
         array_agg(id ORDER BY start_date) FILTER (WHERE restrictions IS NULL)
    INTO cal_restricted_ids, cal_open_ids
    FROM tournaments
    WHERE id = ANY(tourney_ids[7:]);

  FOR i IN 1..50 LOOP
    SELECT * INTO v_pp FROM player_profiles WHERE user_id = player_user_ids[i];
    n_regs := 0;
    n_restricted := 0;

    cand_ids := '{}';
    FOR k IN 0..2 LOOP
      IF (i + k) % 3 <> 0 THEN
        cand_ids := cand_ids || scenario_ids[k + 1];
      END IF;
    END LOOP;
    cand_ids := cand_ids
      -- Age- and gender-restricted events first: the fewest players can enter.
      || (SELECT array_agg(c.id ORDER BY
                   NOT jsonb_path_exists(t.restrictions, '$[*] ? (@.type == "age" || @.type == "gender")'),
                   (c.ord + (i - 1) * 7) % array_length(cal_restricted_ids, 1))
            FROM unnest(cal_restricted_ids) WITH ORDINALITY AS c(id, ord)
            JOIN tournaments t ON t.id = c.id)
      || (SELECT array_agg(c.id ORDER BY (c.ord + (i - 1) * 7) % array_length(cal_open_ids, 1))
            FROM unnest(cal_open_ids) WITH ORDINALITY AS c(id, ord));

    FOREACH new_t_id IN ARRAY cand_ids LOOP
      EXIT WHEN n_regs = 8;
      SELECT * INTO v_t FROM tournaments WHERE id = new_t_id;
      CONTINUE WHEN v_t.restrictions IS NOT NULL
                AND NOT (v_t.id = ANY(scenario_ids))
                AND n_restricted = 3;

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
      IF v_t.restrictions IS NOT NULL AND NOT (v_t.id = ANY(scenario_ids)) THEN
        n_restricted := n_restricted + 1;
      END IF;

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
        registered_at, confirmed_at, cancelled_at, cancellation_reason,
        registered_by
      ) VALUES (
        player_user_ids[i], v_t.id, v_tier, reg_status::registration_status,
        v_reg_at,
        CASE WHEN reg_status = 'confirmed' THEN v_settled_at END,
        CASE WHEN reg_status = 'cancelled_payment' THEN v_reg_at + interval '10 minutes' END,
        CASE WHEN reg_status = 'cancelled_payment' THEN 'payment_expired' END,
        NULLIF(payer_user_ids[i], player_user_ids[i])
      ) RETURNING id INTO new_reg_id;

      INSERT INTO public.payments (
        type, tournament_id, registration_id, user_id, organization_id,
        gross_amount_cents, platform_fee_cents,
        organizer_commission_cents, player_commission_cents, net_amount_cents,
        fee_tier, currency, payment_method, chip_transaction_id,
        status, paid_at, created_at
      ) VALUES (
        'registration', v_t.id, new_reg_id, payer_user_ids[i], v_t.organization_id,
        v_amounts.gross_amount_cents, v_amounts.platform_fee_cents,
        v_amounts.organizer_commission_cents, v_amounts.player_commission_cents,
        v_amounts.net_amount_cents,
        v_tier,
        'MYR',
        -- CHIP's transaction_data.payment_method values, as the webhook records them.
        CASE WHEN reg_status = 'confirmed'
          THEN (ARRAY['fpx_b2c','visa','mastercard','dnqr','fpx_b2c'])[(reg_idx % 5) + 1]
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
