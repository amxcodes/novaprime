-- Verify office-local dates use one stable statement clock across timezones.
-- Test-only fixture; always rollback.

BEGIN;
GRANT nova_app TO CURRENT_USER;
SET LOCAL ROLE nova_app;

SELECT nova.bootstrap_organisation(
  'NOVA business-date clock test',
  'business-date-clock-admin@example.test',
  'Business Date Clock Admin',
  'better-auth-subject-business-date-clock'
);

DO $$
DECLARE
  v_actor_id uuid;
  v_organisation_id uuid;
  v_person_id uuid;
  v_office_id uuid;
  v_timezone text;
  v_mismatch_count integer;
  v_definition text;
BEGIN
  SELECT user_id, organisation_id INTO v_actor_id, v_organisation_id
  FROM nova.resolve_authenticated_actor('better-auth-subject-business-date-clock');
  PERFORM set_config('nova.user_id', v_actor_id::text, true);
  PERFORM set_config('nova.organisation_id', v_organisation_id::text, true);

  CREATE TEMP TABLE business_date_clock_people (
    person_id uuid PRIMARY KEY,
    timezone text NOT NULL
  ) ON COMMIT DROP;

  FOREACH v_timezone IN ARRAY ARRAY[
    'Pacific/Kiritimati', 'America/Adak', 'Asia/Kolkata', 'UTC'
  ] LOOP
    INSERT INTO nova.offices (organisation_id, name, timezone)
    VALUES (v_organisation_id, 'Clock ' || v_timezone, v_timezone)
    RETURNING id INTO v_office_id;
    INSERT INTO nova.people (organisation_id, email, display_name)
    VALUES (
      v_organisation_id,
      'business-date-' || lower(replace(v_timezone, '/', '-')) || '@example.test',
      v_timezone
    )
    RETURNING id INTO v_person_id;
    INSERT INTO nova.person_office_assignments (person_id, office_id, effective_on)
    VALUES (v_person_id, v_office_id, DATE '2000-01-01');
    INSERT INTO business_date_clock_people (person_id, timezone)
    VALUES (v_person_id, v_timezone);
  END LOOP;

  SELECT pg_get_functiondef('nova.person_business_date(uuid)'::regprocedure)
  INTO v_definition;
  IF v_definition NOT LIKE '%statement_timestamp()%'
     OR v_definition LIKE '%clock_timestamp()%' THEN
    RAISE EXCEPTION 'person_business_date does not use one statement-stable clock';
  END IF;

  SELECT count(*) INTO v_mismatch_count
  FROM business_date_clock_people people
  WHERE nova.person_business_date(people.person_id)
    IS DISTINCT FROM (statement_timestamp() AT TIME ZONE people.timezone)::date;
  IF v_mismatch_count <> 0 THEN
    RAISE EXCEPTION 'office-local business date disagreed with the shared statement instant';
  END IF;
END;
$$;

ROLLBACK;
