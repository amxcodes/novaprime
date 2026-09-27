-- Better Auth owns session storage, but NOVA owns whether a person may have a
-- normal session. The unmapped founding account is permitted only until the
-- single organisation bootstrap has completed.

CREATE FUNCTION nova.can_create_auth_session(p_identity_subject text)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = nova, pg_catalog
AS $$
  SELECT CASE
    WHEN EXISTS (
      SELECT 1
      FROM nova.person_identities identities
      JOIN nova.person_status_periods status_periods
        ON status_periods.person_id = identities.person_id
        AND status_periods.ended_at IS NULL
      WHERE identities.provider = 'better_auth'
        AND identities.subject = p_identity_subject
        AND identities.revoked_at IS NULL
    ) THEN EXISTS (
      SELECT 1
      FROM nova.person_identities identities
      JOIN nova.person_status_periods status_periods
        ON status_periods.person_id = identities.person_id
        AND status_periods.ended_at IS NULL
      WHERE identities.provider = 'better_auth'
        AND identities.subject = p_identity_subject
        AND identities.revoked_at IS NULL
        AND status_periods.status IN ('onboarding', 'active', 'notice')
    )
    ELSE NOT EXISTS (SELECT 1 FROM nova.organisations)
  END;
$$;

REVOKE ALL ON FUNCTION nova.can_create_auth_session(text) FROM PUBLIC;
