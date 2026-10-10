# NOVA guided updater plan

**Status:** V1 implementation in progress; the current operator workflow and its release prerequisites are documented in [update-manager.md](update-manager.md). The updater is not generally customer-ready until the baseline and first update are rehearsed against disposable PostgreSQL and Supabase projects.
**Planning baseline:** 1 October 2026.
**Purpose:** safely update a NOVA source checkout and its database while leaving the operator in control of deployment.

## Recommendation

Build a local, operator-run **NOVA Update Manager** (`bun run nova:update`). It runs from the NOVA clone on a trusted computer or server. It checks a published NOVA release, prepares a Git update without discarding customer work, shows the target database and pending migrations, applies the approved database upgrade, and then offers to push the source update to the operator's GitHub repository. A push can trigger the operator's connected Netlify, Vercel, or Cloudflare deployment.

Keep three responsibilities explicit:

```text
NOVA release source       local updater              customer-owned hosting
Git tag + release notes → safe checkout update → optional push/deploy
                          ↓
                   PostgreSQL migration
              (Supabase Cloud or direct Postgres)
```

GitHub's hosting integration deploys code. It does not infer, authorize, or apply NOVA database migrations. Supabase stores the database; it does not update a customer's application checkout. The updater coordinates those separate operations from the operator's clone.

The updater is a CLI, not a browser feature, background service, app self-update, or generic Git GUI. It must never update on application startup or on an employee's behalf.

## Existing behavior and implementation boundary

| Concern | Current repository behavior | Updater implication |
| --- | --- | --- |
| Supabase setup | `bun run setup:supabase` asks for a project reference and management token, resolves a pooler, applies canonical migrations through the Supabase Management API, provisions/checks `nova_app`, and runs preflight. Each migration is wrapped in the shared advisory transaction lock with an in-transaction ledger check. | The updater reuses only the migration behavior; it does not repeat bootstrap role/password or origin configuration. NOVA's bootstrap and updater writers serialize with each other, while arbitrary SQL writers that ignore the lock remain outside that guarantee. |
| Direct PostgreSQL migrations | `bun run migrate` uses `MIGRATOR_DATABASE_URL`; the migration runner sorts `database/migrations/*.sql`, checks `public.nova_schema_migrations`, serializes runners with a PostgreSQL advisory lock, and commits each migration independently. | Keep this as the canonical path for direct PostgreSQL and suitable Docker/VPS installs. |
| Application access | The app runtime uses restricted `DATABASE_URL` credentials for `nova_app`; it must not use the migration owner, Supabase `postgres`, or `service_role`. | The updater must keep migration and runtime credentials separate. |
| Local app deployment | Setup/runbook flows use Bun or Docker Compose. The updater prepares a separate candidate worktree and does not switch the active checkout or restart local services. | Local Bun/Docker activation remains an explicit operator step after a successful migration. Do not mistake a migrated database for a running new API. |
| Hosted app deployment | Netlify, Vercel, and Cloudflare can deploy commits from a connected Git repository. Provider variables and secrets remain host-owned. | An optional push is a source/deployment action. Do not copy runtime secrets into Git or GitHub Actions as a side effect. |
| GitHub workflow | `.github/workflows/verify.yml` runs repository checks, including updater coordinator and database-adapter tests through `bun run test`; it does not publish NOVA releases or apply production migrations. The tests use controlled adapters and do not verify a live Supabase project, GitHub release, or hosting-provider deployment. | Keep release publication separate. Rehearse the operator workflow against a disposable project before broad support; never update from an unpinned moving branch. |
| Version model | The repository package version is `0.1.2`; this checkout has no local `v*` tags. The operator guide keeps customer use gated on a published stable baseline and a later stable release. Remote release availability must be checked separately before rollout. | Publish and rehearse immutable release identifiers before customer rollout. |
| Migration integrity | Migration 0076 adds nullable SHA-256 storage for new ledger rows. Existing rows are filename-only and must match a trusted release history. | The updater compares all canonical SQL with the release manifest, accepts only a non-empty contiguous ledger prefix, and stores normalized checksums for new migrations. |
| Supabase credentials | The setup flow removes its project management token from the persisted `.env` after bootstrap. Both setup and updater use the shared masked terminal prompt when a token is requested interactively. | Keep tokens in memory for that run only; never persist or print them. Non-interactive operation must receive credentials through its private process environment. |

Primary code references: [`scripts/setup.ts`](../scripts/setup.ts), [`server/src/supabase-bootstrap.ts`](../server/src/supabase-bootstrap.ts), [`server/src/migrate.ts`](../server/src/migrate.ts), [`server/src/supabase-project-confirmation.ts`](../server/src/supabase-project-confirmation.ts), [`docs/deployment-operations.md`](deployment-operations.md), and [`.github/workflows/verify.yml`](../.github/workflows/verify.yml).

## Supported operator and installation models

The same updater should cover the following arrangements without coupling its database code to a particular web host:

| Installation | Source/update owner | Database target | How the new app becomes live |
| --- | --- | --- | --- |
| Local Bun app + Supabase Cloud | Local operator clone | Confirmed Supabase project | Restart the local API from the updated checkout. |
| Customer GitHub fork + Supabase + Netlify/Vercel/Cloudflare | Customer fork with canonical NOVA upstream | Confirmed Supabase project | Optional push to the connected branch; the host deploys that commit. Otherwise the operator deploys manually. |
| Customer GitHub repository + direct PostgreSQL + hosted app | Customer-owned repository | Direct PostgreSQL reachable from the operator's machine | Optional push/host deploy, or the operator's documented deployment command. |
| Docker/VPS + Supabase Cloud | Local/server checkout | Supabase project | Rebuild/restart the local stack after migration, or push to a connected host if that is how the app is published. |
| Docker/VPS + direct PostgreSQL | Local/server checkout | Private PostgreSQL | Run the migration and service upgrade on that host. |
| NOVA-operated multi-tenant service, if introduced later | NOVA release pipeline | Each managed database (one shared database means one migration target) | Central release system; customers do not configure their own Git remotes or database credentials. This is not the current documented distribution model. |

The updater must state clearly which case it detected and require the operator to choose when detection is ambiguous. It must not infer a production deployment from a Git remote name or a `BETTER_AUTH_URL` alone.

## Release and version contract

### Source of truth

1. Publish immutable Git tags in a documented format such as `vMAJOR.MINOR.PATCH` and attach release notes. Align the release identifier with `package.json` or document why it differs.
2. Use the latest **stable published release** by default. Pre-releases require an explicit preview/beta channel choice. Never treat the latest commit on `main` as an operator release.
3. Resolve a release to an immutable commit SHA and keep that SHA fixed throughout preview, migration, source merge, and optional push. If the remote moves or a different release is selected, require a new plan and confirmation. Verify the tag points to the published release commit; decide separately whether signed tags are required and define key rotation before enforcing it.
4. Display the current installed commit/tag, target version/tag/SHA, publication date, release notes, and migration filenames before mutation.
5. If a tag is missing, malformed, points outside the canonical repository, or cannot be resolved consistently, stop without changing the checkout or database.
6. The canonical upstream repository URL must be an explicit project constant or verified configuration. Do not assume a customer's `origin` is NOVA upstream; it may be their fork.

### Release compatibility policy

- Every SQL migration is append-only and named in sequence. The migration ledger determines what is applied; the updater does not guess from schema introspection.
- Release metadata carries SHA-256 checksums for every canonical migration file. CI rejects edits, removal, or renaming of a previously released migration and requires a new sequential file for schema changes.
- A release must declare its supported starting versions/schema range in release notes or a small machine-readable manifest before broad distribution. The first updater release may use the migration ledger plus a supported minimum NOVA version; it must not install over an unknown custom schema.
- The migration ledger should gain checksum storage for migrations applied after updater adoption. For older databases, compare historical SQL against a trusted known release baseline; if that baseline cannot be established, stop for operator review rather than claiming migration integrity.
- Release metadata should identify app version/commit, migration filenames and hashes, minimum supported NOVA/PostgreSQL/runtime versions, required configuration additions, and migration class (`online-compatible`, `long-running`, or `maintenance-required`) with a concise impact note. The CLI must not infer lock duration or table size from filenames.
- Database changes follow an expand/contract approach: release A adds nullable/backward-compatible structures; app A can run against both old and expanded schema; a later release backfills or switches reads; a still later release removes obsolete structures only after old application versions are no longer supported.
- No release may make the current application unusable merely because the source push is delayed or denied after a successful additive migration.
- “Rollback” means reverting application source only when the expanded schema supports it. The updater never applies reverse SQL automatically. Database restoration is a separate, reviewed recovery operation.

## Proposed command and operator experience

Use one discoverable command family rather than a generic dependency updater:

```text
bun run nova:update --check   # reads release metadata and checkout state; no persistent Git-ref writes
bun run nova:update           # guided interactive update
```

Avoid `bun update` naming that could be confused with Bun's dependency updater. A non-interactive `--yes` or CI mode is deferred until target binding, secret injection, release policy, and deployment ordering are proven. The first release must not make a production database mutation without an interactive confirmation or an explicitly configured protected automation policy.

V1 should expose a small stable command surface:

| Command | Side effects | Use |
| --- | --- | --- |
| `bun run nova:update --check` | Reads the official release endpoint and local checkout metadata; no checkout, ref, `.env`, database, deployment, or push mutation. | Answer “is there an update?” and identify unsupported/dirty state. |
| `bun run nova:update --plan` | Creates a durable isolated candidate branch/worktree and a local attempt journal, then performs read-only database connectivity/ledger queries after target confirmation. | Show exact source/database plan without applying migrations or pushing source. |
| `bun run nova:update` | Interactive guided update, with separate database and push confirmations. | Normal operator update. |
| `bun run nova:update --release vX.Y.Z` | Pins a release to an explicit immutable version; still interactive. | Reproduce a known update or install a specific supported release. |

Do not add a production `--yes` switch in V1. If later automation is approved, require a protected environment, immutable release SHA, explicit database target fingerprint, configured backup policy, concurrency guard, and redacted structured logs. Do not let a workflow triggered by a pull request from a fork access those secrets.

The CLI should present a compact state sequence and keep the user in the same terminal:

1. **Check:** identify repo root, checkout version, Git status, remotes, branch, supported installation mode, and whether the command has a TTY.
2. **Find release:** query the canonical release source or fetch stable tags; show `up-to-date`, `update-available`, `offline`, `release-unavailable`, or `unsupported-checkout` honestly.
3. **Plan:** pin the target SHA, produce the Git actions, list migrations missing from the target database ledger, build/deployment action, and required credentials. `--check` stops here.
4. **Prepare source:** build or typecheck the candidate source where possible before any database change. Stage the update on a dedicated update branch or isolated checkout. Keep the operator's current branch available for immediate recovery.
5. **Review target:** show the exact Supabase project reference (and project name if the API can retrieve it) or a redacted PostgreSQL host/database/user. Ask for exact project-reference confirmation for Supabase. Do not print passwords or tokens.
6. **Backup gate:** explain that migrations are forward-only. Confirm a recent, restorable database backup or show the supported operator backup action. Never write database dumps under the repository.
7. **Apply database:** run only the target release's pending canonical migrations using the selected backend adapter; serialize and report each applied filename.
8. **Verify database:** reconcile the migration ledger after each migration. If the operator opts to push, run candidate `nova_app`/schema preflight against the same selected target before pushing. Check `/api/ready` after deployment; report database readiness separately from app readiness.
9. **Activate source:** for local Docker, rebuild/restart the relevant services; for local Bun, restart the API; for hosted Git integration, offer a push only after showing the exact destination. Never push on the user's behalf without this explicit choice.
10. **Verify release:** check the intended app deployment and API health/readiness where reachable. Report source version and database migration version separately.
11. **Finish:** print the completed target, commit, migrations, deployment result, and any remaining operator action. Do not say “updated” if only the database or only the local checkout changed.

### Review screen/text contract

Before a production database write, show a summary like:

```text
NOVA update available: 0.2.1 → 0.3.0
Source: upstream release v0.3.0, commit <short-sha>
Local changes: clean; 2 customer commits will be preserved by a merge
Database: Supabase project <project-ref> (<project-name>)
Pending migrations: 0075_personal_ui_preferences.sql
App deployment: <provider>/<repo>/<branch> (push will trigger a production deploy)
Backup: operator confirmed <backup/time>; NOVA will not create a repository-local dump

Apply the listed database migrations now? Type the exact project ref to continue.
```

After database verification, the push must be a separate decision:

```text
Database migrations succeeded. The hosted app still runs commit <old-sha>.
Push update branch <branch> to <remote> now? This may start a production deploy.
No force push will be attempted.
```

The exact words can change; the information may not be hidden behind a generic “Continue” prompt.

### Terminal accessibility and output contract

- TTY mode uses short numbered prompts with a visible default, ordinary keyboard input, and a clear Cancel option. No arrow-only menu, full-screen terminal UI, color-only status, or mandatory animation.
- Plain/non-TTY output is readable with `NO_COLOR`; progress is line-oriented and useful in logs. Long steps identify what they are waiting for. Do not invent percentage or ETA when the provider does not expose it.
- Errors use stable codes, one-line summary, exact safe next step, and optional verbose diagnostics with credentials scrubbed. Never emit a whole `.env`, connection URI, provider response, or migration SQL as an error dump.
- `--check` and `--plan --json` may be added for observability, but the first production mutation path remains TTY-confirmed. If JSON is implemented, version its schema and keep secrets out.
- Cancellation is available before each mutation boundary. Once a SQL file transaction has begun, tell the operator it is finishing or safely interruptible; do not make Ctrl+C appear to cancel a committed migration.

## Git safety contract

### Non-negotiable safeguards

- Never run `git reset --hard`, `git clean`, force push, unrequested rebase, or destructive branch deletion.
- Never overwrite `.env`, `.env.*`, ignored files, operator deployment config, or customer-owned tracked configuration as part of an update. The app updater and database updater must not share a write operation over these files.
- Do not auto-stash and blindly pop changes. Stash restoration can conflict and is hard to explain safely.
- Preserve local commits. Prefer an explicit merge of the pinned upstream release into a new `nova/update/<version>` branch or a dedicated Git worktree; avoid rewriting customer history.
- Do not push automatically. Before a push, show remote URL with credentials redacted, target branch, commit range, and whether the branch is protected/ahead/behind. Require an explicit yes. Do not store a GitHub PAT in `.env`; use existing Git credential management or the authenticated `gh` CLI if supported.
- If push is rejected, leave the local update branch intact and print the reason/next safe command. Never force push to “fix” divergence.
- A push to a branch connected to the hosting provider can publish the new source. The updater must say this before push and must not promise that a branch push always deploys; branch rules, provider build state, credentials, and host configuration can prevent deployment.

### Git state behavior

| Observed checkout | Safe behavior |
| --- | --- |
| Clean clone on canonical release ancestry | Fetch stable tags; prepare a fast-forward or update branch from the pinned release. |
| Customer fork with canonical `upstream` configured | Fetch `upstream`; merge the tagged release into a new update branch or isolated worktree, preserving customer commits. |
| Fork with no identifiable canonical upstream | Stop and ask the operator to configure/confirm the canonical repository URL; do not fetch from a guessed remote. |
| Clean tree with local commits ahead of base | Preserve commits and use a merge-based update branch; show ahead/behind counts. |
| Local commits and upstream commits diverged | Prepare a review branch only if Git can produce a merge without rewriting history; if conflicts occur, stop and retain both parent branches. |
| Modified tracked files or staged changes | Read-only check reports paths; update apply stops. Ask the operator to commit or back up their work, then retry. Do not mutate the dirty tree. |
| Untracked files | Same stop behavior; do not assume they are disposable. `.env` and ignored files remain untouched. |
| Conflicts | Stop before migration. Keep the conflict branch and working state for manual resolution. Do not continue to database migration with unresolved source. |
| Detached `HEAD`, shallow clone, sparse checkout, submodules, or Git worktree | Explain whether the shape is supported. V1 should support ordinary clone/fork checkouts only and stop safely on unhandled layouts. |
| `origin` is customer's fork | Treat `origin` as the push destination only after confirmation; use the verified canonical remote for fetching releases. |
| No `origin`, no network, GitHub rate-limited, or release API unavailable | Make no changes. Show the last known installed release and manual offline limitations. No database migration runs without a pinned, verified target release. |
| Branch has advanced after plan preview | Re-read HEAD and working-tree state before mutation. If the commit changed, invalidate the plan and regenerate it. |

V1's dirty-tree stop is intentional: it guarantees the updater does not silently absorb uncommitted custom changes. Later support may build a dedicated worktree plus a carefully validated patch handoff, but it must not weaken the stop-and-preserve guarantee.

When building a candidate worktree, do not copy `.env` into it. Pass the original checkout's operator configuration by an explicit path/input to the update process; for Docker Compose, keep the Compose project root, relative paths, env file, and volume identity bound to the intended installation. A candidate worktree must not accidentally create or select a second database volume because its directory name changed.

## Database and backend behavior

### Backend adapter map

| Target | Migration mechanism | Credentials and confirmations | Important boundary |
| --- | --- | --- | --- |
| Supabase Cloud | The updater uses the Supabase Management API migration path and reads the project's `nova_schema_migrations` ledger. Each migration request takes the shared `nova_schema_migrations` advisory transaction lock and checks the ledger inside that transaction; the bootstrap runner now uses the same guard. | Ask for a project-scoped management token at update time if not supplied by a trusted secret manager; hidden input on TTY; typed 20-character project ref. Keep token in process memory only; never write it to `.env`, Git, app-host variables, logs, or a crash report. | Do not use Supabase `service_role` for NOVA app traffic. Do not change `NOVA_APP_PASSWORD` or regenerate `nova_app` unless a separately previewed credential rotation is requested. Both runners that honor NOVA's lock serialize; arbitrary SQL writers that ignore the key are outside this guarantee. Supabase API access and its beta query endpoint still need real project rehearsal before broad support. |
| Direct PostgreSQL | Run `bun run migrate` (or the same migration module) with `MIGRATOR_DATABASE_URL`; use the application's restricted `DATABASE_URL` only for preflight/application checks. | Resolve the target from a protected local `.env` or a hidden password prompt. Show a parsed/redacted host, database, and username. Require explicit confirmation if target identity is ambiguous. | Never connect normal NOVA requests through the migration owner, database superuser, or `nova_app` for schema writes. Verify the connection preserves the session advisory lock; do not assume a transaction pooler does. |
| Local Docker PostgreSQL | Use the Compose migration service from the updated checkout, then rebuild/restart the API and maintenance services using the documented order. | Existing private `.env`; no values echoed. Confirm the Compose project/service and database volume identity before operating. | A successful migration does not rebuild an old API image. A failed API recreate does not imply the database was rolled back. |
| Other managed PostgreSQL provider | Use the direct PostgreSQL adapter if the target offers a compatible secure PostgreSQL connection and the migration owner has the required rights. | Provider TLS/network/firewall settings are operator-owned. If the local machine cannot reach the database, stop and provide a documented in-network execution mode later. | The web hosting provider is not the database adapter. Netlify/Vercel/Cloudflare do not change the migration protocol. |

Supabase bootstrap does more than apply migrations: it provisions/verifies the restricted role and writes runtime connection settings. The updater calls only the migration adapter, then separately runs candidate preflight with the restricted application URL. It does not rerun first-run setup or change credentials or origins.

### Target and schema guards

Before any write:

1. Validate the backend type and required connection/API values. A missing value is a stop, not an invitation to silently choose a default project.
2. For Supabase, validate the project reference, fetch project identity if permitted, show it, and require exact typed confirmation. A confirmation for one project cannot be reused for another.
3. For direct PostgreSQL, parse and redact the connection URL; validate TLS for remote connections and identify the database host/name. Do not log query credentials.
4. Read the NOVA migration ledger. Show the exact pending filenames and target release SHA. Verify every pending migration exists in that release and no database ledger entry indicates a newer/unrecognized schema than the updater supports.
5. If the ledger is absent on a non-empty database, stop. Do not mark migrations as applied based on a guess. Initial installation has a distinct bootstrap path.
6. If the database is newer than the selected app release, refuse downgrade/update. Explain that source selection must be at least as new as the recorded migration set.
7. If the database uses a custom/unknown schema or has failed migration residue, stop and route to a recovery procedure.
8. Confirm a restorable backup before a production migration. The current `pg_dump` example creates an unencrypted archive, and `pg_restore --list` only checks its structure; neither proves encryption or recovery. Encrypt archives with an operator-controlled tool and rehearse a full restore into a disposable PostgreSQL target. For Supabase Cloud, confirm the project's actual backup/PITR restore path and rehearse into a disposable project. NOVA has no backup API or completed restore harness. Never put backup output inside the checkout or upload it automatically.

### Migration execution and recovery

- Run only checked-in SQL from the pinned release. Never fetch or execute SQL from a URL, GitHub issue, release body, or operator-supplied shell string.
- Respect NOVA's migration ledger, advisory lock, and per-file transaction boundaries. Show progress by migration filename, not an invented percent-complete estimate.
- Direct PostgreSQL's connection-scoped advisory lock serializes the current migration runner. The Supabase Management API and bootstrap paths use the shared advisory transaction lock and recheck the ledger before each migration. These guards serialize NOVA writers; arbitrary SQL writers that ignore the lock remain outside the guarantee. A lock held by another updater may cause this attempt to stop so the operator can retry.
- A lock already held by another updater causes a wait with a bounded timeout, then a clean stop. It must never bypass the lock.
- If one file fails, stop on that file. The direct PostgreSQL runner wraps each SQL file and its ledger insert in one transaction, so prior committed files stay recorded and the current file should roll back. Verify the Supabase Management API's per-file atomicity as an implementation gate; after an error, inspect both ledger and schema before retrying.
- If the connection drops after a request may have committed, do not blindly repeat a destructive action. Re-read the ledger and verify actual schema state; the migration runner's ledger is authoritative only when its transaction committed with the migration.
- If the Supabase Management API returns an ambiguous timeout, query the migration ledger again before retrying. Redact access tokens, app passwords, and SQL errors that could contain secrets.
- If post-migration preflight fails, do not push/deploy source. Report which check failed; do not attempt an automatic reverse migration.
- If migration succeeds but push/deployment fails, report **database updated; app deployment pending**. Leave the source update branch available. The release policy must guarantee the previous app remains compatible with the expanded schema.
- If `/api/ready` is unavailable because no updated app is running yet, verify migration ledger and application-role grants separately; do not label the whole application as healthy.
- If an operator requests recovery, point to the tested backup/restore procedure. Database restore is an explicit separate operation because it can discard writes made after the backup.

Migration 0076 adds a nullable SHA-256 field to the existing filename ledger. The updater verifies earlier migrations against the official release manifest and records checksums for migrations it applies. Legacy rows with null hashes remain trusted only when they are part of the known official history. Migration hashes normalize SQL line endings to LF, so checkout settings do not change release identity.

## Host deployment and optional GitHub push

| Deployment style | Expected updater result |
| --- | --- |
| Local Bun runtime | Update checkout; apply DB migrations; tell operator to restart `bun run dev`/service; verify configured local or public health endpoint if available. |
| Docker Compose | Build candidate image before schema mutation; apply migration using the migration service; recreate API and maintenance services; check health/readiness. Keep named DB volume. |
| Netlify/Vercel/Cloudflare Git integration | After database success, offer a push to the repository/branch that is actually connected. Prefer a new update branch/PR for review; a direct production-branch push is an explicit second choice and requires fast-forward safety. State that provider deployment is asynchronous and must be observed separately. If push is declined, the hosted code stays old until the customer deploys manually. |
| Provider deploy hook/CLI | Defer to a later adapter. Provider credentials must be narrowly scoped and separately configured; never assume a Git remote alone authenticates deployment. |
| Manual deployment | Update local source and DB; print the selected release SHA and exact remaining host action from the deployment runbook. Never claim the public site changed. |

`/api/health` is liveness and `/api/ready` is database/runtime readiness. The protected read-only `/api/internal/deployment/identity` endpoint now reports the running release SHA, a password-free database fingerprint, schema and migration-ledger readiness, runtime identity, and scheduler selector. After a customer push, the updater can compare the deployed commit and database fingerprint against the release and database it just updated, then require public readiness. This verifies the selected application/database pairing; it does not read provider build logs, prove every scheduler in an account is unique, or move traffic itself. Until the exact identity and readiness checks pass, say “push accepted; provider deployment not verified.”

The provider's production Git auto-deploy can race a separate migration job if both start from one push. The guided updater avoids that race by applying migrations before the optional production push. If an organization instead uses automatic release automation, it must either gate the host's production deployment behind migration success or use expand/contract migrations that keep both app versions compatible. Preview environments must use a separate database or no production migration credentials.

For an update-branch push, the provider may create only a preview build; production normally requires the operator to merge through the repository's branch policy. If the operator chooses direct production push, explain that the host may deploy immediately after Git accepts the push. The database must already be ready.

### Push protocol

1. Identify which remote/branch is connected to the deployment provider; require operator confirmation if this cannot be known.
2. Show the remote owner/repository, branch, target release commit, customer commits in the update, and whether push will trigger production deployment. Redact embedded URL credentials.
3. Offer **keep local**, **push update branch**, and—only when ancestry and branch policy permit—**push to deployment branch**. Default to keep local.
4. Ask separately after migration and local verification: “Push this update to `<remote>/<branch>` now?” Default answer is **No**.
5. Use normal authenticated Git push only. No force push, no hidden token capture, no automatic branch protection bypass, no implicit PR merge.
6. If the operator chooses not to push, give a concise next step (`git push <remote> <branch>` only when safe and already configured) and state that remote hosting is still on the old version.
7. If the push is rejected or the host build fails, preserve the local update branch and database; report the partial result and provide safe retry steps.

## Secrets, privacy, and trust boundaries

- The updater runs on an operator-controlled machine. It does not call home, upload `.env`, telemetry, personnel records, database dumps, or customer diffs.
- Supabase management token is the highest-risk updater credential. Read it via hidden TTY input or an explicitly configured secret manager; do not accept it in a command-line argument where process listings/history may expose it. Keep it out of `process.env` dumps and error messages; hold it only for the migration session and clear local references after use where practical.
- Never persist the management token in `.env`, `settings.json`, Git credentials, browser storage, repository config, logs, or release metadata. The current bootstrap's token prompt should be replaced with masked input before updater reuse.
- For non-interactive use, require explicit secret injection, a protected environment, a fixed project ref and non-interactive confirmation variable. Reject untrusted pull-request/fork workflows from accessing production secrets. Interactive local update is the V1 path.
- Do not send `MIGRATOR_DATABASE_URL`, migration-owner credentials, `SUPABASE_ACCESS_TOKEN`, or database backup files to Netlify, Vercel, or Cloudflare runtime variables.
- GitHub push authentication is separate from Supabase/PostgreSQL authentication. Reuse the operator's existing credential helper. The updater never writes a new personal access token into `.env` or `origin`.
- Error output should use stable codes and safe messages; log full low-risk diagnostics only after secret redaction. Avoid dumping complete SQL, connection URLs, response bodies, or environment variables.
- Require HTTPS/SSH remotes with host verification; refuse unknown transport schemes or credential-bearing URLs unless explicitly approved and scrubbed from display.
- If signature verification or artifact checksums become part of the release trust model, define key rotation and recovery before making them mandatory. Do not imply a tag is signed unless verified.
- Keep a resumable attempt journal outside the checkout in an OS-appropriate NOVA state directory with private permissions. Record attempt ID, original/candidate commits, release SHA, redacted target fingerprint, planned/applied migrations and checksums, backup reference, push destination, and phase. Never store tokens, passwords, DSNs, raw customer diffs, or database contents. On restart, reconcile Git and ledger state before offering resume; journal state is a hint, not authority.

## Edge-case behavior catalogue

| Area | Failure or edge case | Required response |
| --- | --- | --- |
| Release discovery | No release newer than installed | Report up to date; do not touch Git checkout or database. |
| Release discovery | GitHub/network unavailable, rate limit, DNS/TLS error | Stop before migration. Show installed version and safe manual/offline boundary. |
| Release discovery | Only pre-release is newer | Keep stable channel; show pre-release only when the operator explicitly selects that channel. |
| Release integrity | Tag is absent, mutable, ambiguous, or mismatched with release metadata | Pinning fails; stop and display the mismatch without applying DB changes. |
| Repository | Not inside a Git checkout or Git is unavailable | Stop with install/help message; no fallback to downloading over the active directory. |
| Repository | Current origin is a private fork/customer repo | Do not use it as NOVA source unless separately verified as the canonical upstream. |
| Repository | No canonical upstream configured | Ask operator to set/confirm the upstream URL; do not guess from `origin`. |
| Repository | Dirty staged/unstaged/untracked files | Report files safely, including untracked; stop without checkout changes. Do not print `.env` contents. |
| Repository | Ignored operator files exist | Leave them untouched. Never clean ignored files as part of update. |
| Repository | Customer has committed changes | Preserve commit graph using an update branch/merge; show any changes and conflict risk. |
| Repository | Merge conflict | Stop before DB write; keep original and update branch intact; instruct manual resolution. |
| Repository | Detached HEAD/shallow/sparse/submodule/worktree layout | Detect and support explicitly or stop. Do not issue a generic pull. |
| Plan | Worktree/branch/remote changed after preview | Invalidate plan; re-check and ask again. |
| Target | `.env` missing/malformed or project ref/connection disagree | Stop; never fall back to a default database. |
| Target | Wrong Supabase project selected | Typed-ref validation rejects; no write request sent. |
| Target | Project token expired/under-scoped/project paused | Stop before migration; provide sanitized reason and request a fresh authorized token. |
| Target | Project name lookup unavailable but ref valid | Show ref and hostname; require exact confirmation; do not invent a friendly project name. |
| Target | PostgreSQL not reachable, TLS invalid, or firewall blocks local operator | Stop; do not switch to app runtime role. Offer a future in-network runner path. |
| Schema | No migration ledger on apparently populated database | Stop as an untracked/baseline database; require an explicit reviewed adoption process. |
| Schema | Ledger is a known contiguous prefix of trusted release history | Plan the remaining canonical migrations in order; require the normal backup, target confirmation, and migration approval. |
| Schema | Ledger contains a gap before its latest recorded migration | Stop for schema-drift review; do not infer that missing migrations were applied. |
| Schema | Ledger records a newer or unknown migration | Refuse older release; identify the offending filename. |
| Schema | Ledger says migration applied but expected schema object absent | Stop as schema drift; do not re-run SQL automatically. |
| Schema | Pending file missing from release or filename invalid | Stop before executing a partial guessed migration set. |
| Schema | Several migrations pending | List all in order; apply sequentially and report each committed filename. |
| Concurrency | Another updater holds migration lock | Direct PostgreSQL waits for its bounded lock timeout; the Supabase transaction lock fails the current migration request. Stop and retry later. Never skip the lock. |
| Concurrency | Two updater processes target same local checkout | Use a local updater lock; the second process exits without touching state. Direct PostgreSQL and Supabase also use NOVA's shared DB advisory lock, so separate operator machines serialize when they use the NOVA migration paths. Arbitrary SQL writers that ignore that lock remain outside the guarantee. |
| Migration | SQL file errors | Stop and inspect state. Direct PostgreSQL should have rolled back the current file while leaving earlier files recorded; for Supabase, verify ledger/schema state because API atomicity must be proven. Retain only secret-scrubbed diagnostics. |
| Migration | Connection disappears around commit | Re-read ledger and verify schema before deciding whether to retry. |
| Migration | API/management request times out with unknown result | Query Supabase migration ledger; never submit blindly until state is known. |
| Migration | Role grant/postflight fails | Do not deploy app; report database changed but not verified, and show recovery path. |
| Backup | No backup available/confirmed | Stop before production migration unless a reviewed explicit break-glass policy applies. |
| Deploy | Migration succeeded, local build/restart fails | Report database-ahead/app-old state; keep expanded schema and update branch; do not reverse SQL. |
| Deploy | Push rejected/branch protection requires PR | Keep local branch, don't force; explain PR/manual push path. |
| Deploy | Push succeeds, provider build fails or is still queued | Report code pushed but production deployment unverified; show provider run location and health endpoint. |
| Deploy | Customer declines push | Complete local update only; state explicitly that their hosted app remains on the previous commit. |
| Retry | User repeats command after partial success | Recompute release, Git state and DB ledger; skip completed migrations; show the remaining precise step. |
| Secret handling | Ctrl+C during a prompt/migration | Abort safely at a transaction boundary where possible; always re-read ledger on next run; avoid persisting input. |
| Platform | Windows PowerShell, WSL, macOS, Linux path/shell differences | Use `spawn` with argument arrays, not shell-built commands; test Git/Bun/Docker detection per supported platform. |

## Proposed implementation phases

### Phase 0 — Freeze the release/update contract (partly implemented; release policy still needs maintainer sign-off)

- Confirm canonical GitHub repository URL, release channel policy, release tag format, minimum supported upgrade paths, and changelog location.
- Document supported Git checkout shapes and whether Windows, macOS, Linux, and WSL are V1 targets.
- Split Supabase bootstrap into setup-only, database-migration-only, and postflight responsibilities without changing the current first-run semantics.
- Replace the Supabase token prompt with a hidden prompt and secret-redacted error handling.
- Define a machine-readable update plan that pins repository, version, commit SHA, target identity hash (never raw password), migration filenames, and requested actions.

### Phase 1 — Read-only check and release preview (implemented)

- Implemented `bun run nova:update --check` with stable-channel discovery and Git-state summary, without database, checkout, or persistent-ref mutation. `--plan` writes only an isolated candidate and its local journal, then performs read-only database queries.
- Git-state reporting, secret-safe output, offline handling, and unsupported-checkout behavior have focused tests.

### Phase 2 — Safe source staging (implemented for the documented checkout shapes)

- Implement interactive candidate worktree preparation pinned to a release SHA.
- Require a clean source checkout; preserve committed customer changes through a merge; retain and stop on conflicts.
- Build, typecheck, test, and build the pinned candidate before database writes.
- `--plan` shows the database plan without applying migrations; abandoned candidates are retained for explicit operator review.

### Phase 3 — Database migration adapters (direct PostgreSQL rehearsal passed; Supabase provider rehearsal remains)

- The project-scoped Supabase Management API adapter uses typed project confirmation and transient masked token input.
- Direct PostgreSQL migrations use `MIGRATOR_DATABASE_URL`; candidate restricted-role preflight is a separate required gate before push.
- Target identity, ledger-vs-release validation, backup confirmation, locks, per-file progress, retry reconciliation, and checksum backfill are implemented.
- Unknown ledgers, schema gaps/drift, altered migration history, and downgrades are refused; only a known non-empty contiguous ledger prefix is accepted.

### Phase 4 — Local activation and optional push (push and hosted identity/readiness verification are implemented; local activation remains deferred)

- Local Bun/Docker Compose activation remains a documented operator step; the updater does not switch the active checkout or restart a service.
- The opt-in push step shows the selected remote/branch and possible production impact, requires typed confirmation, runs `nova_app` preflight, and never force-pushes.
- Keep provider CLI/deploy-hook adapters out of V1 unless customer evidence requires them. A normal Git integration should deploy after the updater's migration-first step.
- After explicit confirmation, poll the protected host identity endpoint for the exact full commit SHA, then require public `/api/ready` to report `nova-api` ready before reporting hosted verification. This does not test sign-in or a business workflow and does not inspect provider build logs.

### Phase 5 — Rehearsal, documentation, and release (direct PostgreSQL upgrade path verified; broader release gates remain)

- The isolated PostgreSQL QA now rehearses a trusted 0072 baseline through the actual updater adapter: it plans and applies migrations 0073–0079, confirms the migration ledger is current on a second plan, preserves the legacy billing audit, and passes the post-update restricted-role preflight. The QA connection uses hostname-verified TLS.
- Still rehearse clean install → update, customer fork customization → update, migration failure → retry, hosted deployment failure → retry, and the Supabase Management API migration adapter on disposable targets.
- Preview updater instructions are now in `README.md` and `docs/update-manager.md`; retain the existing manual procedures until the remaining disposable Supabase and hosted-deployment rehearsals pass.
- Release to the maintainers' own disposable deployment first; then staged customer volunteers; only then call the updater generally supported.

## Verification and acceptance matrix

### Source/Git checks

- Clean canonical checkout updates to the selected stable SHA without losing history.
- Fork with `upstream`, local customer commits, merge-base divergence, dirty tracked changes, staged changes, untracked files, ignored `.env`, conflict, missing remote, detached HEAD, shallow clone, and branch-protected push are each exercised.
- Confirm no path calls `reset --hard`, `clean`, force push, or automatic rebase.
- Confirm source changes are staged before database migration and the chosen commit SHA cannot drift mid-update.
- Verify interruption/retry leaves original branch recoverable and does not delete backups or worktrees containing user files.

### Database checks

- Empty supported database bootstrap and previous supported release-to-current upgrade.
- Multiple unapplied migrations and already-applied migrations; repeat updater run is a no-op for completed files.
- Historical migration modified/removed/renamed, release hash mismatch, older database without checksum baseline, and future migration ledger entry; updater rejects each without applying further SQL.
- Wrong project confirmation, expired/under-scoped token, invalid database URL, wrong credentials, TLS/network failure, lock contention, SQL failure, timeout-before/after-commit, role grant failure, migration-ledger drift, unknown newer migration, and missing ledger on populated database.
- Validate RLS and `nova_app` grants using the application role after migration. Never use production customer data for disposable upgrade rehearsal.
- Confirm errors redact access token, passwords, URL query parameters, and SQL response content that can include secrets.

### Deployment and recovery checks

- Migration runs before a production push; provider auto-deploy cannot race ahead of it in the supported workflow.
- Declining push leaves remote code unchanged and clearly reports local/database state.
- Push denial, branch protection, provider build failure, host timeout, and readiness failure are recoverable without a reverse migration.
- Local Docker updates rebuild the correct API and maintenance images, preserve the named database volume, and do not accidentally start multiple background schedulers.
- Hosted app and database readiness are reported independently.
- An old app remains compatible with the expanded schema until deployment completes. A source rollback does not claim to undo a migration.

### Usability and portability

- `--check` is safe, scriptable, and read-only except for release API metadata access; it never asks for database secrets.
- Every mutation names its target and consequence; project-ref confirmation is exact; “No” is a safe default for production database write and Git push.
- Token entry is masked; errors and logs are redacted; `.env` contents never display.
- Windows, macOS, Linux, and WSL behavior is tested for paths, Git invocation, Bun invocation, Ctrl+C, terminal prompts, and Docker detection before claiming support.
- The tool distinguishes `source updated`, `database migrated`, `app deployed`, and `release verified`. No ambiguous single green “Done” status.

## V1 scope and explicit non-goals

V1 should update a normal clean Git clone/fork, preserve committed application and configuration customizations with a merge-based update branch when the merge is conflict-free, stop on dirty/unhandled Git state, apply canonical Supabase or direct PostgreSQL migrations from the local operator environment, and offer an explicit optional push after migration verification. Customer-authored SQL migrations are not part of the supported update contract yet: the updater deliberately requires the release migration directory and manifest to match exactly. Customers must not add or edit canonical migration files; supporting namespaced customer migrations needs its own ordered/checksummed design and upgrade tests.

Defer automatic conflict resolution, browser-triggered updates, GitHub Actions production migration credentials for every customer, server-side call-home/update checks, customer-account provisioning, hosted-provider secret management, binary package self-updates, automatic database restore, reverse migrations, and managed fleet orchestration. These add risk or require a centrally managed service that NOVA does not currently provide.

## Definition of done

The updater is ready for customer use only when:

- Its supported release source and version policy are documented and stable.
- It cannot silently overwrite local files, discard customer commits, change remotes, or force-push.
- It shows and binds to the exact database target and release SHA before any migration.
- Supabase and direct PostgreSQL paths apply only canonical pending migrations, preserve migration-owner/runtime separation, and verify `nova_app` access.
- Failure at each stage leaves a recoverable, accurately reported partial state.
- Provider deployment is coordinated after database success, or supported migration compatibility makes both versions safe during rollout.
- The documented recovery/backup procedure is rehearsed against disposable environments.
- Logs and prompts do not expose credentials, private customer data, or repository `.env` values.
- Customer documentation distinguishes optional push, local update, database migration, and hosted deployment.
