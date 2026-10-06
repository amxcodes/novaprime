-- New updater-managed migrations record the exact SQL source hash alongside
-- the legacy filename ledger. Historical rows stay NULL; the updater verifies
-- those against a trusted release manifest instead of inventing evidence.
ALTER TABLE public.nova_schema_migrations
  ADD COLUMN sha256 text;
