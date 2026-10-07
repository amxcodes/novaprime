# NOVA deployment manager

**Status:** product requirement and implementation plan. The provider-management
workflow described here is not implemented yet. The current updater, setup
commands, deployment guide, and doctor remain separate tools.

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
| Scheduler | Cloudflare, Netlify, Vercel, Supabase Cron, and VPS use the shared protected tick contract. The Supabase command creates/removes its schedule. Provider build configuration selects the other hosted schedules. | There is no one command that inventories, switches, and verifies every provider's schedule. A scheduler selector does not discover duplicate schedules with the same identity. |
| Source and release | `nova:update` prepares a pinned source candidate, applies approved migrations, and can offer a Git push. | A successful push is not proof that a host built, deployed, or serves that candidate. |
| Diagnosis | `deployment:preflight` checks the configured local database/schema; `deployment:doctor` adds safe repair guidance and optional public health/readiness probes. | These checks do not read provider project state, secrets, deployments, custom domains, or scheduler inventory. |
| First install | The public deployment assistant describes supported combinations and the operator actions. | It is a guide, not a control plane; selecting a path does not change an account. |

The supported topology vocabulary today is narrower than “any platform”: runtime
adapters are Netlify, Cloudflare, Vercel, and VPS/Docker; database setup is
Supabase Cloud or an already-provisioned compatible PostgreSQL server; scheduler
adapters are Cloudflare, Netlify, Vercel, Supabase Cron, and VPS. A provider may
be added to a category only after its management adapter, credential scopes,
recovery behavior, and live rehearsal exist.

## Operator interface

Keep this as a local CLI in the NOVA checkout. It needs the local Git tree,
database clients, and short-lived provider credentials, and must not put
provider-management powers in the hosted application or a browser session.

```text
bun run nova:deployment status
bun run nova:deployment doctor
bun run nova:deployment plan --runtime cloudflare --database keep --scheduler cloudflare
bun run nova:deployment apply <plan-id>
bun run nova:deployment resume <operation-id>
```

`status`, `doctor`, and `plan` are read-only. `plan` binds the source commit,
provider account/resource IDs, database identity, scheduler identity, domain,
required permissions, and planned actions. `apply` revalidates that exact plan
before writing. It asks for one clear review/confirmation before the first
external mutation and asks for exact resource confirmation before a database
copy, production promotion, domain change, or deletion. A non-interactive mode
must require an explicit protected policy and a recorded approval; a bare
`--yes` must not bypass target binding.

The operation journal stores phase, resource IDs, release SHA, database
fingerprints, safe provider operation IDs, and verification outcomes. It never
stores access tokens, database URLs/passwords, auth keys, or secret values.
Secrets are entered or resolved through a provider CLI/credential store for the
single operation, kept in memory, redacted from output, and written directly to
the destination provider. If a provider cannot return a secret value, the
operator must re-enter it or generate a replacement through a supported NOVA
rotation path; the tool must not pretend it copied the secret.

## Required migration workflows

### Change runtime/API host, keep the database

For example, move Netlify Functions to Cloudflare Workers while retaining the
same Supabase PostgreSQL project.

1. Discover and fingerprint the current source, deployed host, API origin,
   database project/role, scheduler, and domain. Confirm that the current and
   destination runtime adapters support the same release and required runtime
   features.
2. Create or select the destination host project and bindings. Transfer only
   runtime configuration; keep migration-owner credentials and management
   tokens on the operator computer. For Cloudflare, configure Hyperdrive with
   the restricted application role and direct PostgreSQL endpoint.
3. Build the pinned source commit and deploy a preview/new origin without
   moving production traffic. Verify build identity, `/api/health`,
   `/api/ready`, database role, auth session/cookie behavior, and a bounded set
   of read-only API smoke checks.
4. Configure the scheduler selector consistently. Ensure the new trigger is
   present and the old trigger cannot execute work after the selector changes;
   verify provider inventory and a successful tick before treating the switch
   as complete.
5. Promote the new runtime/domain. Keep the previous host available through
   the rollback window. Since both hosts share the same database, rollback is
   only allowed to a prior app release compatible with the current schema.
6. Report the deployed commit, live origin, selected database fingerprint,
   active scheduler, and each check. Do not claim completion from a Git push or
   provider API acceptance alone.

### Change only the scheduler

Read current schedules from the configured provider, then switch the
`NOVA_BACKGROUND_SCHEDULER` selector and actual trigger as one journaled
operation. The planner must detect schedules it can enumerate and stop when it
cannot prove which trigger is active. Because different triggers may call the
same endpoint, the operation must prevent duplicate accepted ticks; the current
selector rejects stale *different-provider* identities but does not fence two
duplicate jobs using the same provider identity. Verify the new schedule and
tick, then remove the old one and verify its absence. Preserve any gap/overlap
and retry behavior in the operation report.

### Move to another PostgreSQL database

A database move is a separate, higher-risk operation even when both endpoints
are Supabase or PostgreSQL. It must not be represented as changing
`DATABASE_URL`.

1. Bind both ends by provider, project/database identity, host fingerprint, and
   runtime/migration roles. Require independent source and target credentials;
   reject same-target mistakes and never reuse a project-bound Supabase app
   password on another project.
2. Check engine version, extensions, encoding/collation, required privileges,
   storage/connection limits, network reachability, migration ledger and
   provider-specific features. Stop when a required object cannot be copied
   or safely recreated.
3. Require a verified, restorable source backup and an explicit migration
   window. Choose a documented copy method for the supported source/target
   pair. If continuous replication is not available and verified, explain the
   write-freeze/downtime required; never silently copy a live changing HRMS
   database and call it consistent.
4. Provision the target's restricted application role, apply the pinned schema,
   copy supported data, preserve ownership/permissions intentionally, and
   validate migration hashes, required extensions, table counts/checksums,
   constraints, RLS, auth/session data, and NOVA preflight.
5. Deploy a candidate runtime against the target without production traffic.
   Verify application reads, auth, and background work with its scheduler
   disabled.
6. Freeze writes or use a rehearsed replication/catch-up mechanism, switch
   runtime secrets to the target, verify the live app, then activate exactly
   one scheduler on the target. Keep the old database read-only and retained
   for the agreed rollback period.
7. State the rollback boundary explicitly. Once writes are accepted only on
   the target, returning to the source requires reverse replication or a
   restore/reconciliation procedure; swapping the old URL back would lose
   writes. Never delete the source automatically.

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

The official control surfaces needed for the first adapters exist: [Netlify's
API](https://docs.netlify.com/api-and-cli-guides/api-guides/get-started-with-api/)
can manage deploys and contextual environment variables, and variable changes
need a new build/deploy; [Cloudflare's Workers API](https://developers.cloudflare.com/api/resources/workers/subresources/scripts/)
can upload Worker modules and manage deployments, with separate [Worker secret
management](https://developers.cloudflare.com/api/go/resources/workers/subresources/scripts/subresources/secrets/)
and [Cron schedule APIs](https://developers.cloudflare.com/api/resources/workers/);
[Vercel's REST API](https://vercel.com/docs/rest-api) manages project
environment variables, deployments, and domain promotion; and the [Supabase
Management API](https://supabase.com/docs/reference/api/introduction) supports
project/database management with scoped tokens and a [migration
endpoint](https://supabase.com/docs/reference/api/v1-apply-a-migration). These
APIs are not a shared abstraction: their token scopes, deployment semantics,
secret-read behavior, and resource ownership must be handled by each adapter.
For PostgreSQL data movement, [pg_dump/pg_restore](https://www.postgresql.org/docs/current/app-pgdump.html)
can produce and restore a consistent database snapshot, but writes made after
that snapshot still require a freeze or a separately rehearsed catch-up method.

## Implementation sequence

1. Finish the read-only deployment doctor and safe recovery guidance.
2. Define a secret-free topology record, provider capability registry, and
   pure plan validation for runtime-only, scheduler-only, and database moves.
3. Implement and rehearse Netlify and Cloudflare control adapters for an
   API-host move that keeps the database fixed. Include variables/secrets,
   preview deployment, health/readiness verification, scheduler handover, and
   rollback. Add Vercel only after the same contract passes its own rehearsal.
4. Add scheduler inventory and atomic/verified handover per provider; extend
   the shared tick path with an operation-safe fence if current same-provider
   duplicate schedules cannot be ruled out.
5. Implement database copy only for explicitly supported PostgreSQL pairs,
   with backup verification, maintenance/catch-up, data validation, and a
   rehearsed rollback boundary. Add new database vendors only with provision,
   copy, credential, and recovery adapters—not merely a compatible URL.
6. Add resumable orchestration journals, fault injection, disposable-provider
   rehearsals, and customer documentation before marking any transition
   automated/customer-ready.

Do not fold this into `nova:update`: that command owns release source and
schema upgrade. The deployment manager owns moving a running installation
between infrastructure providers. They can call shared preflight and migration
libraries, but have different plans, approvals, journals, and rollback models.
