-- Personal presentation settings are separate from roles, permissions, and
-- operational policy. The authenticated API is the only supported boundary.

CREATE TABLE nova.personal_ui_preferences (
  organisation_id uuid NOT NULL REFERENCES nova.organisations(id),
  person_id uuid NOT NULL REFERENCES nova.people(id),
  schema_version smallint NOT NULL CHECK (schema_version > 0),
  revision integer NOT NULL DEFAULT 1 CHECK (revision > 0),
  preferences jsonb NOT NULL DEFAULT '{}'::jsonb
    CHECK (jsonb_typeof(preferences) = 'object'),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (organisation_id, person_id)
);

ALTER TABLE nova.personal_ui_preferences ENABLE ROW LEVEL SECURITY;

CREATE POLICY personal_ui_preferences_owner ON nova.personal_ui_preferences
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
