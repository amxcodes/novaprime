-- 0004 was already applied to the initial Supabase Cloud target. Preserve its
-- immutable migration history while correcting the status-transition timestamp
-- boundary for all deployed databases.

CREATE OR REPLACE FUNCTION nova.complete_invitation_after_email_verification(
  p_identity_subject text
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = nova, pg_catalog
AS $$
DECLARE
  invitation_id uuid;
  v_person_id uuid;
  v_organisation_id uuid;
  v_current_effective_at timestamptz;
  v_transition_at timestamptz;
BEGIN
  SELECT
    invitations.id,
    invitations.person_id,
    people.organisation_id,
    status_periods.effective_at
  INTO
    invitation_id,
    v_person_id,
    v_organisation_id,
    v_current_effective_at
  FROM nova.person_invitations invitations
  JOIN nova.people people ON people.id = invitations.person_id
  JOIN nova_auth."user" users ON users.id = p_identity_subject
  JOIN nova.person_status_periods status_periods
    ON status_periods.person_id = people.id
    AND status_periods.ended_at IS NULL
  WHERE invitations.pending_identity_subject = p_identity_subject
    AND invitations.accepted_at IS NULL
    AND invitations.revoked_at IS NULL
    AND invitations.claimed_at IS NOT NULL
    AND users."emailVerified"
    AND users.email = invitations.invitee_email
    AND status_periods.status = 'invited'
  FOR UPDATE OF invitations, status_periods;

  IF invitation_id IS NULL THEN
    RETURN false;
  END IF;

  v_transition_at := GREATEST(
    clock_timestamp(),
    v_current_effective_at + interval '1 microsecond'
  );

  UPDATE nova.person_status_periods
  SET ended_at = v_transition_at
  WHERE person_status_periods.person_id = v_person_id
    AND ended_at IS NULL;

  INSERT INTO nova.person_status_periods (person_id, status, effective_at)
  VALUES (v_person_id, 'onboarding', v_transition_at);

  UPDATE nova.person_invitations
  SET accepted_at = now()
  WHERE id = invitation_id;

  INSERT INTO nova.audit_events (
    organisation_id, actor_person_id, action, target_type, target_id, details
  ) VALUES (
    v_organisation_id,
    v_person_id,
    'people.invitation.accepted',
    'person_invitation',
    invitation_id,
    jsonb_build_object('identity_provider', 'better_auth')
  );

  RETURN true;
END;
$$;

REVOKE ALL ON FUNCTION nova.complete_invitation_after_email_verification(text) FROM PUBLIC;
