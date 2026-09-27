-- Policy changes are actor-attributed and apply only to future tasks; task and
-- session provenance remain immutable snapshots. Test-only; always rollback.
BEGIN;
GRANT nova_app TO CURRENT_USER;
SET LOCAL ROLE nova_app;

SELECT nova.bootstrap_organisation(
  'NOVA billing provenance test',
  'nova-billing-provenance-admin@example.test',
  'Billing Provenance Admin',
  'better-auth-subject-billing-provenance'
);

DO $$
DECLARE
  v_actor_id uuid;
  v_organisation_id uuid;
  v_client_id uuid;
  v_workstream_id uuid;
  v_entry_id uuid;
  v_revision integer;
  v_original_id uuid;
  v_assignment_id uuid;
  v_session_id uuid;
  v_error text;
BEGIN
  SELECT user_id, organisation_id INTO v_actor_id, v_organisation_id
  FROM nova.resolve_authenticated_actor('better-auth-subject-billing-provenance');
  PERFORM set_config('nova.user_id', v_actor_id::text, true);
  PERFORM set_config('nova.organisation_id', v_organisation_id::text, true);
  INSERT INTO nova.clients (organisation_id, name, created_by_person_id)
  VALUES (v_organisation_id, 'Policy client', v_actor_id)
  RETURNING id INTO v_client_id;
  INSERT INTO nova.client_workstreams (organisation_id, client_id, name, created_by_person_id)
  VALUES (v_organisation_id, v_client_id, 'Policy workstream', v_actor_id)
  RETURNING id INTO v_workstream_id;
  INSERT INTO nova.task_catalog_entries (
    organisation_id, title, priority, created_by_person_id
  ) VALUES (
    v_organisation_id, 'Approved client deliverable', 'normal', v_actor_id
  ) RETURNING id, revision INTO v_entry_id, v_revision;

  UPDATE nova.client_workstreams SET billing_policy_class = 'non_billable'
  WHERE id = v_workstream_id;
  INSERT INTO nova.tasks (
    organisation_id, client_workstream_id, title, status, billing_class,
    task_catalog_entry_id, task_catalog_revision, created_by_person_id
  ) VALUES (
    v_organisation_id, v_workstream_id, 'Policy ignores submitted class', 'done', 'billable',
    v_entry_id, v_revision, v_actor_id
  ) RETURNING id INTO v_original_id;
  IF (SELECT billing_class FROM nova.tasks WHERE id = v_original_id) <> 'non_billable'
     OR (SELECT billing_policy_source FROM nova.tasks WHERE id = v_original_id) <> 'client_workstream'
     OR (SELECT billing_policy_revision FROM nova.tasks WHERE id = v_original_id) <> 1 THEN
    RAISE EXCEPTION 'task did not use server policy and revision';
  END IF;

  UPDATE nova.client_workstreams SET billing_policy_class = 'billable'
  WHERE id = v_workstream_id;
  SELECT revision INTO v_revision FROM nova.task_catalog_entries WHERE id = v_entry_id;
  IF (SELECT billing_policy_revision FROM nova.client_workstreams WHERE id = v_workstream_id) <> 2
     OR (SELECT billing_class FROM nova.tasks WHERE id = v_original_id) <> 'non_billable' THEN
    RAISE EXCEPTION 'policy update rewrote historical task provenance';
  END IF;

  INSERT INTO nova.tasks (
    organisation_id, client_workstream_id, title, billing_class,
    task_catalog_entry_id, task_catalog_revision, created_by_person_id
  ) VALUES (
    v_organisation_id, v_workstream_id, 'Current policy classification', 'non_billable',
    v_entry_id, v_revision, v_actor_id
  );
  IF (SELECT billing_class FROM nova.tasks WHERE title = 'Current policy classification') <> 'billable' THEN
    RAISE EXCEPTION 'new task ignored current workstream policy';
  END IF;

  INSERT INTO nova.task_assignments (
    organisation_id, task_id, person_id, review_required, assigned_by_person_id
  ) VALUES (v_organisation_id, v_original_id, v_actor_id, false, v_actor_id)
  RETURNING id INTO v_assignment_id;
  INSERT INTO nova.work_sessions (organisation_id, assignment_id, person_id)
  VALUES (v_organisation_id, v_assignment_id, v_actor_id)
  RETURNING id INTO v_session_id;
  IF (SELECT billing_class_snapshot FROM nova.work_sessions WHERE id = v_session_id) <> 'non_billable' THEN
    RAISE EXCEPTION 'session did not snapshot the task classification';
  END IF;

  BEGIN
    INSERT INTO nova.tasks (
      organisation_id, client_workstream_id, title, task_catalog_entry_id,
      task_catalog_revision, created_by_person_id
    ) VALUES (
      v_organisation_id, v_workstream_id, 'Stale catalog revision', v_entry_id, 99, v_actor_id
    );
    RAISE EXCEPTION 'task accepted a stale approved-definition revision';
  EXCEPTION WHEN check_violation THEN
    GET STACKED DIAGNOSTICS v_error = MESSAGE_TEXT;
    IF v_error <> 'TASK_CATALOG_ENTRY_OR_REVISION_INVALID' THEN RAISE; END IF;
  END;

  BEGIN
    UPDATE nova.tasks SET billing_class = 'billable' WHERE id = v_original_id;
    RAISE EXCEPTION 'task classification changed after task creation';
  EXCEPTION WHEN check_violation THEN
    GET STACKED DIAGNOSTICS v_error = MESSAGE_TEXT;
    IF v_error <> 'TASK_BILLING_PROVENANCE_IMMUTABLE' THEN RAISE; END IF;
  END;
  BEGIN
    UPDATE nova.client_workstreams SET billing_policy_revision = 88 WHERE id = v_workstream_id;
    RAISE EXCEPTION 'policy revision accepted client-supplied provenance';
  EXCEPTION WHEN check_violation THEN
    GET STACKED DIAGNOSTICS v_error = MESSAGE_TEXT;
    IF v_error <> 'TASK_BILLING_POLICY_PROVENANCE_SERVER_ASSIGNED' THEN RAISE; END IF;
  END;
END;
$$;

ROLLBACK;
