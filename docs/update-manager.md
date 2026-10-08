# NOVA Update Manager

The NOVA Update Manager coordinates a reviewed source release with its database migrations from an operator's local checkout. It prepares the source in a separate Git worktree, verifies the release's migration hashes, checks the selected database ledger, applies approved migrations, and can offer an explicit push to a configured customer GitHub repository. It is the source-and-schema upgrade tool; `bun run deployment:doctor` is the read-only support check for an already deployed installation. Moving a live installation between hosting providers, schedulers, or databases belongs to the separate [deployment manager](deployment-orchestrator-plan.md); its status, doctor, plan, and snapshot-verification foundation is implemented, while provider mutations remain gated pending complete inventory, recovery tests, and a disposable live rehearsal.

## Release availability

The updater accepts published stable GitHub releases from the canonical `amxcodes/novaprime` repository only. It does not update from a moving branch. The source checkout's package version and `release-manifest.json` must match a published stable baseline, and the target release must include its own matching manifest. This updater has not shipped in a stable NOVA release yet; maintainers must publish the baseline and a later stable version before customers can use it to update.

Maintainers should update `package.json`, append migrations only, then generate and review the release manifest:

```sh
bun run update:manifest --write --class online-compatible --impact "Describe the reviewed schema and deployment impact."
bun run update:manifest --check
```

The GitHub verification workflow checks the manifest against the migration files. Publishing a GitHub release and tag remains a maintainer action; this command does not publish releases or run migrations from GitHub Actions.

Migration SHA-256 values are calculated from UTF-8 SQL with CRLF/CR line endings normalized to LF, so the same release verifies on Windows, macOS, and Linux checkouts.

### First adoption for existing installations

An older checkout cannot run updater code it does not contain. The first updater baseline therefore needs a one-time, reviewed merge of the published baseline into the customer's local clone. Keep that merge local: do not push or deploy it yet. Then run the guided updater from the merged checkout; it accepts only a known, non-empty, contiguous database ledger prefix from the trusted migration history, verifies it against the published manifest, and applies the remaining migrations before the later optional push. The accepted prefix depends on the baseline and target release; do not rely on a hard-coded migration number. This bootstrap step does not reset the branch or discard committed customer changes; conflicts must be resolved and reviewed before continuing. Once the baseline is installed, later updates use `bun run nova:update`.

## Operator workflow

Run these commands from a full, named-branch NOVA clone with Bun installed and a clean working tree:

```sh
bun run nova:update --check
bun run nova:update --plan
bun run nova:update
```

For an isolated database environment file, prefix the updater command with
`bun --env-file=.env.qa-supabase`; for example,
`bun --env-file=.env.qa-supabase run nova:update --plan`. The child updater
does not auto-load the checkout's root `.env`, so it uses the selected
environment for both migration-target discovery and the `nova_app` preflight.

`--check` reads stable release and Git metadata; it does not modify the checkout, refs, or database. `--plan` creates a durable update branch/worktree under the operator's local NOVA state directory, then makes read-only database queries after the operator selects and confirms the target. The guided command builds and tests the pinned candidate before it asks to apply migrations.

The operator selects direct PostgreSQL or a Supabase project. PostgreSQL uses the migration-owner `MIGRATOR_DATABASE_URL`, never NOVA's restricted runtime role. Supabase Management API updates use a project-scoped token entered through a masked prompt if it is not already available in the process environment. A fine-grained token needs Database Read-write access (`database_write`) for the [query endpoint](https://supabase.com/docs/reference/api/v1-run-a-query) and Migrations Read-write access (`database_migrations_write`) for [migration requests](https://supabase.com/docs/reference/api/v1-apply-a-migration). Supabase documents the query endpoint as Beta and says migration-endpoint access is available only to selected customers; if that API is unavailable to a project, use a session-affine direct PostgreSQL connection where the provider permits it. The command displays a sanitized database identity and requires an exact target confirmation. It accepts only a non-empty, contiguous prefix of the trusted migration history, plans the remaining migrations, and refuses unknown, gapped, newer, or inconsistent ledgers.

Remote PostgreSQL URLs must specify exactly one `sslmode=verify-full`; missing, duplicate, and weaker modes are rejected before pool creation. This keeps the connection's certificate-chain and hostname verification active even when the driver is given libpq-compatibility options. Local loopback connections are exempt.

Before database writes, the operator must provide a reference and timestamp for a restorable backup or restore point from the last 24 hours and attest that it is available. The updater does not create or independently verify backups. Supabase notes that restore-point access is limited to selected customers; use an operator-controlled database backup when that feature is unavailable. Each migration is applied and recorded independently; failures stop the sequence. `--resume` pins the same release and reconciles recorded migration state before continuing.

If the operator opts to push after migrations, NOVA runs the candidate's deployment preflight against a restricted `nova_app` URL for the same selected database. The URL is read from `DATABASE_URL` or requested through a masked prompt; for Supabase, it must identify the selected project. This role/schema preflight must pass before Git receives the candidate branch. The final confirmation includes the exact configured GitHub URL and destination branch. NOVA aborts if the URL changes or resolves to the canonical NOVA repository, and rechecks that the original source checkout is still clean and at its recorded commit after migrations and preflight. This remains separate from the public app's `/api/ready` check. After a successful push, the updater can optionally check whether the configured hosted origin serves that exact commit. It offers this check only when `NOVA_PUBLIC_ORIGIN` (or `BETTER_AUTH_URL`) and `NOVA_BACKGROUND_JOB_SECRET` are present in the selected process environment. After a separate confirmation naming the exact HTTPS origin and commit, it sends the secret only to NOVA's protected, read-only `/api/internal/deployment/identity` endpoint at that origin, rejects redirects, and polls up to 21 times at 30-second intervals (about 13.5 minutes maximum including request timeouts). Only an exact full commit SHA is reported as verified. An older SHA, missing identity, timeout, or unavailable endpoint remains pending or unverified; the source push still succeeded, but the updater does not claim provider activation or application readiness. If the host does not expose this identity endpoint, check the provider's deployment and public `/api/ready` status directly. Once the endpoint is available, `bun run nova:deployment status --remote` can inspect runtime and database identity. If the credentials are not configured, add them to the selected process environment before using that command. Declining the push retains the local candidate so it can be reviewed or pushed later.

The updater pins an incomplete attempt to its original release, source checkout, and database target. If Supabase changes projects while an attempt is in progress, `--resume` intentionally refuses a different target. Re-run against the recorded target to reconcile its ledger and finish; if that target is retired or unavailable, preserve the journal and candidate for operator recovery. Do not delete the journal, manually mark migrations, or switch targets while a migration outcome is uncertain. Use the deployment doctor and [deployment recovery runbook](deployment-operations.md#diagnose-and-recover-an-existing-deployment) for diagnosis before changing the hosted database URL.

## Supported boundary and recovery

- The current workflow requires an interactive terminal, a clean full Git checkout on a named branch, and no sparse checkout, submodules, detached HEAD, or linked-worktree source checkout.
- Committed customer application changes are preserved through a merge in the isolated candidate. A merge conflict stops for manual review; the original checkout remains untouched.
- If a crash leaves a clean merge candidate whose HEAD was not saved in the journal, `--resume` shows its path and requires the operator to type the full commit SHA after reviewing the candidate before it can continue.
- The candidate and journal are stored outside the checkout in the per-user NOVA updater state directory. The journal contains release/source identifiers, a redacted database identity fingerprint, a bounded backup/PITR ID or safe label and confirmation time, and migration hashes; it never stores database credentials or URLs.
- Successful migrations and candidate `nova_app` preflight do not activate a local Bun/Docker service. After a Git push, the updater can optionally verify the exact hosted release identity as described above; this does not prove application readiness. The candidate remains a separate worktree, and local activation/restart remain operator actions.
- No force push, automatic merge, downgrade, reverse migration, app-startup update, or non-interactive `--yes` path is supported.
- The direct PostgreSQL adapter uses PostgreSQL session advisory locks. Use a session-affine direct endpoint; NOVA detects Supabase's common transaction-pooler pattern, but an arbitrary pooler may not identify itself. Supabase updates use the Management API migration endpoint with an advisory transaction lock; existing NOVA migration runners now use the same lock and check the ledger within each migration transaction. Supabase's query endpoint is currently documented as Beta, so operators should verify it is available for their project before relying on the guided migration path.

For target or release mismatch errors, stop and inspect the checkout, release tag, database ledger, and saved attempt journal. Do not manually delete candidate branches or migration-ledger rows to make an update proceed. Use the [detailed design and edge-case plan](update-manager-plan.md) for the safety model and future release gates.
