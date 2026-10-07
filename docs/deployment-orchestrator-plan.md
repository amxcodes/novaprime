# NOVA deployment manager

**Status:** product requirement and implementation plan. Implemented foundation:
read-only local status/doctor, optional explicitly targeted remote provider
inventory, immutable per-checkout plans stored outside the repository, plan
readback, protected deployment identity, and a read-only Supabase migration
ledger comparison. Provider mutations, operation resume/rollback execution,
complete scheduler inventory/handover, project provisioning, and database
moves remain unimplemented. A private,
plan-bound journal store now validates sequenced operation events, but no
executor uses it yet. The existing updater and setup commands remain separate
tools.
**Plan prepared:** 7 October 2026.
**Repository delivery rule:** changes for this repository stay on `main` and
push only to `origin/main`; do not create, switch to, or push another branch.

## Purpose

NOVA is a self-hosted deployment base. Its operator needs to inspect and change
the installation as a whole: source and deployed runtime, PostgreSQL, API
secrets and bindings, public domain, and the one active background scheduler.
The local operator tool should discover the current topology, show a proposed
change, and either guide the operator or execute supported provider operations
with the customer's scoped credentials.

The product term for this is **deployment orchestration** (or a local
deployment manager). It is broader than database migration and distinct from
application feature permissions.

## Current support boundary

| Area | Present in this repository | Missing for orchestration |
| --- | --- | --- |
| Runtime adapters | Netlify Functions, Vercel Functions, Cloudflare Worker, and VPS/Docker run the NOVA API through provider-specific entry points. | The adapters do not create or configure customer provider projects. |
| PostgreSQL | Supabase Cloud bootstrap and direct PostgreSQL setup apply migrations and create/check the restricted runtime role. The update manager migrates an existing pinned target. | There is no automated database provisioning or cross-database data-copy/cutover workflow. A new target is not a schema migration. |
| Scheduler | Cloudflare, Netlify, Vercel, Supabase Cron, and VPS use the shared protected tick contract. The Supabase command creates/removes its schedule. Provider build configuration selects the other hosted schedules. `nova:deployment status --remote` reads the selected Netlify site's latest published production deploy schedule list, selected Cloudflare Worker schedules, and project-pinned Supabase Cron rows when the owner URL is available. | Vercel Cron and VPS schedule inventory remain unverified; a single selected Worker/site does not prove account-wide completeness. There is no complete inventory across every account, runtime, and external trigger, nor a scheduler handover executor. A selector does not discover every duplicate schedule targeting the database. |
| Source and release | `nova:update` prepares a pinned source candidate, applies approved migrations, and can offer a Git push. | A successful push is not proof that a host built, deployed, or serves that candidate. |
| Diagnosis | `deployment:preflight` checks the configured database/schema; `deployment:doctor` adds safe repair guidance and optional public health/readiness probes. `nova:deployment status --remote` reads explicitly targeted provider metadata and, when the owner URL is selected, Supabase migration and Cron inventory. | The manager does not yet verify all account resources, secret bindings/presence, custom domains or DNS, or every scheduler. Its inventory is not proof that unselected resources do not exist. |
| First install | The public deployment assistant describes supported combinations and the operator actions. | It is a guide, not a control plane; selecting a path does not change an account. |

The supported topology vocabulary today is narrower than “any platform”: runtime
adapters are Netlify, Cloudflare, Vercel, and VPS/Docker; database setup is
Supabase Cloud or an already-provisioned compatible PostgreSQL server; scheduler
adapters are Cloudflare, Netlify, Vercel, Supabase Cron, and VPS. A provider may
be added to a category only after its management adapter, credential scopes,
recovery behavior, and live rehearsal exist.

### Verified implementation facts

- The domain API is shared. Netlify (`netlify/functions/nova.mts`), Vercel
  (`api/[...path].ts`), and Cloudflare (`cloudflare/worker.ts`) adapt the same
  `server/src/app.ts`. Cloudflare additionally needs a Hyperdrive binding and
  uses the direct PostgreSQL endpoint; Netlify/Vercel use `DATABASE_URL`.
- The database is PostgreSQL 17. Canonical DDL and RLS live in ordered,
  append-only files under `database/migrations`; NOVA application data and
  Better Auth data live in `nova` and `nova_auth`, with the migration ledger in
  `public.nova_schema_migrations`. `nova_app` is the restricted runtime role;
  a separate owner is required for setup, migrations, and data movement.
- Email provider credentials are encrypted in PostgreSQL using
  `NOVA_SECRETS_ENCRYPTION_KEY`. A host move or data copy must preserve that key
  or run a deliberate decrypt/re-encrypt procedure. `BETTER_AUTH_SECRET` also
  must remain stable to preserve existing auth behavior and sessions.
- `/api/ready` reports readiness and the local scheduler selector; it does
  not identify the deployed commit or prove which database project a remote
  runtime is using. The protected read-only
  `/api/internal/deployment/identity` route now reports a password-free
  database fingerprint, runtime/release identity when configured,
  schema-readiness booleans, and configured scheduler. `nova_app` cannot read
  the owner-only migration ledger; the deployment manager uses the explicitly
  selected `MIGRATOR_DATABASE_URL`, pinned to the same database fingerprint,
  for read-only filename/checksum comparison. Do not widen app-role grants to
  make deployment introspection easier.
  Never return URLs, config values, or secrets.
- The scheduler selector is process configuration, not a database-wide
  ownership lock. Each deployment checks its own
  `NOVA_BACKGROUND_SCHEDULER`. A stale Netlify deployment can still accept its
  own Netlify tick while a Cloudflare deployment accepts a Cloudflare tick.
  The manager must disable and verify the old trigger before enabling the new
  one; the selector alone does not serialize schedules across live hosts or
  detect two schedules with the same provider identity.
- There is no NOVA-wide write-maintenance gate yet. A database move cannot be
  called zero-downtime or safely reversible until an explicit mechanism blocks
  mutations across all active API deployments and drains in-flight requests.

These facts constrain the plan: first automate a runtime move with the database
left untouched; keep database copy gated until maintenance/freeze behavior,
backup recovery, and row-level verification have been rehearsed.

## Product and architecture decisions

1. **Use a local operator CLI as the control plane.** It can read the exact
   checkout, invoke PostgreSQL tools, and send scoped credentials directly to
   provider APIs. The public browser deployment assistant remains a guide; it
   must never receive account-management tokens or database-owner credentials.
2. **Model source, runtime, data, scheduler, and DNS as separate resources.**
   A runtime move must not silently move data; a database move must not silently
   change DNS or release code. Plans make every affected resource visible.
3. **Make guided and automated execution two modes of the same plan.** If an
   adapter lacks a required capability or permission, render exact manual steps
   for that action and stop at the boundary. Do not report a partially applied
   plan as complete.
4. **Start with the current reference installation:** Netlify Functions + the
   same Supabase PostgreSQL project, moving the API/static runtime to the
   Cloudflare Worker adapter. Keep the existing public hostname where the DNS
   provider allows it. Do not provision a replacement database as part of this
   first move.
5. **Keep the scheduler stable during the host cutover.** Prefer the existing
   Supabase Cron trigger for the first Netlify-to-Cloudflare move. If the
   installation currently uses Netlify Cron, move it to Supabase Cron first;
   deploy Cloudflare with `cloudflare/wrangler.supabase-cron.toml` so no
   Cloudflare Cron is registered. The same Supabase job then continues calling
   the stable public origin as DNS moves from Netlify to Cloudflare.
6. **Do not push source as an implicit deploy step.** A plan may deploy a
   verified, clean commit directly or explain that the configured Git deploy
   needs a commit. Any repository edit/push is a separate, reviewable action.
   For NOVA development work, commits and pushes remain only on `main` to
   `origin/main`.

## Operator interface

Keep this as a local CLI in the NOVA checkout. It needs the local Git tree,
database clients, and short-lived provider credentials, and must not put
provider-management powers in the hosted application or a browser session.

```text
bun run nova:deployment status
bun run nova:deployment status --env-file .env --remote
bun run nova:deployment doctor
bun run nova:deployment plan --runtime cloudflare --database keep --scheduler supabase --env-file .env --remote
bun run nova:deployment plan --runtime netlify --database provision-supabase --scheduler supabase
bun run nova:deployment show <plan-id>
bun run nova:deployment verify <plan-id> --remote --env-file .env
bun run nova:deployment apply <plan-id>
```

`resume <operation-id>`, `verify <operation-id>`, and `rollback <operation-id>`
are future executor commands; they are not available yet. The current `verify`
command accepts a plan ID and only rechecks the saved snapshot.

`status --remote` currently contacts only the providers for which both an
explicit target ID and credential are present in the selected environment:
Netlify site and latest published production deploy (including its
`function_schedules` metadata), Cloudflare Worker and its Cron expressions,
Vercel project and latest production deployment, and Supabase project/service
health. A missing Netlify schedule field is unknown; only an explicit array
(including an empty array) counts as inspected for that published deploy. With
an explicitly selected `MIGRATOR_DATABASE_URL`
that fingerprints to the same database as `DATABASE_URL`, it also lists only
NOVA-targeting `cron.job` rows and compares `public.nova_schema_migrations`
filenames and SHA-256 checksums against the verified local release manifest,
inside a PostgreSQL read-only transaction. It does not return cron command
text or Vault secrets. The plan labels the migration state as current, behind,
ahead, diverged, unverified, or unavailable; a runtime move that keeps this
database is blocked unless that state is verified current. When both `NOVA_PUBLIC_ORIGIN` (or `BETTER_AUTH_URL`)
and `NOVA_BACKGROUND_JOB_SECRET` are selected, it also calls the protected NOVA
identity endpoint over HTTPS and retains only its allowlisted runtime, release,
database fingerprint/readiness, and scheduler fields. It sends read-only
requests, does not enumerate an entire account, and reports only sanitized
metadata or permission status. The Supabase result is project-scoped; the
Netlify result covers only the selected site's current published production
deploy; the Cloudflare result covers only the selected Worker. Vercel scheduler
inventory is not verified by this adapter, and other Netlify sites, Cloudflare
Workers, Vercel projects, VPS instances, or external triggers may exist. The
planner requires each known scheduler inventory to be project-scoped; a
resource-only read does not close the global scheduler gate. Plans therefore
remain blocked until every live triggering surface is accounted for. Absence
in this inventory is not proof that no trigger or domain exists.
The supported read-only target variables are `NETLIFY_SITE_ID`,
`CLOUDFLARE_ACCOUNT_ID` + `CLOUDFLARE_WORKER_NAME`, `VERCEL_PROJECT_ID` (and
optional `VERCEL_TEAM_ID`), and `NOVA_SUPABASE_PROJECT_REF`. Supabase Cron and
migration-ledger inspection also require `MIGRATOR_DATABASE_URL`, which must
fingerprint to the same database as `DATABASE_URL`; it is used only for
read-only inventory. Matching provider tokens and `NOVA_PUBLIC_ORIGIN` +
`NOVA_BACKGROUND_JOB_SECRET` must come from the same explicitly selected
environment file or operator process.
Run the focused checks with `bun run test:deployment-manager`.

`plan` stores an immutable, expiring plan under the OS per-user state directory,
bound to this checkout and the current local source snapshot. `show` reads that
plan. With `--remote`, the plan includes sanitized provider facts, the inspected
database migration head and checksum state, and a verified live NOVA identity
fingerprint when available. `verify <plan-id>` checks that the checkout,
effective local target hints, and any bound provider inventory still match the
saved plan; pass `--remote` to re-read provider state. It ignores descriptive
timestamps but detects changed targets, releases, database fingerprints,
migration heads, provider deployment revisions, origins, and scheduler rows.
It performs only reads. A local-only plan cannot be upgraded into a remote-bound
plan by verification. The plan is still a local proposal: inventory remains incomplete for Vercel Cron,
account-wide/other-resource schedules, DNS, and secret scopes. `apply`
deliberately refuses because provider write adapters and an operation executor
have not been implemented. A private journal store is present, but it is not
yet connected to a CLI operation. Once full provider inventory and confirmation
evidence are implemented, a plan will bind the source commit, provider
account/resource IDs, database identity, scheduler identity, domain, required
permissions, and planned actions. Apply will revalidate that exact plan before
writing. It asks for one clear review/confirmation before the first
external mutation and asks for exact resource confirmation before a database
copy, production promotion, domain change, or deletion. A non-interactive mode
must require an explicit protected policy and a recorded approval; a bare
`--yes` must not bypass target binding.

`rollback` will execute only compensations listed in that operation's plan and
revalidated against current state. It must refuse after the recorded
irreversible boundary (for example, the first accepted target-database write)
and print the supported recovery runbook. `cleanup` is a later, separate
command with exact resource IDs and a second confirmation; it is never a
normal completion side effect.

The current journal foundation stores the plan and source fingerprints, an
allowlist of planned action IDs, operation state, and ordered sanitized event
metadata. The executor must extend it with verified resource IDs, release SHA,
database fingerprints, safe provider operation IDs, and verification outcomes.
It never stores access tokens, database URLs/passwords, auth keys, or secret values.
Secrets are entered or resolved through a provider CLI/credential store for the
single operation, kept in memory, redacted from output, and written directly to
the destination provider. If a provider cannot return a secret value, the
operator must re-enter it or generate a replacement through a supported NOVA
rotation path; the tool must not pretend it copied the secret.

### Topology, plan, and local state

The topology contains identifiers and non-secret facts only:

| Resource | Required facts |
| --- | --- |
| Source | Repository URL, current branch, exact commit SHA, clean/dirty state, configured deployment method. Never assume `origin` means upstream or production. |
| Runtime | Provider/account/project IDs, environment, deployed commit, public origin, runtime adapter, build/deploy status. |
| Database | Provider/project/database identity, PostgreSQL major version, target fingerprint, connection mode, runtime-role name, migration head, required extension inventory. Never store connection strings or passwords. |
| Scheduler | Provider, exact job/trigger IDs, cron expression/time zone, selected runtime, API origin, last known status/run. Include duplicates and unknown jobs rather than collapsing them. |
| Domain | Hostname, DNS provider/zone, record/route target, TLS status, observed TTL. Registrar ownership is a separate resource and is never transferred automatically. |
| Secrets | Required key names, destination scope/context, present/missing/unknown status, and optional non-reversible local comparison fingerprint. Never retrieve or persist values in the plan. |
| Backup | Provider backup ID or protected local archive path, source database fingerprint, start/completion time, restore-verification result, retention date. |

Each immutable plan binds the source snapshot, target account/resource IDs,
expected runtime/database/scheduler fingerprints, release SHA, requested
changes, required permissions, preconditions, action order, estimated
downtime/risk class, verification, and allowed compensation. Apply must
re-discover and compare those facts before every write. If the account, commit,
database fingerprint, plan age, DNS, or provider state differs, invalidate the
plan and require a new review.

Keep the operation journal outside the repo under the same per-checkout private
OS state directory pattern used by the updater. Write-ahead journal every
external action as `planned → request-started → provider-confirmed → verified`
with a sanitized provider request/operation ID and timestamps. On timeout,
read remote state before retrying; never blindly repeat a create, delete,
password rotation, DNS promotion, or database restore. Keep a separate lock
from the release updater and reject concurrent deployment operations for the
same checkout/topology.

### Code boundaries

Keep the CLI entry thin and move logic into focused modules. The implementation
should use the existing Node/Bun standard APIs (`fetch`, `spawn`, `pg`) before
adding a provider SDK.

```text
scripts/deployment-manager.ts              argument parsing and presentation
scripts/deployment/plan.ts                  pure topology validation/action graph
scripts/deployment/journal.ts               private plan-bound operation journal
scripts/deployment/approval.ts              typed confirmation and plan binding
scripts/deployment/credentials.ts            masked prompt/CLI-session resolution
scripts/deployment/diagnostics.ts            shared read-only checks
scripts/deployment/providers/{provider}.ts  one API/client per provider
scripts/deployment/operations/{move}.ts      runtime, scheduler, database flows
```

The common provider contract is capability-oriented, not a universal CRUD
wrapper. Each provider reports which of `discover`, `validate`, `configure`,
`deploy-preview`, `promote`, `disable`, `verify`, and `restore` it can perform;
an operation may be automated only when every required capability exists.
Provider-specific responses, retry rules, and ownership semantics stay in that
provider module. The shared executor owns plan binding, approvals, journaling,
redaction, and state transitions. Reuse the doctor/preflight and updater's
database fingerprint/migration verification as libraries; do not import CLI
files with top-level side effects.

### Credential acquisition and scope

Load database credentials only from an explicitly selected env file or a
masked terminal prompt; never let Bun implicitly load the repository root
`.env` when a different QA/customer target was selected. Reuse the setup
command's in-repo path and symlink checks. Do not accept passwords, bearer
tokens, or database URLs as command-line arguments. Prefer an already
authenticated provider CLI session when it uses the provider's supported
credential store; otherwise prompt for a short-lived scoped token and keep it
only in the process memory. The manager does not write tokens to `.env`, its
state journal, browser storage, or Git. If the provider CLI persists a login,
say which CLI owns that login and how the operator signs out.

Request permissions only for the actions in the confirmed plan: source/site
read; environment metadata read and secret write; deploy creation/status;
route/domain change only if selected; database project/config/migration only
for database actions; DNS record write only for a confirmed zone. Cloudflare
Hyperdrive write and Worker secret write are separate capabilities. Supabase
tokens should be project-scoped; an account-level or classic token is not an
automatic fallback. A 403 reports the missing operation/scope and stops before
mutation. The manager must never ask for account-owner credentials merely to
hide an unsupported adapter.

For every variable, classify it as public runtime config, provider binding, or
secret. Send secrets directly from masked input/explicit local env to the
destination provider; API readback checks only that a secret is configured,
not its plaintext value. Use an explicit `--env-file` path and print the
resolved target label before any database read/write. This mirrors the
project-bound setup flow and prevents credentials for one Supabase project
being applied to another.

### Operation state and irreversible boundaries

Each plan uses these top-level states:

```text
draft → ready-for-review → approved → executing → candidate-verified
      → cutover-in-progress → verifying → complete
                    ↘ needs-manual-recovery
```

`cancelled` is allowed before the first mutation. `rolling-back` is allowed
only if every prior step has a still-valid compensation. `needs-manual-recovery`
retains the journal and stops further provider writes; it never marks the
operation complete. Each step has its own precondition, request-started marker,
provider result, readback proof, timestamp, and recovery classification.

Irreversible boundaries are explicit in the plan: production domain promotion,
database restore/copy, target accepting its first write, secret rotation,
source resource deletion, and DNS/name-server change. Promotion and credential
rotation require a fresh confirmation showing the exact resource. Cleanup and
source deletion are always a later operation after a retention window, never a
postcondition of `apply`.

### Provider capability matrix

| Provider/resource | Current adapter | Manager work and limits |
| --- | --- | --- |
| GitHub source | Existing updater can inspect a Git checkout and optionally push an explicit customer repository update. | Read the connected repo, production branch, and commit/status. No silent Git remote changes, branch creation, force push, or commit. Connecting a provider's GitHub App/deploy key may still require explicit account consent. |
| Netlify Functions | `netlify/functions/nova.mts`; build plugin selects the API and optional native scheduled function. | Read site/deploy/environment metadata; write scoped Functions/Build variables; trigger/poll deploy. Secret values may be unavailable for readback. The native scheduler is selected by production build context; branch/preview builds intentionally omit it. Environment changes require a new deploy. |
| Cloudflare Worker | `cloudflare/worker.ts`; Hyperdrive binding; `wrangler.toml` or `wrangler.supabase-cron.toml`. | Create/verify Hyperdrive, set Worker secrets/vars, upload a candidate version, verify, then promote; bind custom domain/route and inspect activation. A Version URL may be public and uses the uploaded version's bindings; it is not an isolated database or secret environment. Candidate verification must use protected access and non-mutating checks, or an explicitly isolated Worker and data target. For a Wrangler-managed Worker, change Cron through Wrangler configuration and deploy—not a second API writer. Cron propagation can take up to 15 minutes, so wait and re-read before claiming schedule readiness. |
| Vercel Functions | `api/[...path].ts`; `vercel.ts` renders Cron configuration from the production selector. | Read project/deploy/environment metadata; set variables; deploy and promote; verify aliases. Cron changes are source/config changes and take effect on deployment. The five-minute NOVA Cron is not supported on the Vercel Hobby frequency limit; use Supabase Cron or an eligible plan. |
| Supabase Cloud | `scripts/setup.ts`, `server/src/supabase-bootstrap.ts`, `scripts/supabase-scheduler.ts`. | Supabase is the PostgreSQL database and optional Cron provider in the current NOVA topology; it is **not** the current HTTP API/functions runtime. Scoped Management API can inspect/configure supported project/database resources; migration endpoint availability/scopes vary. SQL bootstrap provisions NOVA schema/roles; it does not copy a populated database. Supabase Edge Functions need a separate Deno/Better Auth/PostgreSQL runtime adapter and parity suite before they can be offered as a runtime target. Supabase Cron is SQL-backed and must be inventoried from the exact project. |
| Direct PostgreSQL/VPS | Setup/migrate/preflight and Docker Compose; no hosting control adapter. | Verify and operate a reachable PostgreSQL server; do not claim provider provisioning. Remote VPS service control needs a separately reviewed SSH/agent capability and is outside the first release. |
| DNS/domain | No common DNS manager. | First automated domain operation only where the selected DNS/host adapter can prove exact zone ownership and record state. Otherwise emit exact records for guided manual application. Never transfer registrar or nameservers automatically. |

The provider documentation and endpoint set can change. Provider adapters pin
API shapes to official docs, test safe reads and mocked failures, and surface
provider request IDs/rate-limit responses. When a provider returns 401/403,
429, or ambiguous 5xx, stop or back off according to that API; do not fall back
to a broader token or a second undocumented API.

## Required migration workflows

### Change runtime/API host, keep the database

For example, move Netlify Functions to Cloudflare Workers while retaining the
same Supabase PostgreSQL project.

1. Discover and fingerprint the current source, deployed host, API origin,
   database project/role, scheduler, and domain. Confirm that the current and
   destination runtime adapters support the pinned source commit and required
   API behavior. Require a clean checkout at the exact commit the plan names;
   show app/runtime versions, origin, provider account IDs, database
   fingerprint, schedule inventory, DNS owner, and any unknown values. Never
   infer a source or production resource from a name alone.
2. Run source and destination preflight without writes. Verify PostgreSQL 17,
   the `nova_app` privilege boundary, migration head/checksums, extension
   availability, database reachability from the target, and the host's
   supported Node/Worker runtime. Compare required configuration keys and
   scopes without trying to retrieve provider secrets.
3. Create/select the Cloudflare Worker, Hyperdrive binding, and required
   variables/secrets. Use a restricted runtime DB account and the direct
   database endpoint required by Hyperdrive. Never place its password in a
   shell argument, Wrangler config, Git file, or output. Use the local
   operator's explicit env file or hidden prompt; if the existing app password
   is unavailable, stop and plan a deliberate credential rotation or a second
   restricted runtime role while retaining the source role for rollback.
4. Preserve the exact `BETTER_AUTH_SECRET` and
   `NOVA_SECRETS_ENCRYPTION_KEY`; preserve or deliberately regenerate the
   bootstrap token and background secret. Configure `BETTER_AUTH_URL`,
   `NOVA_ALLOWED_ORIGINS`, `NOVA_PUBLIC_ORIGIN`, and the scheduler selector
   explicitly. A missing source secret is `unknown`, never an empty value to
   copy. Changing the encryption key requires a tested re-encryption path for
   the encrypted email provider settings.
5. Upload the pinned commit as a candidate Worker version without promoting
   it; do not use the default `wrangler deploy` path for this step because it
   deploys the new version to 100% of traffic. Protect the candidate Version
   URL with Cloudflare Access before issuing it to an operator. A Version URL
   uses that version's bindings and may be public; it is not a separate
   database or secret environment. Keep Cron disabled and the intended
   `supabase` selector. Confirm upload status and commit identity; check only
   `/api/health`, `/api/ready`, static asset delivery, and the protected
   read-only database-identity/readiness endpoint. Run write or auth-flow
   tests against a disposable staging database, not customer records.
6. Keep one scheduler active. If Supabase Cron is already selected, leave its
   one confirmed job in place. If Netlify Cron is selected, first deploy the
   Netlify production functions with `NOVA_BACKGROUND_SCHEDULER=supabase` so
   the build plugin omits `nova-background-tick`; verify that deployment is
   ready and the native function is absent, then configure the one Supabase
   Cron job against the stable public origin and verify a successful
   `cron.job_run_details` plus `net._http_response` result. Do not enable
   Cloudflare Cron for this workflow. If the current trigger is Vercel,
   Cloudflare, VPS, duplicated, or cannot be inspected, stop and produce a
   separate scheduler plan instead of guessing.
7. Promote the stable hostname only after Cloudflare has the matching custom
   domain/route and TLS is ready. If the DNS provider is Cloudflare and the
   exact zone is authorized, apply the reviewed record change. Otherwise show
   the precise DNS records, keep the operation waiting for manual application,
   and poll DNS/TLS/readiness before continuing. Do not transfer the domain,
   registrar, or nameservers. Keep `BETTER_AUTH_URL` stable when the customer
   hostname stays the same; verify its origin/redirect behavior after cutover.
8. After promotion, verify the served commit, database fingerprint, ready
   status, sign-in/session behavior with an explicitly supplied test identity,
   and the Supabase scheduled tick. Do not create or mutate business records
   as a smoke test. Report DNS observations/TTL and both provider deployment
   IDs.
9. Keep the old Netlify deploy available, with its native scheduler removed.
   If its default `netlify.app` origin remains public, report that fact and
   require redirect/access-control handling; do not leave a second writable
   production entry point invisible to the operator. Never delete the source
   site or database as part of cutover.
10. Rollback is a domain/route promotion to the retained Netlify deployment
    only while that release remains schema-compatible. Supabase Cron stays
    active against the stable hostname, so it follows the route back. Before
    the DNS/route rollback, verify the old deployment is ready and has the same
    DB key/configuration. If the target release changed schema incompatibly,
    stop and use a planned roll-forward/recovery instead.
11. Mark complete only after post-cutover checks pass. A provider API's
    successful deploy response alone is not a completed migration.

**Hostname constraint:** a provider-owned default hostname such as
`*.netlify.app` cannot be transferred to Cloudflare. If the installation has
no customer-owned domain, the plan must either remain guided or explicitly
select a new origin such as a Cloudflare-provided hostname. Changing the
origin requires updating `BETTER_AUTH_URL`, `NOVA_ALLOWED_ORIGINS`,
`NOVA_PUBLIC_ORIGIN`, NOVA's organisation public-origin setting, DNS/TLS, and
any identity-provider callback allowlists. Host-only browser cookies will not
move to the new hostname, so require a user sign-in again; never claim sessions
or old email links will continue to work unchanged. Do not buy a domain or
transfer DNS/nameservers on the operator's behalf.

This is the first automated path. A host migration with a different scheduler
or an external DNS provider remains guided until those adapters pass their own
inventory, propagation, failure, and rollback rehearsals.

### Change only the scheduler

Read every schedule that can target this database across Netlify, Cloudflare,
Vercel, Supabase Cron, and VPS. The existing selector is per-runtime; it is not
a central scheduler owner. If any active trigger or identity is unknown, stop
and ask the operator to inventory/disable it before proceeding. For the first
release, prefer an **at-most-one** handover over overlapping triggers:

1. Configure the destination runtime/provider with its trigger disabled and
   validate its credentials, expression, URL, secret, and resource identity.
2. Disable the exact source trigger (Netlify production redeploy without its
   scheduled function; Cloudflare Wrangler deploy with `crons=[]`; Vercel
   production redeploy with an empty Cron list; Supabase unschedule its named
   job; or stop the VPS maintenance service). Do not use both the provider API
   and source config to manage the same Cloudflare Cron.
3. Re-read source state and prove it is disabled/absent. Wait for any in-flight
   invocation to finish and check its provider logs. If a provider cannot
   prove this, leave the destination disabled and report manual action.
4. Change `NOVA_BACKGROUND_SCHEDULER` on every active runtime that shares the
   database, then activate the destination trigger. Wait for provider
   propagation, invoke or wait for one normal tick, and verify endpoint logs,
   tick outcome, database effects, and no surviving source schedule.
5. Record any intentional no-tick interval. Notification outbox work is
   durable, but the team must validate that delayed attendance/session cleanup
   is acceptable before relying on a schedule gap. Vercel Cron is best effort
   and does not retry failed invocations; include its monitoring requirement.

Do not overlap schedules to avoid a gap unless a future database-backed
single-flight/owner fence has been implemented and proven across adapters.
Provider inventory must detect duplicate job IDs/config entries even if they
use the same provider identity. The current app selector alone does neither.

### Provision a new empty database

Provisioning a project, bootstrapping NOVA's schema, and copying customer data
are separate operations. The first automated provisioning target is a new
Supabase PostgreSQL project, only when the operator's scoped Management API
credential can create projects in the explicitly selected organization.

1. Show eligible organizations and require the operator to choose the exact
   organization, project name, region, and plan/capacity. Show price or billing
   implications from provider data when available; if pricing cannot be
   verified, stop before creation and direct the operator to confirm in the
   provider console. Never pick a region, paid tier, or organization by default.
2. Generate or collect the database-owner password using a hidden prompt and
   keep it in memory only until sent over TLS in the provider's create request.
   Do not put it in the command line, plan, journal, shell history, terminal
   output, or Git. Store returned connection details only in the OS credential
   store or an explicitly selected encrypted local secret store. If safe local
   secret storage is unavailable, stop after creation and provide manual next
   steps without printing the secret.
3. Create the project and journal the provider operation ID before polling.
   Poll with bounded backoff; support cancellation and resume after timeout. A
   lost response is ambiguous: query by the confirmed project/operation ID
   before retrying so a retry cannot create a second billable project.
4. Once provider status is ready, connect with the migration owner, verify the
   exact project/database fingerprint, PostgreSQL major version, TLS, required
   extensions, and network access. Create or verify restricted `nova_app`, run
   canonical `database/migrations`, then run `deployment:preflight`. Do not
   import existing customer data during this workflow.
5. Configure the selected runtime and verify its protected deployment identity
   points to this project and expected migration head. Keep scheduling disabled
   until the API is deployed, ready, and verified. Add one scheduler only after
   inventory proves no other trigger targets this database.
6. Report project ID, region, plan, migration head, runtime binding evidence,
   and scheduler state without credentials. Do not delete a partially
   provisioned project automatically; provide a separately reviewed cleanup
   plan with the exact resource ID.

For direct PostgreSQL providers, the operator must provision the database in
that provider first. The manager may then validate connectivity, bootstrap
canonical migrations and roles, and configure a supported runtime. It must not
claim automated provisioning until that provider has a tested create-resource
adapter. Supabase project creation and schema bootstrap create an empty NOVA
database; they do not copy an existing customer's data.

### Move to another PostgreSQL database

A database move is a separate, higher-risk operation even when both endpoints
are Supabase or PostgreSQL. It must not be represented as changing
`DATABASE_URL`.

1. Bind source and target by exact project/database fingerprint, PostgreSQL
   major version, region, migration owner, runtime role, and network route.
   Require independent credentials; reject identical targets and reject
   silently reusing a project-bound Supabase role/password on another project.
   The user selects destination region/plan/cost explicitly; never choose data
   residency or paid capacity implicitly.
2. Define the initial supported transfer matrix and stop outside it. For the
   first data-move release, require PostgreSQL 17 on both ends, supported NOVA
   migrations/extensions, and the documented `nova`/`nova_auth` object set.
   Detect custom tables, triggers, extensions, large objects, external auth,
   storage, or provider-specific dependencies and stop for a custom plan.
3. Verify the target is new/empty or contains only an explicitly approved NOVA
   schema. Provision a separate migration owner and restricted runtime role;
   run canonical migrations on the target rather than copying source DDL or
   ownership. Do not copy managed Supabase internal schemas. Keep the target
   scheduler disabled.
4. Establish a tested source backup and retention reference. A backup is not
   “verified” until restored into a disposable database and checked with NOVA
   preflight. For PostgreSQL archive copies, use a pinned PostgreSQL 17 client,
   private temporary storage/ACLs, encrypted-at-rest handling, and redacted
   process arguments/logs. Estimate archive size and restore duration first;
   stop if disk, network, provider, or request limits cannot support the move.
5. Require an explicit maintenance window. The current product has no global
   write freeze, so database automation is blocked until NOVA implements and
   tests a write-maintenance state shared by every active runtime, plus a
   scheduler pause and in-flight request drain. A provider outage/maintenance
   screen alone is not proof all old requests and schedules have stopped.
6. Freeze accepted mutations and background ticks on the source. Confirm no
   in-flight requests, workers, or scheduled tick; then take the final
   consistent dump. Do not make a “live copy” from a pg_dump snapshot the
   cutover source while writes continue unless a tested replication/catch-up
   path is part of the selected plan.
7. Restore **data only** for the supported NOVA-owned schemas after target
   migrations: `nova` and `nova_auth`; retain the target's canonical
   `public.nova_schema_migrations` ledger. Preserve sequence values and
   transactionally restore. Reconcile ownership/grants from target migrations,
   not from copied source roles. Keep source and target credentials separated.
8. Validate exact table/sequence inventories, row counts and selected
   deterministic checksums, foreign keys/constraints, RLS enabled state,
   schema migration hashes, auth identities/sessions, organisation settings,
   encrypted integration credentials, and `deployment:preflight`. Preserve
   `NOVA_SECRETS_ENCRYPTION_KEY` unchanged; if it cannot be preserved, require
   a tested re-encryption operation before the move can pass.
9. Start a candidate runtime against the target with public traffic and
   scheduler disabled. Verify release identity, role boundary, readiness, and
   bounded non-mutating reads. Do not allow both databases to receive writes.
10. At cutover, switch the runtime's target, verify the target fingerprint,
    restore service, then activate one scheduler. Confirm the scheduler's
    request reaches the new database/API and the expected next tick completes.
11. Keep the source frozen/read-only with its backup and credentials retained
    for the agreed window. Before any production write reaches the target,
    rollback can restore the previous runtime/database route. After the first
    accepted target write, changing `DATABASE_URL` back is **not** rollback;
    it loses or forks data. Recovery then requires tested reverse replication,
    reconciliation, or a reviewed restore/roll-forward procedure. Never
    automatically delete either database or backup.

Initial automated data moves should be limited to rehearsed compatible
PostgreSQL pairs. Supabase project creation and schema bootstrap are not proof
that an existing database has been copied.

## Shared safety rules

- Use a dry-run plan with exact source and destination identities before any
  external write. Plans expire when the Git commit, provider resources,
  database fingerprint, or selected scheduler changes.
- Ask for least-privilege, resource-scoped credentials. Validate access before
  changing anything and name the missing scope without echoing the token.
- Stage runtime and secrets on a preview/secondary origin; never expose secrets
  to browser code, GitHub commits, deployment logs, or the operation journal.
- Maintain an explicit migration compatibility window and scheduler ownership.
  Before enabling an additional provider, establish the rule that exactly one
  trigger is allowed to perform work for a database.
- Make each step idempotent and journal before/after provider writes. On
  timeout, re-read remote state before retrying; provider acceptance can be
  ambiguous. Resume the recorded operation, not a newly inferred target.
- Separate reversible and irreversible actions. Keep old hosts/databases
  during the rollback window; require a distinct confirmation for destructive
  cleanup, and do not automate reverse SQL migrations.
- Verify the destination through provider deployment status and the live NOVA
  checks. Record evidence with timestamps and sanitized provider operation IDs.
- Provider APIs differ in project ownership, secret visibility, deploy
  activation, schedule consistency, and credential scopes. Implement a
  provider-specific adapter for each supported action rather than claiming
  every host or database is interchangeable.

The first provider adapters can use documented control surfaces: [Netlify's
API](https://docs.netlify.com/api-and-cli-guides/api-guides/get-started-with-api/)
supports deploy and environment-variable operations, and [environment changes
require a build and deploy](https://docs.netlify.com/api-and-cli-guides/api-guides/get-started-with-api/#environment-variables);
[Cloudflare's Workers API](https://developers.cloudflare.com/api/resources/workers/subresources/scripts/)
manages Worker scripts, while [Worker secrets](https://developers.cloudflare.com/api/go/resources/workers/subresources/scripts/subresources/secrets/)
and [Hyperdrive configurations](https://developers.cloudflare.com/api/resources/hyperdrive/subresources/configs/methods/create/)
have distinct operations and permissions. Cloudflare says Wrangler-managed
[Cron Triggers must be managed through Wrangler configuration](https://developers.cloudflare.com/workers/configuration/cron-triggers/);
[Vercel's REST API](https://vercel.com/docs/rest-api) manages project resources,
and its [Cron plan limits](https://vercel.com/docs/cron-jobs/usage-and-pricing)
exclude NOVA's five-minute schedule on Hobby. The [Supabase Management API](https://supabase.com/docs/reference/api/introduction)
uses scoped tokens and provides [project creation](https://supabase.com/docs/reference/api/v1-create-a-project)
and a [migration endpoint](https://supabase.com/docs/reference/api/v1-apply-a-migration).
These APIs are not a shared abstraction: token scopes, deployment semantics,
secret-read behavior, resource ownership, and async provisioning must be handled
by each adapter. For PostgreSQL data movement, [pg_dump/pg_restore](https://www.postgresql.org/docs/current/app-pgdump.html)
can produce and restore a consistent database snapshot, but writes made after
that snapshot still require a freeze or a separately rehearsed catch-up method.

## Verification and release gates

Every phase needs these checks before its adapter is called supported:

- **Planner tests:** unchanged topology produces no-op; each field change
  yields only its intended actions; unsupported provider pairs stop before a
  write; same source/target IDs, stale plan fingerprints, dirty Git state,
  missing domain ownership, unknown schedules, and unsupported schema versions
  fail closed.
- **Provider contract tests:** read, create/update, deploy, promotion, disable,
  and readback responses for success, 401/403, 404, 409, 429/`Retry-After`,
  timeout-before-write, timeout-after-write, malformed JSON, and partial
  provider failure. Assert every request is scoped to the confirmed account
  and resource.
- **Secret tests:** capture stdout/stderr, HTTP errors, child-process arguments,
  temporary files, journal contents, and crash artifacts; assert database
  URLs/passwords, provider tokens, auth keys, encryption keys, and tick secrets
  never appear. Assert secret values are sent only to the intended encrypted
  provider setting and do not enter Git or build logs.
- **Recovery tests:** inject process termination immediately before/after
  every external write; restart and verify `resume` reads provider state before
  retrying. Test stale locks, corrupt journals, edited plans, token expiry,
  DNS propagation delay, duplicate schedules, and provider outage during
  rollback.
- **Runtime-move rehearsal:** use a disposable Netlify site, Cloudflare account
  and disposable Supabase PostgreSQL project. Test clean cutover, native
  Netlify-to-Supabase scheduler handover, same Supabase job through both API
  hosts, custom-domain propagation, login/origin behavior, rollback before
  cleanup, and an inaccessible old default hostname. Never use the production
  database for mutation tests.
- **Database-move rehearsal:** test each supported source/target pair from
  backup through restore and comparison on PostgreSQL 17. Include a populated
  `nova`/`nova_auth` fixture, encrypted settings, sequences, RLS, auth
  sessions, a failed restore, disk exhaustion, network interruption, and a
  write attempted during maintenance. Restore the backup into a fresh disposable
  DB and run `deployment:preflight` plus representative reads before passing.
- **Customer acceptance:** a new clone can run status/doctor/plan without
  provider writes; an operator can stop and resume at each documented boundary;
  manual-only capabilities are clearly marked; completion reports provider
  readback and public readiness evidence rather than inferred success.

Apply provider API rate limits with bounded polling, exponential backoff and
`Retry-After`; do not keep polling silently. Progress messages identify the
current provider action and whether NOVA is waiting, retrying, or stopped.
Never estimate downtime from a cron interval or deploy API response; use the
plan's documented phase bounds and observed provider behavior.

## Implementation sequence

0. **Plan and capability contract — complete.** Keep the support matrix
   truthful, specify resource identities, approvals, state transitions,
   failure behavior, and acceptance tests before provider writes are added.
1. **Read-only foundation — partially implemented.** The nova:deployment CLI
   provides local status, the existing doctor with explicit env-file
   isolation, provider-specific read adapters, project-bound Supabase Cron
   and migration-ledger inspection, durable immutable plans, and fail-closed
   previews. The protected identity endpoint does not expand nova_app
   privileges. A private journal store binds events to a persisted plan
   fingerprint and enforces ordered revisions; there is not yet a CLI
   operation executor. Finish this phase in this order:
   - Netlify inventory now reads `function_schedules` only from the latest
     published production deploy; Cloudflare reads only the selected Worker;
     Supabase reads NOVA-targeting jobs from the database-pinned owner URL.
     Complete selected-resource reconciliation and implement a confirmed
     Vercel Cron read path. Keep every uninspected account/resource as an
     explicit blocker. Never infer that an absent API row means no schedule.
   - Inventory custom-domain/route ownership and required runtime binding
     names. Record secret presence and scope/context only; do not retrieve or
     persist secret values. Verify API token permissions before implementing
     writes, with 401/403 stopping the plan.
   - Bind a saved plan to the exact source commit, provider resource IDs,
     database fingerprint and migration head/checksums, scheduler IDs,
     runtime origin/domain, selected deploy context, and expiry. Re-read all
     those facts immediately before a mutation.
   - Connect the journal to an executor only after each action has a provider
     adapter, precondition, read-after-write verifier, timeout reconciliation,
     and tested compensation or explicit manual-recovery boundary.
   - Keep `bun run test:deployment-manager` as a required CI check beside the
     full server suite; the deployment-manager tests are a separate root
     script and are not included by the server test command.

   **Exit gate:** read-only status and plan tests prove secrets never enter
   output/state; every supported resource is either identified or reported as
   an explicit blocker; stale plans cannot execute; all schedule surfaces in
   the selected transition are accounted for. Keep `apply` unavailable until
   this gate and the first transition rehearsal pass.
2. **First execution path: Netlify + Supabase → Cloudflare + same Supabase.**
   Implement narrowly scoped Netlify and Cloudflare adapters, the journaled
   executor, protected candidate upload, Hyperdrive configuration, and
   context-aware secret entry. Verify candidate commit, runtime identity,
   database fingerprint, read-only readiness, assets, and TLS before
   promotion. Keep Supabase Cron stable; if Netlify Cron is active, its
   disable/readback and successful Supabase tick are separate gated actions.
   Promote only a customer-owned hostname after its exact DNS zone/route and
   TLS state are verified. Keep the Netlify deploy for rollback and report its
   remaining default hostname. Rehearse each action and crash boundary against
   disposable resources before exposing `apply` for this transition only.

   **Exit gate:** the fault-injection, least-privilege, secret-capture,
   duplicate-scheduler, delayed-DNS/TLS, stable-origin auth, and rollback tests
   pass on a disposable site/Worker/database. The journal resumes only after
   provider readback; an ambiguous write stops for reconciliation instead of
   blindly retrying. All other transition pairs remain guided.
3. **Other runtime adapters.** Add Vercel and VPS/Docker operations one at a
   time. Vercel requires plan-aware Cron validation; VPS automation requires a
   separate verified host identity, restricted agent/SSH model, and service
   health checks. Preserve guided manual steps where provider APIs cannot
   safely manage a resource.
4. **Scheduler manager.** Enumerate all schedules that can call one database,
   detect duplicates, update the runtime selectors and provider-owned configs,
   use the disable→verify→drain→enable→verify sequence, and add monitoring for
   each provider's retry/propagation semantics. Only add a database-wide
   single-flight fence if inventory and sequential handover cannot meet the
   tested at-most-one requirement.
5. **Database move prerequisite and executor.** Implement a global maintenance
   gate, block mutation routes and scheduled ticks, drain in-flight work, and
   provide a tested exit/recovery mechanism. Then ship backup/restore rehearsal
   and data-only copy for one explicit PostgreSQL 17 pair at a time. Keep target
   provisioning, schema migration, data copy, runtime switch, and source
   retention as separately journaled stages.
6. **New database providers.** Add Supabase project provisioning where the
   account scopes/plan allow it, then adapters for specific direct-PostgreSQL
   vendors only when their setup, networking, backup, role, extension,
   migration, and restore behavior is rehearsed. “PostgreSQL compatible” alone
   is not a provider support claim.
7. **Release/customer readiness.** Run the full fault-injection matrix, fresh
   clone and upgrade flows, Windows/Linux credential and file-permission
   checks, disposable live-provider rehearsals, docs review, and stable release
   publication. Mark only tested transition pairs automated; all others stay
   guided.

Do not fold this into `nova:update`: that command owns release source and
schema upgrade. The deployment manager owns moving a running installation
between infrastructure providers. They can call shared preflight and migration
libraries, but have different plans, approvals, journals, and rollback models.

### Official provider references used by this plan

- [Netlify API — list sites and retrieve a site](https://open-api.netlify.com/)
- [Cloudflare API — list Worker scripts and schedules](https://developers.cloudflare.com/api/resources/workers/subresources/scripts/)
- [Cloudflare Workers versions and deployments](https://developers.cloudflare.com/workers/versions-and-deployments/)
- [Cloudflare Worker Version URLs and access controls](https://developers.cloudflare.com/workers/versions-and-deployments/version-urls/)
- [Cloudflare Worker secrets](https://developers.cloudflare.com/workers/configuration/secrets/)
- [Cloudflare Cron Triggers](https://developers.cloudflare.com/workers/configuration/cron-triggers/)
- [Netlify environment variable contexts and deploy effects](https://docs.netlify.com/api-and-cli-guides/cli-guides/get-started-with-cli/)
- [Netlify programmatic deploys](https://docs.netlify.com/deploy/create-deploys/)
- [Vercel REST API reference](https://vercel.com/docs/rest-api)
- [Vercel cron configuration and production behavior](https://vercel.com/docs/project-configuration/vercel-json)
- [Supabase Management API — list projects and health](https://supabase.com/docs/reference/api/introduction)
