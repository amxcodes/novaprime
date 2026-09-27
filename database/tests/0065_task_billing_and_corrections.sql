-- Billing classification is derived from work context. A correction is a
-- separately linked task and is classified by the same active policy.
BEGIN;
GRANT nova_app TO CURRENT_USER;
SET LOCAL ROLE nova_app;

SELECT nova.bootstrap_organisation(
  'NOVA task billing and correction test',
  'task-billing-correction-admin@example.test',
  'Task Billing Correction Admin',
  'better-auth-subject-task-billing-correction'
);

DO $$
DECLARE
  v_actor_id uuid;
  v_organisation_id uuid;
  v_client_id uuid;
  v_workstream_id uuid;
  v_other_workstream_id uuid;
  v_original_id uuid;
  v_correction_id uuid;
  v_assignment_id uuid;
  v_session_id uuid;
  v_error text;
BEGIN
  SELECT user_id, organisation_id INTO v_actor_id, v_organisation_id
  FROM nova.resolve_authenticated_actor('better-auth-subject-task-billing-correction');
  PERFORM set_config('nova.user_id', v_actor_id::text, true);
  PERFORM set_config('nova.organisation_id', v_organisation_id::text, true);

  INSERT INTO nova.clients (organisation_id, name, created_by_person_id)
  VALUES (v_organisation_id, 'Billing Client', v_actor_id)
  RETURNING id INTO v_client_id;
  INSERT INTO nova.client_workstreams (organisation_id, client_id, name, created_by_person_id)
  VALUES (v_organisation_id, v_client_id, 'Billing Workstream', v_actor_id)
  RETURNING id INTO v_workstream_id;
  INSERT INTO nova.client_workstreams (organisation_id, client_id, name, created_by_person_id)
  VALUES (v_organisation_id, v_client_id, 'Different Workstream', v_actor_id)
  RETURNING id INTO v_other_workstream_id;
  UPDATE nova.client_workstreams SET billing_policy_class = 'billable'
  WHERE id = v_other_workstream_id;

  BEGIN
    INSERT INTO nova.tasks (
      organisation_id, client_workstream_id, title, billing_class, created_by_person_id
    ) VALUES (
      v_organisation_id, v_workstream_id, 'Blocked until policy exists', 'billable', v_actor_id
    );
    RAISE EXCEPTION 'unconfigured client workstream accepted a task';
  EXCEPTION WHEN check_violation THEN
    GET STACKED DIAGNOSTICS v_error = MESSAGE_TEXT;
    IF v_error <> 'TASK_BILLING_POLICY_NOT_CONFIGURED' THEN RAISE; END IF;
  END;

  UPDATE nova.client_workstreams
  SET billing_policy_class = 'billable'
  WHERE id = v_workstream_id;
  IF (SELECT billing_policy_revision FROM nova.client_workstreams WHERE id = v_workstream_id) <> 1
     OR (SELECT billing_policy_set_by_person_id FROM nova.client_workstreams WHERE id = v_workstream_id) <> v_actor_id
     OR (SELECT billing_policy_set_at FROM nova.client_workstreams WHERE id = v_workstream_id) IS NULL THEN
    RAISE EXCEPTION 'policy update did not create actor-attributed revision 1';
  END IF;

  INSERT INTO nova.tasks (
    organisation_id, client_workstream_id, title, status, billing_class, created_by_person_id
  ) VALUES (
    v_organisation_id, v_workstream_id, 'Completed original', 'done', 'non_billable', v_actor_id
  ) RETURNING id INTO v_original_id;
  IF (SELECT billing_class FROM nova.tasks WHERE id = v_original_id) <> 'billable'
     OR (SELECT billing_policy_source FROM nova.tasks WHERE id = v_original_id) <> 'client_workstream'
     OR (SELECT billing_policy_revision FROM nova.tasks WHERE id = v_original_id) <> 1 THEN
    RAISE EXCEPTION 'task input overrode the workstream billing policy';
  END IF;

  INSERT INTO nova.tasks (
    organisation_id, client_workstream_id, title, correction_of_task_id,
    correction_reason, billing_class, created_by_person_id
  ) VALUES (
    v_organisation_id, v_workstream_id, 'Correction under current policy', v_original_id,
    'Correct the approved deliverable.', 'non_billable', v_actor_id
  ) RETURNING id INTO v_correction_id;
  IF (SELECT billing_class FROM nova.tasks WHERE id = v_correction_id) <> 'billable'
     OR (SELECT correction_of_task_id FROM nova.tasks WHERE id = v_correction_id) <> v_original_id THEN
    RAISE EXCEPTION 'correction inherited source class or accepted submitted class';
  END IF;

  INSERT INTO nova.task_assignments (
    organisation_id, task_id, person_id, review_required, assigned_by_person_id
  ) VALUES (v_organisation_id, v_original_id, v_actor_id, false, v_actor_id)
  RETURNING id INTO v_assignment_id;
  INSERT INTO nova.work_sessions (organisation_id, assignment_id, person_id)
  VALUES (v_organisation_id, v_assignment_id, v_actor_id)
  RETURNING id INTO v_session_id;
  IF (SELECT billing_class_snapshot FROM nova.work_sessions WHERE id = v_session_id) <> 'billable' THEN
    RAISE EXCEPTION 'work session did not snapshot task classification';
  END IF;

  UPDATE nova.client_workstreams SET billing_policy_class = 'non_billable'
  WHERE id = v_workstream_id;
  IF (SELECT billing_policy_revision FROM nova.client_workstreams WHERE id = v_workstream_id) <> 2
     OR (SELECT billing_class FROM nova.tasks WHERE id = v_original_id) <> 'billable'
     OR (SELECT billing_class_snapshot FROM nova.work_sessions WHERE id = v_session_id) <> 'billable' THEN
    RAISE EXCEPTION 'policy change rewrote a historical task or work-session snapshot';
  END IF;
  INSERT INTO nova.tasks (
    organisation_id, client_workstream_id, title, correction_of_task_id,
    correction_reason, billing_class, created_by_person_id
  ) VALUES (
    v_organisation_id, v_workstream_id, 'Correction after policy change', v_original_id,
    'Use the current workstream classification.', 'billable', v_actor_id
  );
  IF (SELECT billing_class FROM nova.tasks
      WHERE title = 'Correction after policy change') <> 'non_billable' THEN
    RAISE EXCEPTION 'correction did not use the current policy';
  END IF;

  BEGIN
    UPDATE nova.client_workstreams SET billing_policy_revision = 99 WHERE id = v_workstream_id;
    RAISE EXCEPTION 'policy revision accepted caller-supplied provenance';
  EXCEPTION WHEN check_violation THEN
    GET STACKED DIAGNOSTICS v_error = MESSAGE_TEXT;
    IF v_error <> 'TASK_BILLING_POLICY_PROVENANCE_SERVER_ASSIGNED' THEN RAISE; END IF;
  END;

  BEGIN
    UPDATE nova.tasks SET billing_class = 'non_billable' WHERE id = v_original_id;
    RAISE EXCEPTION 'task billing class was mutable after creation';
  EXCEPTION WHEN check_violation THEN
    GET STACKED DIAGNOSTICS v_error = MESSAGE_TEXT;
    IF v_error <> 'TASK_BILLING_PROVENANCE_IMMUTABLE' THEN RAISE; END IF;
  END;

  BEGIN
    UPDATE nova.work_sessions SET billing_class_snapshot = 'non_billable' WHERE id = v_session_id;
    RAISE EXCEPTION 'work-session billing snapshot was mutable';
  EXCEPTION WHEN check_violation THEN
    GET STACKED DIAGNOSTICS v_error = MESSAGE_TEXT;
    IF v_error <> 'WORK_SESSION_BILLING_SNAPSHOT_IMMUTABLE' THEN RAISE; END IF;
  END;

  BEGIN
    INSERT INTO nova.tasks (
      organisation_id, client_workstream_id, title, correction_of_task_id,
      correction_reason, created_by_person_id
    ) VALUES (
      v_organisation_id, v_other_workstream_id, 'Wrong-workstream correction', v_original_id,
      'Must remain with original workstream.', v_actor_id
    );
    RAISE EXCEPTION 'correction link crossed workstream boundaries';
  EXCEPTION WHEN check_violation THEN
    GET STACKED DIAGNOSTICS v_error = MESSAGE_TEXT;
    IF v_error <> 'TASK_CORRECTION_WORKSTREAM_MISMATCH' THEN RAISE; END IF;
  END;

  INSERT INTO nova.tasks (
    organisation_id, client_workstream_id, title, created_by_person_id
  ) VALUES (v_organisation_id, v_workstream_id, 'Not completed', v_actor_id);
  BEGIN
    INSERT INTO nova.tasks (
      organisation_id, client_workstream_id, title, correction_of_task_id,
      correction_reason, created_by_person_id
    ) VALUES (
      v_organisation_id, v_workstream_id, 'Premature correction',
      (SELECT id FROM nova.tasks WHERE title = 'Not completed'),
      'The source is still active.', v_actor_id
    );
    RAISE EXCEPTION 'correction linked to unfinished original';
  EXCEPTION WHEN check_violation THEN
    GET STACKED DIAGNOSTICS v_error = MESSAGE_TEXT;
    IF v_error <> 'TASK_CORRECTION_SOURCE_NOT_COMPLETE' THEN RAISE; END IF;
  END;

  UPDATE nova.tasks SET status = 'done' WHERE id = v_correction_id;
  BEGIN
    INSERT INTO nova.tasks (
      organisation_id, client_workstream_id, title, correction_of_task_id,
      correction_reason, created_by_person_id
    ) VALUES (
      v_organisation_id, v_workstream_id, 'Nested correction', v_correction_id,
      'A correction cannot itself be corrected.', v_actor_id
    );
    RAISE EXCEPTION 'nested correction should have been rejected';
  EXCEPTION WHEN check_violation THEN
    GET STACKED DIAGNOSTICS v_error = MESSAGE_TEXT;
    IF v_error <> 'TASK_CORRECTION_NESTING_NOT_ALLOWED' THEN RAISE; END IF;
  END;
END;
$$;

ROLLBACK;
