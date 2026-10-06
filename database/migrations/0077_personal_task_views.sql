-- Keep reusable task filters in their own owner-scoped record instead of the
-- generic appearance/workspace JSON document.
CREATE TABLE nova.personal_task_views (
  organisation_id uuid NOT NULL REFERENCES nova.organisations(id),
  person_id uuid NOT NULL REFERENCES nova.people(id),
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  schema_version smallint NOT NULL DEFAULT 1 CHECK (schema_version = 1),
  revision integer NOT NULL DEFAULT 1 CHECK (revision > 0),
  sort_order smallint NOT NULL CHECK (sort_order >= 0 AND sort_order < 12),
  name text NOT NULL CHECK (btrim(name) <> '' AND name = btrim(name) AND char_length(name) <= 40),
  collection text NOT NULL CHECK (collection IN ('mine', 'visible')),
  status text NOT NULL,
  due_filter text NOT NULL CHECK (due_filter IN ('any', 'overdue', 'today', 'upcoming', 'unscheduled')),
  search_text text NOT NULL DEFAULT '' CHECK (char_length(search_text) <= 100 AND search_text = btrim(search_text)),
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  PRIMARY KEY (organisation_id, person_id, id),
  UNIQUE (organisation_id, person_id, sort_order) DEFERRABLE INITIALLY DEFERRED,
  CHECK (
    (collection = 'mine' AND status IN (
      'all', 'assigned', 'in_progress', 'submitted', 'awaiting_review', 'changes_requested', 'approved'
    ))
    OR
    (collection = 'visible' AND status IN (
      'open', 'all', 'backlog', 'ready', 'in_progress', 'submitted', 'approved', 'done',
      'blocked', 'returned', 'cancelled'
    ))
  )
);

CREATE INDEX personal_task_views_owner_order
  ON nova.personal_task_views (organisation_id, person_id, sort_order, id);

ALTER TABLE nova.personal_task_views ENABLE ROW LEVEL SECURITY;

CREATE POLICY personal_task_views_owner ON nova.personal_task_views
FOR ALL USING (
  nova.request_has_valid_actor()
  AND organisation_id = nova.request_organisation_id()
  AND person_id = nova.request_user_id()
)
WITH CHECK (
  nova.request_has_valid_actor()
  AND organisation_id = nova.request_organisation_id()
  AND person_id = nova.request_user_id()
);

-- Preserve valid legacy filters under their owner while removing search text
-- from the generic preference document. Invalid/duplicate legacy entries are
-- discarded; the API enforces the same finite schema for all new records.
WITH legacy_rows AS (
  SELECT preferences.organisation_id, preferences.person_id,
         source.item, source.ordinality
  FROM nova.personal_ui_preferences preferences
  JOIN nova.people people
    ON people.id = preferences.person_id
   AND people.organisation_id = preferences.organisation_id
  CROSS JOIN LATERAL jsonb_array_elements(
    CASE
      WHEN jsonb_typeof(preferences.preferences -> 'workspace') = 'object'
       AND jsonb_typeof(preferences.preferences #> '{workspace,savedViews}') = 'array'
      THEN preferences.preferences #> '{workspace,savedViews}'
      ELSE '[]'::jsonb
    END
  ) WITH ORDINALITY AS source(item, ordinality)
), valid_legacy_rows AS (
  SELECT legacy_rows.*
  FROM legacy_rows
  WHERE jsonb_typeof(legacy_rows.item) = 'object'
    AND (
      SELECT count(*) = 6
      FROM jsonb_object_keys(
        CASE WHEN jsonb_typeof(legacy_rows.item) = 'object' THEN legacy_rows.item ELSE '{}'::jsonb END
      ) AS keys(key)
    )
    AND legacy_rows.item ?& ARRAY['id', 'name', 'collection', 'status', 'due', 'search']
    AND jsonb_typeof(legacy_rows.item -> 'id') = 'string'
    AND (legacy_rows.item ->> 'id') ~* '^[a-z0-9-]{1,36}$'
    AND jsonb_typeof(legacy_rows.item -> 'name') = 'string'
    AND btrim(legacy_rows.item ->> 'name') <> ''
    AND legacy_rows.item ->> 'name' = btrim(legacy_rows.item ->> 'name')
    AND char_length(legacy_rows.item ->> 'name') <= 40
    AND jsonb_typeof(legacy_rows.item -> 'collection') = 'string'
    AND jsonb_typeof(legacy_rows.item -> 'status') = 'string'
    AND (
      ((legacy_rows.item ->> 'collection') = 'mine' AND (legacy_rows.item ->> 'status') IN (
        'all', 'assigned', 'in_progress', 'submitted', 'awaiting_review', 'changes_requested', 'approved'
      ))
      OR
      ((legacy_rows.item ->> 'collection') = 'visible' AND (legacy_rows.item ->> 'status') IN (
        'open', 'all', 'backlog', 'ready', 'in_progress', 'submitted', 'approved', 'done',
        'blocked', 'returned', 'cancelled'
      ))
    )
    AND jsonb_typeof(legacy_rows.item -> 'due') = 'string'
    AND (legacy_rows.item ->> 'due') IN ('any', 'overdue', 'today', 'upcoming', 'unscheduled')
    AND jsonb_typeof(legacy_rows.item -> 'search') = 'string'
    AND char_length(legacy_rows.item ->> 'search') <= 100
    AND legacy_rows.item ->> 'search' = btrim(legacy_rows.item ->> 'search')
), deduplicated_legacy_rows AS (
  SELECT valid_legacy_rows.*,
         row_number() OVER (
           PARTITION BY valid_legacy_rows.organisation_id, valid_legacy_rows.person_id,
                        valid_legacy_rows.item ->> 'id'
           ORDER BY valid_legacy_rows.ordinality
         ) AS duplicate_rank
  FROM valid_legacy_rows
), selected_legacy_rows AS (
  SELECT deduplicated_legacy_rows.*,
         row_number() OVER (
           PARTITION BY deduplicated_legacy_rows.organisation_id, deduplicated_legacy_rows.person_id
           ORDER BY deduplicated_legacy_rows.ordinality
         ) AS owner_order
  FROM deduplicated_legacy_rows
  WHERE deduplicated_legacy_rows.duplicate_rank = 1
)
INSERT INTO nova.personal_task_views (
  organisation_id, person_id, sort_order, name, collection, status, due_filter, search_text
)
SELECT organisation_id, person_id, (owner_order - 1)::smallint,
       item ->> 'name', item ->> 'collection', item ->> 'status', item ->> 'due', item ->> 'search'
FROM selected_legacy_rows
WHERE owner_order <= 12;

UPDATE nova.personal_ui_preferences
SET preferences = jsonb_set(
      preferences,
      '{workspace}',
      (preferences -> 'workspace') - 'savedViews',
      false
    ),
    revision = revision + 1,
    updated_at = clock_timestamp()
WHERE jsonb_typeof(preferences -> 'workspace') = 'object'
  AND (preferences -> 'workspace') ? 'savedViews';
