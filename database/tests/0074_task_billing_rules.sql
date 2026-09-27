-- Definition classification is admin-set per client workstream; users never
-- select the class. Corrections use their own definition/default rule.
BEGIN;
GRANT nova_app TO CURRENT_USER;
SET LOCAL ROLE nova_app;

SELECT nova.bootstrap_organisation(
  'NOVA predefined billing rule test',
  'nova-predefined-billing-admin@example.test',
  'Predefined Billing Admin',
  'better-auth-subject-predefined-billing'
);

DO $$
DECLARE
  v_actor_id uuid;
  v_organisation_id uuid;
  v_other_organisation_id uuid := gen_random_uuid();
  v_client_id uuid;
  v_billable_stream_id uuid;
  v_non_billable_stream_id uuid;
  v_entry_id uuid;
  v_correction_entry_id uuid;
  v_non_billable_task_id uuid;
  v_billable_task_id uuid;
  v_inherited_task_id uuid;
  v_original_task_id uuid;
  v_correction_task_id uuid;
  v_error text;
BEGIN
  SELECT user_id, organisation_id INTO v_actor_id, v_organisation_id
  FROM nova.resolve_authenticated_actor('better-auth-subject-predefined-billing');
  PERFORM set_config('nova.user_id', v_actor_id::text, true);
  PERFORM set_config('nova.organisation_id', v_organisation_id::text, true);

  INSERT INTO nova.clients (organisation_id, name, created_by_person_id)
  VALUES (v_organisation_id, 'Predefined billing client', v_actor_id)
  RETURNING id INTO v_client_id;
  INSERT INTO nova.client_workstreams (organisation_id, client_id, name, created_by_person_id)
  VALUES (v_organisation_id, v_client_id, 'Billable default stream', v_actor_id)
  RETURNING id INTO v_billable_stream_id;
  INSERT INTO nova.client_workstreams (organisation_id, client_id, name, created_by_person_id)
  VALUES (v_organisation_id, v_client_id, 'Non-billable default stream', v_actor_id)
  RETURNING id INTO v_non_billable_stream_id;
  UPDATE nova.client_workstreams SET billing_policy_class = 'billable'
  WHERE id = v_billable_stream_id;
  UPDATE nova.client_workstreams SET billing_policy_class = 'non_billable'
  WHERE id = v_non_billable_stream_id;

  INSERT INTO nova.task_catalog_entries (organisation_id, title, created_by_person_id)
  VALUES (v_organisation_id, 'Shared reusable task', v_actor_id)
  RETURNING id INTO v_entry_id;
  INSERT INTO nova.task_catalog_entries (organisation_id, title, created_by_person_id)
  VALUES (v_organisation_id, 'Correction reusable task', v_actor_id)
  RETURNING id INTO v_correction_entry_id;

  INSERT INTO nova.client_workstream_task_billing_rules (
    organisation_id, client_workstream_id, task_catalog_entry_id, billing_class
  ) VALUES (v_organisation_id, v_billable_stream_id, v_entry_id, 'non_billable');
  INSERT INTO nova.client_workstream_task_billing_rules (
    organisation_id, client_workstream_id, task_catalog_entry_id, billing_class
  ) VALUES (v_organisation_id, v_non_billable_stream_id, v_entry_id, 'billable');
  INSERT INTO nova.client_workstream_task_billing_rules (
    organisation_id, client_workstream_id, task_catalog_entry_id, billing_class
  ) VALUES (v_organisation_id, v_billable_stream_id, v_correction_entry_id, 'non_billable');

  INSERT INTO nova.tasks (
    organisation_id, client_workstream_id, title, task_catalog_entry_id,
    task_catalog_revision, billing_class, created_by_person_id
  ) VALUES (
    v_organisation_id, v_billable_stream_id, 'Definition override to non-billable',
    v_entry_id, 1, 'billable', v_actor_id
  ) RETURNING id INTO v_non_billable_task_id;
  IF (SELECT billing_class FROM nova.tasks WHERE id = v_non_billable_task_id) <> 'non_billable'
     OR (SELECT billing_policy_source FROM nova.tasks WHERE id = v_non_billable_task_id) <> 'client_workstream_task_definition'
     OR (SELECT billing_policy_revision FROM nova.tasks WHERE id = v_non_billable_task_id) <> 1 THEN
    RAISE EXCEPTION 'database did not apply the authorized per-definition rule';
  END IF;

  INSERT INTO nova.tasks (
    organisation_id, client_workstream_id, title, task_catalog_entry_id,
    task_catalog_revision, created_by_person_id
  ) VALUES (
    v_organisation_id, v_non_billable_stream_id, 'Same definition billable in another stream',
    v_entry_id, 1, v_actor_id
  ) RETURNING id INTO v_billable_task_id;
  IF (SELECT billing_class FROM nova.tasks WHERE id = v_billable_task_id) <> 'billable'
     OR (SELECT billing_policy_source FROM nova.tasks WHERE id = v_billable_task_id) <> 'client_workstream_task_definition' THEN
    RAISE EXCEPTION 'same catalog entry did not use its independent workstream rule';
  END IF;

  INSERT INTO nova.tasks (
    organisation_id, client_workstream_id, title, task_catalog_entry_id,
    task_catalog_revision, created_by_person_id
  ) VALUES (
    v_organisation_id, v_billable_stream_id, 'Rule reset inherits workstream default',
    v_entry_id, 1, v_actor_id
  ) RETURNING id INTO v_inherited_task_id;
  UPDATE nova.client_workstream_task_billing_rules SET billing_class = NULL
  WHERE client_workstream_id = v_billable_stream_id AND task_catalog_entry_id = v_entry_id;
  IF (SELECT billing_class FROM nova.tasks WHERE id = v_inherited_task_id) <> 'non_billable'
     OR (SELECT billing_class FROM nova.client_workstream_task_billing_rules
         WHERE client_workstream_id = v_billable_stream_id AND task_catalog_entry_id = v_entry_id) IS NOT NULL
     OR (SELECT revision FROM nova.client_workstream_task_billing_rules
         WHERE client_workstream_id = v_billable_stream_id AND task_catalog_entry_id = v_entry_id) <> 2 THEN
    RAISE EXCEPTION 'reset-to-inherit rewrote history or lost its own rule revision';
  END IF;
  INSERT INTO nova.tasks (
    organisation_id, client_workstream_id, title, task_catalog_entry_id,
    task_catalog_revision, created_by_person_id
  ) VALUES (
    v_organisation_id, v_billable_stream_id, 'Future task inherits default',
    v_entry_id, 1, v_actor_id
  );
  IF (SELECT billing_class FROM nova.tasks WHERE title = 'Future task inherits default') <> 'billable'
     OR (SELECT billing_policy_source FROM nova.tasks WHERE title = 'Future task inherits default') <> 'client_workstream'
     OR (SELECT billing_policy_revision FROM nova.tasks WHERE title = 'Future task inherits default') <> 1 THEN
    RAISE EXCEPTION 'future task did not use the current workstream default after reset';
  END IF;

  INSERT INTO nova.tasks (
    organisation_id, client_workstream_id, title, status, created_by_person_id
  ) VALUES (
    v_organisation_id, v_billable_stream_id, 'Approved source task', 'done', v_actor_id
  ) RETURNING id INTO v_original_task_id;
  INSERT INTO nova.tasks (
    organisation_id, client_workstream_id, title, correction_of_task_id,
    correction_reason, task_catalog_entry_id, task_catalog_revision, created_by_person_id
  ) VALUES (
    v_organisation_id, v_billable_stream_id, 'Correction follows its own definition rule',
    v_original_task_id, 'Fix the accepted work output.', v_correction_entry_id, 1, v_actor_id
  ) RETURNING id INTO v_correction_task_id;
  IF (SELECT billing_class FROM nova.tasks WHERE id = v_original_task_id) <> 'billable'
     OR (SELECT billing_class FROM nova.tasks WHERE id = v_correction_task_id) <> 'non_billable'
     OR (SELECT billing_policy_source FROM nova.tasks WHERE id = v_correction_task_id) <> 'client_workstream_task_definition'
     OR (SELECT correction_of_task_id FROM nova.tasks WHERE id = v_correction_task_id) <> v_original_task_id THEN
    RAISE EXCEPTION 'correction copied the source class instead of its own automatic rule';
  END IF;

  BEGIN
    UPDATE nova.client_workstream_task_billing_rules SET revision = 999
    WHERE client_workstream_id = v_billable_stream_id AND task_catalog_entry_id = v_entry_id;
    RAISE EXCEPTION 'rule revision accepted client-supplied provenance';
  EXCEPTION WHEN check_violation THEN
    GET STACKED DIAGNOSTICS v_error = MESSAGE_TEXT;
    IF v_error <> 'TASK_BILLING_RULE_PROVENANCE_SERVER_ASSIGNED' THEN RAISE; END IF;
  END;

  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'nova' AND table_name IN ('task_catalog_entries', 'task_catalog_proposals')
      AND column_name IN ('billing_class', 'billing_policy_class')
  ) THEN
    RAISE EXCEPTION 'catalog content unexpectedly owns billing classification';
  END IF;

  PERFORM set_config('nova.organisation_id', v_other_organisation_id::text, true);
  IF EXISTS (SELECT 1 FROM nova.client_workstream_task_billing_rules) THEN
    RAISE EXCEPTION 'row security exposed billing rules across organisations';
  END IF;
END;
$$;

ROLLBACK;
