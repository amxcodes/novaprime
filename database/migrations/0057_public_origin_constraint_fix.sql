-- 0056 stores URL.origin (without a trailing slash). Keep the database
-- invariant aligned with the canonical application representation.
ALTER TABLE nova.organisation_runtime_settings
  DROP CONSTRAINT organisation_runtime_settings_public_origin_check;

ALTER TABLE nova.organisation_runtime_settings
  ADD CONSTRAINT organisation_runtime_settings_public_origin_check
  CHECK (
    public_origin IS NULL
    OR (
      char_length(btrim(public_origin)) BETWEEN 10 AND 500
      AND public_origin !~ '[[:space:]]'
      AND public_origin ~ '^https?://[^/?#]+$'
    )
  );
