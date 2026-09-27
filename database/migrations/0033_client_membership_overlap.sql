-- Effective-dated client membership cannot overlap for one person/client.
ALTER TABLE nova.client_memberships
  ADD CONSTRAINT client_memberships_no_overlap
  EXCLUDE USING gist (
    client_id WITH =,
    person_id WITH =,
    daterange(effective_on, COALESCE(effective_until + 1, 'infinity'::date), '[)') WITH &&
  );
