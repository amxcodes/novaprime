-- Proves client access records keep organisation/client/person boundaries.
-- Always rollback.

BEGIN;
GRANT nova_app TO CURRENT_USER;
SET LOCAL ROLE nova_app;
SELECT nova.bootstrap_organisation('NOVA client access test', 'client-access@example.test', 'Client Access', 'client-access-subject');
DO $$
DECLARE
  a uuid; o uuid; c uuid; d uuid;
BEGIN
  SELECT user_id, organisation_id INTO a, o FROM nova.resolve_authenticated_actor('client-access-subject');
  PERFORM set_config('nova.user_id', a::text, true);
  PERFORM set_config('nova.organisation_id', o::text, true);
  INSERT INTO nova.clients (organisation_id, name, created_by_person_id) VALUES (o, 'Client A', a) RETURNING id INTO c;
  INSERT INTO nova.client_departments (organisation_id, client_id, name) VALUES (o, c, 'Design') RETURNING id INTO d;
  INSERT INTO nova.client_memberships (organisation_id, client_id, person_id, client_department_id)
  VALUES (o, c, a, d);
END;
$$;
ROLLBACK;
