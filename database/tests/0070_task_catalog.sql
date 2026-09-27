-- Reusable task definitions provide task content only. Work context, not a
-- definition author, determines billing classification. Always rollback.
BEGIN;
GRANT nova_app TO CURRENT_USER;
SET LOCAL ROLE nova_app;

SELECT nova.bootstrap_organisation(
  'NOVA task catalogue test',
  'nova-task-catalog-admin@example.test',
  'Task Catalogue Admin',
  'better-auth-subject-task-catalog'
);

DO $$
DECLARE
  v_actor_id uuid;
  v_organisation_id uuid;
  v_other_organisation_id uuid := gen_random_uuid();
  v_workstream_id uuid;
  v_catalog_entry_id uuid;
  v_proposal_id uuid;
  v_task_id uuid;
  v_revision integer;
  v_task_revision integer;
  v_error text;
BEGIN
  SELECT user_id, organisation_id INTO v_actor_id, v_organisation_id
  FROM nova.resolve_authenticated_actor('better-auth-subject-task-catalog');
  PERFORM set_config('nova.user_id', v_actor_id::text, true);
  PERFORM set_config('nova.organisation_id', v_organisation_id::text, true);

  INSERT INTO nova.organisation_workstreams (organisation_id, name, created_by_person_id)
  VALUES (v_organisation_id, 'Catalogue workstream', v_actor_id)
  RETURNING id INTO v_workstream_id;
  INSERT INTO nova.task_catalog_entries (
    organisation_id, title, description, priority, created_by_person_id
  ) VALUES (
    v_organisation_id, 'Prepare client handoff', 'Reusable starting details only.', 'high', v_actor_id
  ) RETURNING id INTO v_catalog_entry_id;

  INSERT INTO nova.tasks (
    organisation_id, organisation_workstream_id, title, status, billing_class,
    task_catalog_entry_id, task_catalog_revision, created_by_person_id
  ) VALUES (
    v_organisation_id, v_workstream_id, 'Prepare client handoff', 'done', 'billable',
    v_catalog_entry_id, 1, v_actor_id
  ) RETURNING id INTO v_task_id;
  IF (SELECT billing_class FROM nova.tasks WHERE id = v_task_id) <> 'non_billable'
     OR (SELECT billing_policy_source FROM nova.tasks WHERE id = v_task_id) <> 'organisation_default'
     OR (SELECT billing_policy_revision FROM nova.tasks WHERE id = v_task_id) <> 1 THEN
    RAISE EXCEPTION 'task definition or submitted field overrode the organisation default';
  END IF;

  UPDATE nova.task_catalog_entries SET title = 'Prepare client handoff carefully'
  WHERE id = v_catalog_entry_id;
  SELECT revision INTO v_revision FROM nova.task_catalog_entries WHERE id = v_catalog_entry_id;
  SELECT task_catalog_revision INTO v_task_revision FROM nova.tasks WHERE id = v_task_id;
  IF v_revision <> 2 OR v_task_revision <> 1
     OR (SELECT billing_class FROM nova.tasks WHERE id = v_task_id) <> 'non_billable' THEN
    RAISE EXCEPTION 'catalogue content edit rewrote task provenance or classification';
  END IF;

  INSERT INTO nova.task_catalog_proposals (
    organisation_id, action, title, description, priority, reason, proposed_by_person_id
  ) VALUES (
    v_organisation_id, 'create', 'Review campaign brief', NULL, 'normal',
    'This recurring activity needs a shared default.', v_actor_id
  ) RETURNING id INTO v_proposal_id;
  IF EXISTS (
    SELECT 1 FROM nova.task_catalog_entries
    WHERE organisation_id = v_organisation_id AND lower(title) = lower('Review campaign brief')
  ) THEN
    RAISE EXCEPTION 'pending proposal became an approved task default';
  END IF;
  BEGIN
    UPDATE nova.task_catalog_proposals SET title = 'Silently edited proposal' WHERE id = v_proposal_id;
    RAISE EXCEPTION 'proposal payload was mutable after submission';
  EXCEPTION WHEN check_violation THEN
    GET STACKED DIAGNOSTICS v_error = MESSAGE_TEXT;
    IF v_error <> 'TASK_CATALOG_PROPOSAL_IMMUTABLE' THEN RAISE; END IF;
  END;

  PERFORM set_config('nova.organisation_id', v_other_organisation_id::text, true);
  IF EXISTS (SELECT 1 FROM nova.task_catalog_entries WHERE id = v_catalog_entry_id)
     OR EXISTS (SELECT 1 FROM nova.task_catalog_proposals WHERE id = v_proposal_id) THEN
    RAISE EXCEPTION 'row security exposed catalogue data across organisations';
  END IF;
  BEGIN
    INSERT INTO nova.task_catalog_entries (
      organisation_id, title, priority, created_by_person_id
    ) VALUES (v_organisation_id, 'Cross-tenant write', 'normal', v_actor_id);
    RAISE EXCEPTION 'row security accepted a cross-tenant catalogue write';
  EXCEPTION WHEN check_violation THEN
    GET STACKED DIAGNOSTICS v_error = MESSAGE_TEXT;
    IF v_error <> 'TASK_CATALOG_ACTOR_ORGANISATION_MISMATCH' THEN RAISE; END IF;
  END;
END;
$$;

ROLLBACK;
