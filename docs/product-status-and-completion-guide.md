# NOVA today: what works, what is live, and what is left

**Reviewed:** 10 October 2026  
**Repository snapshot before this readiness pass:** `main` at `a3aece3` (`origin/main`).
**Purpose:** a quick, plain-language guide to the product's current state. The linked technical plans contain the detailed commands and test evidence.

## The short version

NOVA is a substantial, working people-operations product with a shared API, PostgreSQL data model, role and scope checks, attendance and availability workflows, task/work tracking, and an increasingly separated UI. The source at this snapshot is on GitHub `main`, and its verification workflow passed.

That does **not** mean the current source has been proven live on your Netlify site, or that every deployment can be moved automatically. A fresh Docker/PostgreSQL install and the 200-employee, ten-task workload now pass locally. The assignment-read bottleneck has been reduced substantially. The current hosted commit, database migration head, active scheduler, a public VPS deployment, and an actual provider cutover still lack evidence. This worktree includes additional changes not yet pushed; the SHA above is the previous pushed snapshot.

The clearest gaps before calling NOVA a finished, customer-ready product are: prove fresh installs and updates on the actual supported hosted stacks; finish the safe runtime-move executor and recovery; complete real-user role and workflow checks; finish responsive and accessibility review; and measure performance beyond a one-time test burst.

## What “live” means here

| What we can confirm | What that proves |
| --- | --- |
| `main` and `origin/main` pointed to `a3aece3` before this readiness pass. | That baseline was on GitHub; this pass still needs to be committed and pushed. |
| GitHub verification run [#100](https://github.com/amxcodes/novaprime/actions/runs/38048289555) passed its `checks` and `postgres` jobs. | Netlify packaging, unit/API, updater, deployment-manager, type, Cloudflare build/smoke, and PostgreSQL lifecycle checks passed for that commit. |
| A Netlify test site has been used in earlier work. | A test deployment existed; that alone does not tell us which commit it serves today. |
| Public `https://novaprimetest.netlify.app/api/health` and `/api/ready` both returned HTTP 200 on 10 October 2026. | The routed API is live and its public readiness check currently passes. This does not identify the commit, selected database, or active scheduler. |

The current Netlify deploy SHA, active scheduler, and hosted Supabase migration head remain **unverified**. The selected disposable Supabase project's `nova_app` database URL connected, but querying the migration ledger returned PostgreSQL `42501` (permission denied); the available Management API token also lacks read permission. User-provided Oct 7 logs show migrations through `0078`, but do not prove migration `0079`, current checksums, or today's scheduler state. No remote migration or provider write was attempted. Do not update a customer database until project identity, a restorable backup, and its migration ledger are confirmed through the migration-owner path.

## Choices available to a new customer

The first-install assistant intentionally offers three complete profiles rather than every possible provider combination:

| Customer choice | Where the app/API runs | Database and scheduled work | What is proven today |
| --- | --- | --- | --- |
| **Netlify + Supabase Cloud** | Netlify Functions | Supabase PostgreSQL; Supabase Cron is the recommended schedule | The public health/readiness routes currently return 200 and production packaging tests pass. Deployed commit, actual account setup/sign-in, migration ledger, and live trigger are not verified. |
| **Cloudflare + Supabase Cloud** | Cloudflare Worker, using Hyperdrive to reach PostgreSQL | Supabase PostgreSQL; Supabase Cron is the recommended schedule | Worker typechecks, tests, local `workerd` smoke, and a no-upload deploy build pass in CI. Fresh account setup, real Hyperdrive, live Worker rollout, and its schedule are not verified. |
| **Self-hosted Docker + PostgreSQL** | NOVA containers behind Nginx | PostgreSQL in Compose; one local maintenance worker | Fresh PostgreSQL 17/Compose install applied all 79 migrations and passed health/readiness, protected maintenance, policy, and a 200-employee × 10-task workload. This does not certify an internet-facing VPS, external TLS, or backup/restore operation. |

The setup commands support these operator situations:

- `bun run setup` — guided local Docker and PostgreSQL setup.
- `bun run setup:supabase` — prepare a Supabase Cloud database from a trusted operator machine.
- `bun run setup -- --mode external` — connect to an already provisioned direct PostgreSQL database.

The browser setup guide is a checklist, not a hosting control panel. Customers create their own provider projects, enter runtime secrets in provider settings, configure HTTPS and public origin, run database setup, and verify readiness. A GitHub push deploys code only; it does not apply migrations, copy secrets, configure DNS, or create a schedule.

Supabase Edge Functions are **not** an offered runtime. Supabase is currently the database and, for the managed profiles, scheduler. Vercel and native Netlify/Cloudflare scheduler adapters remain for existing installations, but are not additional new-customer profiles. Direct PostgreSQL is supported only when its TLS, roles, extensions, backups, and restore behavior meet NOVA's checks; the label “PostgreSQL-compatible” by itself is not a guarantee.

## Which adapters are ready?

“Adapter exists” means NOVA has code for that connection. It does not automatically mean NOVA can create the provider project, move production traffic, or recover a failed change.

| Area | Present in the repository | Readiness boundary |
| --- | --- | --- |
| **Netlify runtime** | Shared API entry point and build selection for API-only versus legacy Netlify Cron. | Packaging checks pass and the public health/readiness endpoints return 200. The deployed commit, secret configuration, authenticated workflow, and live schedule still need verification. |
| **Cloudflare runtime** | Shared API Worker, Hyperdrive binding, protected tick handling, and read-only inventory of selected Worker/domain/routing state. The newest check also inventories preview and overlapping Access protections and blocks unsafe/ambiguous candidates. | Typecheck, local Worker tests/smoke, and deploy dry-run pass. No upload, route promotion, live Hyperdrive rehearsal, or rollback is claimed. |
| **Docker / direct PostgreSQL runtime** | Compose API, PostgreSQL, Nginx entry point, and maintenance worker. The updater's direct PostgreSQL path was rehearsed against PostgreSQL 17 through migration `0079` with verified TLS. | Strongest local end-to-end evidence. A real remote VPS, native Windows PostgreSQL, external Nginx/TLS, and disaster recovery are not certified. |
| **Vercel runtime** | Compatibility entry point and some read-only inventory. | Retained for existing installations; not a new-customer profile. Cron active/disabled state is not fully provable through the current inventory. |
| **Database setup** | Supabase bootstrap and direct PostgreSQL setup, migration manifest, restricted `nova_app` role checks. | Local/direct PostgreSQL reached `0079`. Hosted Supabase evidence is older than the current source head; verify before claiming its database is current. Database provisioning and cross-database copying are not deployment-manager actions. |
| **Scheduled work** | One protected background-tick API contract; Supabase Cron install/disable commands; Docker maintenance worker; Cloudflare, Netlify, and Vercel compatibility schedules. | Supabase Cron and Docker are the recommended schedules for new profiles. Provider-specific legacy adapters exist, but the manager cannot prove every external trigger or guarantee one active trigger across an entire customer account. A live production tick has not been confirmed here. |
| **Email** | NOVA supports configured email connections; Node-hosted paths support SMTP, Gmail API, and Resend; the HTTPS Worker path supports Gmail API and Resend. | Local tests and a Cloudflare local-runtime smoke pass. No real customer consent or production message delivery/failure rehearsal is claimed. |

The operational detail and exact gates are in [deployment profiles](deployment-profiles.md), [deployment operations](deployment-operations.md), and the [verification matrix](verification-matrix.md).

## What the updater and deployment manager do

They have separate jobs:

- **`bun run nova:update` updates source and schema.** It checks a pinned stable release, stages changes in an isolated candidate, preserves committed customer changes through a reviewed merge, checks migration hashes and the target database ledger, requires the operator to attest to a recent restorable backup, applies approved migrations, checks the restricted app role, and can offer a separate push to the customer's fork. It does not restart Docker or automatically deploy the customer host. A successful Git push is not proof that the site is healthy.
- **`bun run nova:deployment` diagnoses infrastructure and prepares plans.** `status`, `doctor`, `plan`, `show`, and `verify` inspect selected resources, compare identity/readiness, and record safe plans. The manager does not create customer accounts, write runtime secrets, move a public domain, copy a database, or execute a cutover. `apply` and automatic resume/rollback are not implemented.

The release updater is **not ready for general customer rollout yet**. The repository has no published stable baseline release/tag. The isolated direct PostgreSQL updater rehearsal through `0079` passes. Hosted commit verification now also requires the deployed runtime to report the same database fingerprint as the migration target, the schema and migration ledger to be ready, and public API readiness to succeed. That guard is locally tested; it has not been exercised against a real customer release. Supabase Management API reads, clean-clone adoption, customer-fork conflict handling, hosted deployment after schema change, backup restore, and interrupted-migration recovery remain unproven. The full repository test suite, operator/Cloudflare typechecks, and production web build pass for this worktree; a fresh GitHub CI run still requires pushing it.

## How role-based screens and permissions work

Think of a role as a set of specific permissions plus the places where each permission applies. For example, seeing a People page does not automatically mean the person can edit roles, approve leave, or see every office.

1. The server determines the signed-in person's effective grants and scopes.
2. The UI uses that information to show only relevant navigation, page sections, buttons, and data requests. A role can land on a useful permitted page even when it has no Admin access.
3. Scope narrows what the grant applies to: for example, the whole organisation, the person's own record, a particular office or department, a client/workstream/group, or work assigned to them.
4. The server checks permission, scope, current business rules, and record state again on every protected read or write. Hiding a button is usability; it is not the security barrier.
5. If a permission read fails, the UI should fail closed and show an access/error state, not pretend the result is an empty list.

This structure supports custom roles: a Super Admin can grant the permissions available in the catalogue, with allowed scopes and targets. The UI and its reads are composed from those grants; they are not supposed to be tied only to fixed role names such as “HR” or “Manager.” Several restricted-role cases have been tested with permission mocks and API/lifecycle tests. Real browser journeys for onboarding-only HR and narrow workstream-only roles are still incomplete.

There is **not yet a universal automatic dependency catalogue for every imagined feature**. Existing features define their own read and action requirements. Payroll is a good example: payroll policy flags and future `payroll.view/manage/lock` permission names exist, but there is no payrun, payslip, calculation, invoice, rate, or payment workflow. Those catalogue entries do not create a Payroll screen. A future Payroll feature must separately define its grants, scopes, server read model, actions, and which attendance/work facts it may consume. A person must not gain attendance access just because a future payroll calculation needs approved attendance facts.

## What the product already covers

The current product is a people-operations foundation with working code for:

- organisation, offices, departments, people, custom roles, permissions, invitations, onboarding, account recovery, and audit;
- attendance check-in/out, work-from-home requests and reviews, leave, shifts/calendars/holidays, office timezone and geofence rules, and certain audited corrections;
- clients, workstreams, groups, reusable task definitions, assignments, work timers, reviews, handovers, due dates, and linked corrective work;
- notifications and email settings, operational reports/exports, personal appearance settings, and per-user workspace choices.

The web UI is **not one giant component**, but it is also not fully migrated out of its older host. `web/app.js` still owns shared routing, identity, API orchestration, and capability planning. Many screens and controls live in feature-owned React modules and CSS Modules under `web/src/features`, with shared pages and design-system components. Continue moving feature presentation into its feature folder while keeping identity, permission decisions, and data reads in their intended host/server boundary. The visual system and screens still need consistency, reduced text density, accessibility, and responsive QA.

## What remains before the full vision is real

Treat these as release gates, in this order:

1. **Verify the actual live baseline — blocked on provider read access.** Confirm the deployed Netlify commit, public health/readiness, target Supabase project, migration ledger/checksums, runtime bindings, canonical URL, and one active scheduler. GitHub CI is not live-deployment evidence.
2. **Make releases usable by customers — incomplete.** Code now refuses to report hosted success if the release is serving a different database from the one it migrated. Publish a stable baseline and a later release only after exact tag/version/manifest checks; rehearse clean install-to-update, customer-fork conflicts, wrong-project refusal, failed migration/retry, a real restore, denied push, and host build failure after schema change on disposable Supabase and PostgreSQL targets.
3. **Prove each advertised first install — partial.** Docker/PostgreSQL has a fresh local 79-migration install, authenticated lifecycle, protected maintenance tick, and a 200 × 10 task burst. Netlify+Supabase and Cloudflare+Supabase still need disposable provider installations, live sign-in/read/write, Hyperdrive proof for Cloudflare, and a real scheduled tick. Docker still needs a public VPS with TLS/firewall proof and a successful backup restore.
4. **Complete one safe runtime move — planner improved; execution unproven.** The Netlify→Cloudflare plan now preserves the same database, scheduler, secrets, and origin through candidate testing and requires the no-Cron Worker profile. An executable journaled upload, exact readback, traffic promotion, and recovery flow do not yet exist end to end. Keep `apply` blocked.
5. **Keep scheduler ownership clear — contract and runbook improved; live inventory blocked.** The selected scheduler is preserved through runtime candidate testing and deployment guidance separates ownership. Configuration and local tests reject ambiguous selected NOVA schedules. A same-identity trigger duplicated outside the inventory view can still overlap; there is no distributed single-flight lock. The manager cannot prove every trigger account-wide or read this project's Cron inventory. Verify one trigger, duplicate and overlapping ticks, missed runs, failures, secret rotation, retries, and run history with provider access; introduce a portable lock only after its semantics are proven on both Supabase transaction pooling and direct PostgreSQL.
6. **Gate database moves as their own project — boundary explicit; transfer not implemented.** Runtime changes must keep database identity fixed. Database copying still requires a separate write-maintenance gate, request drain, verified backup/restore, row/sequence/RLS/auth comparison, cutover, and recovery project. No cross-database copy was attempted.
7. **Finish user-facing quality checks — partial.** The full repository suite passes 571 server/repository tests plus the separate rendered-component checks, including role-gated screens, direct-route denial, keyboard interactions, focus/error states, touch targets, and narrow viewport layouts. Real authenticated restricted-role journeys, cross-screen employee work/submission/review/handover, screen-reader testing, and manual mobile/tablet browser verification remain. Payroll execution is deferred; retain its schema and permission groundwork only.
8. **Measure speed and capacity — representative local burst passes; hosted and sustained evidence remains.** The 200-employee, ten-task local PostgreSQL run passed with concurrency 25. Its API-wave p95s were 357 ms work-context, 225 ms task create/self-assign, 254 ms timer start, 58 ms timer stop, and 445 ms assignment reads; app pool-acquire p95 during assignment reads was 298 ms and query p95 was 186 ms. On the same profile before the query change, assignment-read p95 was 19.9 seconds. These synchronized in-process local runs exclude HTTP and provider overhead; they do not certify a month of usage, sustained peak load, Netlify, or Hyperdrive. Run a sustained workload and collect hosted route/DB/pool/runtime breakdowns before quoting capacity.
9. **Decide what “complete” includes.** Payroll execution is intentionally deferred. If your full business vision includes payroll, compensation, payslips, invoices, or payment execution, those require separate product and data/API design; the current permissions and policy flags do not mean those features exist.

## Cleanup decision

The proven-unused Select proof of concept was removed earlier. I found no evidence-based case to delete more tracked files in this pass. Keep migration history, tests, retained adapters used by existing installs, setup/update scripts, and provider runbooks: they protect customer data or compatibility even when they are not part of the three new-install choices. The rule is to remove only files that imports, builds, runtime entry points, tests, migration history, and existing-customer support all show are unused.

## Where to read next

- [Deployment profiles](deployment-profiles.md) — the three supported customer stacks.
- [Deployment and update roadmap](deployment-roadmap.md) — sequencing and release gates.
- [Deployment manager](deployment-orchestrator-plan.md) — what its inventory/plans do and why `apply` is gated.
- [Update Manager](update-manager.md) — source and database upgrade behavior.
- [Verification matrix](verification-matrix.md) — what was actually tested and what remains unverified.
- [UI feature and capability map](ui-feature-capability-map.md) — feature permissions, data boundaries, and UI gaps.
- [QA and completion plan](qa-and-completion-plan.md) — role workflows, test coverage, and remaining product QA.
