-- Correction is a distinct task relationship, not a billing adjustment. Its
-- class comes from the current workstream policy, not its source's snapshot.
BEGIN;
GRANT nova_app TO CURRENT_USER;
SET LOCAL ROLE nova_app;

SELECT nova.bootstrap_organisation(
  'NOVA correction billing source test',
  'nova-correction-billing-source@example.test',
  'Correction Billing Source Admin',
  'better-auth-subject-correction-billing-source'
);

DO $$
DECLARE
  v_actor_id uuid;
  v_organisation_id uuid;
  v_client_id uuid;
  v_workstream_id uuid;
  v_source_id uuid;
  v_correction_id uuid;
  v_second_correction_id uuid;
  v_assignment_id uuid;
  v_session_class nova.task_billing_class;
BEGIN
  SELECT user_id, organisation_id INTO v_actor_id, v_organisation_id
  FROM nova.resolve_authenticated_actor('better-auth-subject-correction-billing-source');
  PERFORM set_config('nova.user_id', v_actor_id::text, true);
  PERFORM set_config('nova.organisation_id', v_organisation_id::text, true);
  INSERT INTO nova.clients (organisation_id, name, created_by_person_id)
  VALUES (v_organisation_id, 'Correction client', v_actor_id)
  RETURNING id INTO v_client_id;
  INSERT INTO nova.client_workstreams (organisation_id, client_id, name, created_by_person_id)
  VALUES (v_organisation_id, v_client_id, 'Correction workstream', v_actor_id)
  RETURNING id INTO v_workstream_id;
  UPDATE nova.client_workstreams SET billing_policy_class = 'billable'
  WHERE id = v_workstream_id;

  INSERT INTO nova.tasks (
    organisation_id, client_workstream_id, title, status, created_by_person_id
  ) VALUES (
    v_organisation_id, v_workstream_id, 'Original billable work', 'done', v_actor_id
  ) RETURNING id INTO v_source_id;
  IF (SELECT billing_class FROM nova.tasks WHERE id = v_source_id) <> 'billable' THEN
    RAISE EXCEPTION 'original task did not use configured workstream policy';
  END IF;

  INSERT INTO nova.task_assignments (
    organisation_id, task_id, person_id, review_required, assigned_by_person_id
  ) VALUES (v_organisation_id, v_source_id, v_actor_id, false, v_actor_id)
  RETURNING id INTO v_assignment_id;
  INSERT INTO nova.work_sessions (organisation_id, assignment_id, person_id)
  VALUES (v_organisation_id, v_assignment_id, v_actor_id);
  SELECT billing_class_snapshot INTO v_session_class FROM nova.work_sessions
  WHERE assignment_id = v_assignment_id;
  IF v_session_class <> 'billable' THEN
    RAISE EXCEPTION 'work session did not snapshot original task classification';
  END IF;

  UPDATE nova.client_workstreams SET billing_policy_class = 'non_billable'
  WHERE id = v_workstream_id;
  INSERT INTO nova.tasks (
    organisation_id, client_workstream_id, title, correction_of_task_id,
    correction_reason, billing_class, created_by_person_id
  ) VALUES (
    v_organisation_id, v_workstream_id, 'First correction', v_source_id,
    'Correct the approved deliverable.', 'billable', v_actor_id
  ) RETURNING id INTO v_correction_id;
  INSERT INTO nova.tasks (
    organisation_id, client_workstream_id, title, correction_of_task_id,
    correction_reason, billing_class, created_by_person_id
  ) VALUES (
    v_organisation_id, v_workstream_id, 'Second correction', v_source_id,
    'A second independent correction is allowed.', 'billable', v_actor_id
  ) RETURNING id INTO v_second_correction_id;

  IF (SELECT billing_class FROM nova.tasks WHERE id = v_correction_id) <> 'non_billable'
     OR (SELECT billing_class FROM nova.tasks WHERE id = v_second_correction_id) <> 'non_billable'
     OR (SELECT correction_of_task_id FROM nova.tasks WHERE id = v_correction_id) <> v_source_id
     OR (SELECT billing_class FROM nova.tasks WHERE id = v_source_id) <> 'billable' THEN
    RAISE EXCEPTION 'correction inherited source class or rewrote source instead of using current policy';
  END IF;

  UPDATE nova.tasks SET status = 'done' WHERE id = v_correction_id;
  BEGIN
    INSERT INTO nova.tasks (
      organisation_id, client_workstream_id, title, correction_of_task_id,
      correction_reason, created_by_person_id
    ) VALUES (
      v_organisation_id, v_workstream_id, 'Nested correction', v_correction_id,
      'A correction is not itself correctable.', v_actor_id
    );
    RAISE EXCEPTION 'nested correction should be rejected';
  EXCEPTION WHEN check_violation THEN
    IF SQLERRM <> 'TASK_CORRECTION_NESTING_NOT_ALLOWED' THEN RAISE; END IF;
  END;

  BEGIN
    UPDATE nova.tasks SET correction_reason = 'Rewrite historical reason'
    WHERE id = v_correction_id;
    RAISE EXCEPTION 'correction provenance was mutable';
  EXCEPTION WHEN check_violation THEN
    IF SQLERRM <> 'TASK_BILLING_PROVENANCE_IMMUTABLE' THEN RAISE; END IF;
  END;
END;
$$;

ROLLBACK;
