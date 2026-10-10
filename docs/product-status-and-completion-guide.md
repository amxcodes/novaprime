# NOVA today: what works, what is live, and what is left

**Reviewed:** 10 October 2026  
**Live and source snapshot verified:** `main` at `442856cb515bd1db27ed1b7908e1e6c406562abc` (`origin/main`, Netlify production).
**Purpose:** a quick, plain-language guide to the product's current state. The linked technical plans contain the detailed commands and test evidence.

## The short version

NOVA is a substantial, working people-operations product with a shared API, PostgreSQL data model, role and scope checks, attendance and availability workflows, task/work tracking, and a separated UI. The exact readiness source revision `442856cb515bd1db27ed1b7908e1e6c406562abc` is live on Netlify `main`; its GitHub verification workflow passed.

The disposable Netlify + Supabase deployment has a verified hosted baseline. Its database now also has migration `0080` applied transactionally, and the runtime role can use the lease RPCs without directly reading or writing the RLS-protected lease table. The currently deployed code remains on the older source revision until the `0.1.3` changes pass CI and are pushed. Netlify's last 24-hour `nova` function p95 was 4.68 seconds (p99 4.80 seconds), so end-user speed is **not** solved. A fresh Docker/PostgreSQL 17 install and dump/restore rehearsal pass with all 80 migrations, and a local 200-employee × 10-task burst passes at 25 concurrent requests. Stable customer releases, live Cloudflare setup, a real runtime cutover, public VPS/TLS, real-user workflow checks, mobile/tablet browser review, and sustained hosted capacity evidence remain incomplete.

The clearest gaps before calling NOVA a finished, customer-ready product are: prove fresh installs and updates on the actual supported hosted stacks; finish the safe runtime-move executor and recovery; complete real-user role and workflow checks; finish responsive and accessibility review; and measure performance beyond a one-time test burst.

## What “live” means here

| What we can confirm | What that proves |
| --- | --- |
| Netlify production deploy and GitHub `main` both report `442856cb515bd1db27ed1b7908e1e6c406562abc`. | The test deployment is serving the same source revision whose required CI checks passed. This is a disposable test site, not evidence of a customer's independent installation. |
| [GitHub verification for `442856c`](https://github.com/amxcodes/novaprime/actions/runs/38068915485) passed both `checks` and `postgres`. | Packaging, tests, updater, deployment manager, typechecks, Cloudflare build/smoke, and PostgreSQL lifecycle checks passed for that source revision. |
| Five live samples of public [`/api/health`](https://novaprimetest.netlify.app/api/health) and [`/api/ready`](https://novaprimetest.netlify.app/api/ready) returned HTTP 200 on 10 October 2026. | Both production routes currently pass; sample medians were 864 ms and 1,026 ms, with maxima 1,403 ms and 2,019 ms. These include platform/network time and are not browser page-load percentiles. |
| The test Supabase project `owfgvojdaxafayutbcuf` reports `0079_permission_customer_role_assignability.sql` with the canonical SHA-256. Its `nova-background-tick` Cron entry is active at five-minute intervals; the six latest runs succeeded and callbacks returned HTTP 200. | The selected project schema and current deployed code agree at `0079`; the configured Supabase schedule is making successful callbacks. This verifies the named job in this project, not every schedule in all connected providers or projects. |
| Netlify Function Metrics for the last 24 hours showed 346 invocations and 0 errors. `nova`: average 2,651 ms, p50 1,864 ms, p95 4,677 ms, p99 4,804 ms. | Requests are succeeding, but runtime latency is high enough to keep performance as an open release-readiness item. Netlify invocation metrics do not identify which routes or client page waterfalls caused the delay. |

The verified project is explicitly disposable test infrastructure. No customer database was changed. Migration `0080` passed the fresh-install and recovery rehearsal and is applied to this disposable project with its checksum recorded in the ledger. The deployed `442856c` code is still the older `0.1.2` runtime; the new `0.1.3` source is compatible with this additive schema and must be deployed before claiming the lease is active. For real customers, require project identity, a restorable backup, and a verified migration ledger through the migration-owner path.

## Choices available to a new customer

The first-install assistant intentionally offers three complete profiles rather than every possible provider combination:

| Customer choice | Where the app/API runs | Database and scheduled work | What is proven today |
| --- | --- | --- | --- |
| **Netlify + Supabase Cloud** | Netlify Functions | Supabase PostgreSQL; Supabase Cron is the recommended schedule | Live disposable test deployment verified through `0079`, successful auth was previously confirmed by the user, and recent Cron runs/callbacks succeeded. Fresh customer-project setup and upgrade/recovery rehearsal remain. Function latency is high (24-hour p95 4.68s). |
| **Cloudflare + Supabase Cloud** | Cloudflare Worker, using Hyperdrive to reach PostgreSQL | Supabase PostgreSQL; Supabase Cron is the recommended schedule | Worker typechecks, tests, local `workerd` smoke, and a no-upload deploy build pass in CI. Fresh account setup, real Hyperdrive, live Worker rollout, and its schedule are not verified. |
| **Self-hosted Docker + PostgreSQL** | NOVA containers behind Nginx | PostgreSQL in Compose; one local maintenance worker | Fresh PostgreSQL 17/Compose install and archive restore both pass with all 80 migrations; the restore verifies row counts, RLS, sequence state, auth/session records, encrypted secrets, and restricted app-role behavior. A local 200-employee × 10-task burst also passes at 25 concurrency. This does not certify an internet-facing VPS or external TLS. |

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
| **Database setup** | Supabase bootstrap and direct PostgreSQL setup, migration manifest, restricted `nova_app` role checks. | The selected disposable Supabase project is checksum-verified through `0080`; its lease table has RLS enabled, the app role has no direct table privileges, and all three lease RPCs are executable. Fresh local PostgreSQL install/restore also passes through `0080`. Database provisioning and cross-database copying are not deployment-manager actions. |
| **Scheduled work** | One protected background-tick API contract; Supabase Cron install/disable commands; Docker maintenance worker; Cloudflare, Netlify, and Vercel compatibility schedules. Migration `0080` adds a database lease that serializes overlapping maintenance executions. | The selected disposable test project's named Supabase Cron job is active and recent runs/callbacks succeeded. The database lease and restricted grants are live; the currently deployed source has not yet started using the lease until the new runtime deploys. Inventory still cannot prove every external trigger account-wide. |
| **Email** | NOVA supports configured email connections; Node-hosted paths support SMTP, Gmail API, and Resend; the HTTPS Worker path supports Gmail API and Resend. | Local tests and a Cloudflare local-runtime smoke pass. No real customer consent or production message delivery/failure rehearsal is claimed. |

The operational detail and exact gates are in [deployment profiles](deployment-profiles.md), [deployment operations](deployment-operations.md), and the [verification matrix](verification-matrix.md).

## What the updater and deployment manager do

They have separate jobs:

- **`bun run nova:update` updates source and schema.** It checks a pinned stable release, stages changes in an isolated candidate, preserves committed customer changes through a reviewed merge, checks migration hashes and the target database ledger, requires the operator to attest to a recent restorable backup, applies approved migrations, checks the restricted app role, and can offer a separate push to the customer's fork. It does not restart Docker or automatically deploy the customer host. A successful Git push is not proof that the site is healthy.
- **`bun run nova:deployment` diagnoses infrastructure and prepares plans.** `status`, `doctor`, `plan`, `show`, and `verify` inspect selected resources, compare identity/readiness, and record safe plans. The manager does not create customer accounts, write runtime secrets, move a public domain, copy a database, or execute a cutover. `apply` and automatic resume/rollback are not implemented.

The release updater is **not ready for general customer rollout yet**. The repository has no published stable baseline release/tag. The isolated direct PostgreSQL updater rehearsal through `0079` passes. Hosted commit verification now also requires the deployed runtime to report the same database fingerprint as the migration target, the schema and migration ledger to be ready, and public API readiness to succeed. That guard is locally tested; it has not been exercised against a real customer release. Supabase Management API reads, clean-clone adoption, customer-fork conflict handling, hosted deployment after schema change, backup restore, and interrupted-migration recovery remain unproven. The full repository test suite, operator/Cloudflare typechecks, and production web build pass locally; [the GitHub run for `442856c`](https://github.com/amxcodes/novaprime/actions/runs/38068915485) also passed both required jobs.

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

1. **Verify the actual live baseline — hosted database verified through `0080`; new source deployment pending.** The public Netlify site is on the `0.1.2` source baseline until the current `0.1.3` candidate is pushed and deployed. The selected test Supabase project `owfgvojdaxafayutbcuf` now has the exact migration `0080` SHA, RLS enabled on the lease table, no direct `nova_app` table access, and execute-only RPC access. Its named Cron row was previously verified active with six successful recent runs and HTTP 200 callbacks. Recheck runtime identity, readiness, and the first lease-backed tick after deploy. The project view does not prove every trigger in every connected account.
2. **Make releases usable by customers — local evidence passes; publication and end-to-end adoption remain.** The updater verifies pinned immutable release history, migration hashes, target identity, and backup attestation, and keeps the customer-fork push separate. Version/package/manifest are now `0.1.3`; fresh install, full SQL/RLS suite, restricted-role checks, migration upgrade rehearsal, archive restore, and manifest validation pass locally. Still required: publish the `v0.1.2` baseline and `v0.1.3` stable release, then exercise clean-clone adoption, fork conflict handling, wrong-project refusal, failed migration/retry, declined push, and host build failure after schema change against isolated targets.
3. **Prove each advertised first install — self-hosted profile passes; hosted profiles remain partial.** Docker/PostgreSQL 17 has fresh 80-migration setup, authenticated lifecycle, protected maintenance, restore validation, and a 200 × 10 task burst. Netlify + Supabase has a live disposable deployment and the matching test database is now at `0080`, but this is not a clean customer-project installation or end-to-end update/restore rehearsal. Cloudflare + Supabase still needs a disposable account, a live Worker/Hyperdrive sign-in and read/write, one scheduled tick, and restore proof. A public VPS with firewall/TLS remains untested.
4. **Complete one safe runtime move — planner ready; live execution not yet complete.** The Netlify→Cloudflare plan preserves the same database, scheduler, secrets, and origin through candidate validation, with Worker Cron disabled when Supabase owns the schedule. A journaled upload, provider readback, traffic promotion, and tested recovery have not been completed. Keep execution blocked until an isolated Cloudflare account and required credentials are available.
5. **Keep scheduler ownership clear — selected Supabase trigger is identified; lease groundwork passes.** The disposable Supabase project's `nova-background-tick` job is active, and the earlier six runs/callbacks succeeded. The new RLS-protected lease passes direct PostgreSQL fresh-install, takeover, expiry, stale-owner and app-role checks, and the same SQL now exists in the hosted project. The new runtime is not yet deployed, so its first live lease-backed tick remains to be verified. Account-wide duplicates, other providers, and missed-run/failure/recovery behavior remain outside the current selected-project evidence.
6. **Gate database moves as their own project — boundary is in place; transfer remains intentionally separate.** Runtime plans preserve database identity and block an implicit database move. Any future copy/cutover requires a separate plan for write freeze/drain, backup and restore, row/sequence/RLS/auth comparison, and recovery. No cross-database copy was attempted.
7. **Finish user-facing quality checks — automated checks mostly pass; real journeys remain.** Automated permission, responsive CSS, keyboard/ARIA and touch-target checks pass for tested cases. The last UI workbench run passed 570/571 checks; its production-build check failed in this Windows/Bun package layout and could not be validated locally because child-process file access was restricted. No real mobile/tablet browser pass or full authenticated employee/reviewer journey was completed. Screen-reader review is also open. Payroll execution is deferred; keep its schema and permission foundation only.
8. **Measure speed and capacity — realistic local burst passes; production still slow.** The latest local PostgreSQL 17 run used 200 employees × 10 tasks, up to 25 concurrent requests, and measured work-context p50/p95/p99 at 298/418/455 ms; create/self-assign 171/241/299 ms; timer start 95/138/187 ms; timer stop 54/77/99 ms; assignment reads 365/537/588 ms. This is local in-process load, not a hosted SLA or sustained month-long usage. Netlify's last 24-hour `nova` function p95 remains 4.68 seconds (p99 4.80 seconds) with zero invocation errors; regional A/B, matched protected-route browser waterfalls, longer soak, provider connection headroom, and route-level post-change comparisons are still open. Do not call speed fixed or claim capacity from the local test alone.
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
