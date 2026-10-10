# NOVA today: what works, what is live, and what is left

**Reviewed:** 11 October 2026<br>
**Latest published application source:** `main` at `fd1e5207b88415a2015a3482798f03bb353e6c84` (Netlify production deploy `6aca86da31a9180009230764`). GitHub verification run [#109](https://github.com/amxcodes/novaprime/actions/runs/38076798924) passed both required jobs.
**Purpose:** a quick, plain-language guide to the product's current state. The linked technical plans contain the detailed commands and test evidence.

## The short version

NOVA is a substantial, working people-operations product with a shared API, PostgreSQL data model, role and scope checks, attendance and availability workflows, task/work tracking, and a feature-based UI. Application code from `fd1e520` is published on Netlify; later `main` commits only changed documentation. The corresponding application checks passed. The signed-in Super Admin Work, People/access, and Organisation pages render on the live test site. Work now gives clear office-setup guidance when attendance is unavailable because the test organisation has no offices.

The disposable Netlify + Supabase deployment has migration `0080`. Its last recorded named Cron tick succeeded at 18:10 UTC after `1f14e3e`, before later application deployments; five lease-acquisition calls were recorded, but a fresh tick is still needed. This database is explicitly disposable test infrastructure. The live application code is `fd1e520`, but the customer release catalogue still has no published stable release, so a fresh customer clone cannot yet discover the updater path. At 00:20 IST on 11 October, Netlify's rolling 24-hour metrics showed 591 `nova` invocations and zero function errors, but p95 was 6.20 seconds (p99 6.92 seconds); end-user speed is **not** solved. WSL/Docker/PostgreSQL 17 fresh install, restore and local authenticated lifecycle evidence pass. A live Cloudflare profile, real runtime cutover, internet-facing Docker host/TLS, full real-user role journeys, mobile/tablet browser review and sustained hosted capacity evidence remain incomplete.

The clearest gaps before calling NOVA a finished, customer-ready product are: publish and exercise the customer release path; prove fresh installs and updates on the hosted stacks; finish one safe runtime-move executor and recovery; complete real-user role and workflow checks; finish responsive and accessibility QA; prove the internet-facing Docker path; and measure performance beyond a one-time test burst.

## What “live” means here

| What we can confirm | What that proves |
| --- | --- |
| The live application bundle corresponds to source `fd1e520`; later `main` publications only update documentation. GitHub run [#109](https://github.com/amxcodes/novaprime/actions/runs/38076798924) passed `checks` and `postgres`. | The test site serves the latest application code and required CI is green. This is not evidence of a customer's independent installation. |
| Earlier samples of public [`/api/health`](https://novaprimetest.netlify.app/api/health) and [`/api/ready`](https://novaprimetest.netlify.app/api/ready) returned HTTP 200 on 10 October 2026, before the `fd1e520` deploy. | Historical medians were 864 ms and 1,026 ms, with maxima 1,403 ms and 2,019 ms. These include platform/network time and are not browser page-load percentiles. Recheck both routes against the current deploy before using them as its readiness proof. |
| The disposable Supabase project `owfgvojdaxafayutbcuf` is on migration `0080`. The latest recorded read found one active named Cron job, a successful 18:10 UTC tick after `1f14e3e` but before later application deployments, and five calls to the lease acquire RPC. | The selected database has the lease migration and the recorded job previously completed through the lease-protected path. Recheck after the current application deploy; this does not prove that no unselected external scheduler exists. |
| At 00:20 IST on 11 October, Netlify's rolling 24-hour Function Metrics showed 599 total invocations and 0 function errors. `nova` accounted for 591 calls: average 3,035 ms, p50 2,670 ms, p95 6,203 ms, p99 6,916 ms. | Requests completed without Netlify function errors, but latency is high. The window spans deployments and does not identify slow routes or client page waterfalls. |

The inspected project is explicitly disposable test infrastructure. No customer database was changed. Migration `0080` is checksum-recorded there, and the latest recorded successful scheduled tick was after `1f14e3e` but before the current deploy. The live Super Admin session rendered Work, People/access, and Organisation settings without changing records. Work now clearly says an office and assignment are required before attendance is available; Organisation shows zero offices and departments. The observed release source is `0.1.3`. For real customers, require project identity, a restorable backup, and a verified migration ledger through the migration-owner path.

## Choices available to a new customer

The first-install assistant intentionally offers three complete profiles rather than every possible provider combination:

| Customer choice | Where the app/API runs | Database and scheduled work | What is proven today |
| --- | --- | --- | --- |
| **Netlify + Supabase Cloud** | Netlify Functions | Supabase PostgreSQL; Supabase Cron is the recommended schedule | Latest application source is published and passed CI; the disposable DB is at `0080`. A prior observed Cron job completed a lease-backed tick, but there is no post-current-deploy tick or clean-customer setup/update proof. Signed-in Super Admin Work, People/access, and Organisation routes render. The latest rolling metrics p95 is 6.20s and spans deployments. |
| **Cloudflare + Supabase Cloud** | Cloudflare Worker, using Hyperdrive to reach PostgreSQL | Supabase PostgreSQL; Supabase Cron is the recommended schedule | Worker typechecks, tests, local `workerd` smoke, and a no-upload deploy build pass in CI. Fresh account setup, real Hyperdrive, live Worker rollout, and its schedule are not verified. |
| **Self-hosted Docker + PostgreSQL** | NOVA containers behind Nginx | PostgreSQL in Compose; one local maintenance worker | An isolated PostgreSQL 17/Compose first install passed through loopback Nginx, including founder registration, verification handoff, workspace bootstrap, authenticated office creation/readback, health/readiness, and a worker tick. A regression fix preserves non-default ports in `X-Forwarded-Host`; focused tests and a fresh container build passed. No internet-facing host or external TLS is certified. |

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
| **Netlify runtime** | Shared API entry point and build selection for API-only versus legacy Netlify Cron. | Live application code corresponds to `fd1e520`; subsequent `main` publications were documentation-only. CI #109 passed. Signed-in Super Admin Work, People/access, and Organisation screens render. The attendance setup state is explicit. The selected disposable Supabase Cron tick was recorded after `1f14e3e`, before the current app deploy; direct readiness, current-build runtime/database identity, and a fresh tick remain unverified. |
| **Cloudflare runtime** | Shared API Worker, Hyperdrive binding, protected tick handling, and read-only inventory of selected Worker/domain/routing state. The newest check also inventories preview and overlapping Access protections and blocks unsafe/ambiguous candidates. | Typecheck, local Worker tests/smoke, and deploy dry-run pass. No upload, route promotion, live Hyperdrive rehearsal, or rollback is claimed. |
| **Docker / direct PostgreSQL runtime** | Compose API, PostgreSQL, Nginx entry point, and maintenance worker. Fresh Compose install, restore, protected tick, and authenticated lifecycle were rehearsed against PostgreSQL 17; the updater's separate direct-PostgreSQL migration path was rehearsed through `0079` with verified TLS. | Strongest local end-to-end evidence. A real remote VPS, native Windows PostgreSQL, external Nginx/TLS, and disaster recovery are not certified. |
| **Vercel runtime** | Compatibility entry point and some read-only inventory. | Retained for existing installations; not a new-customer profile. Cron active/disabled state is not fully provable through the current inventory. |
| **Database setup** | Supabase bootstrap and direct PostgreSQL setup, migration manifest, restricted `nova_app` role checks. | The selected disposable Supabase project is checksum-verified through `0080`; its lease table has RLS enabled, the app role has no direct table privileges, and all three lease RPCs are executable. Fresh local PostgreSQL install/restore also passes through `0080`. Database provisioning and cross-database copying are not deployment-manager actions. |
| **Scheduled work** | One protected background-tick API contract; Supabase Cron install/disable commands; Docker maintenance worker; Cloudflare, Netlify, and Vercel compatibility schedules. Migration `0080` adds a database lease that serializes overlapping maintenance executions. | The selected disposable test project's one observed named Supabase Cron job is active. Its last verified successful tick was at 18:10 UTC after `1f14e3e` and before the current deploy; five lease-acquire calls were recorded. Inventory cannot prove every external trigger account-wide. |
| **Email** | NOVA supports configured email connections; Node-hosted paths support SMTP, Gmail API, and Resend; the HTTPS Worker path supports Gmail API and Resend. | Local tests and a Cloudflare local-runtime smoke pass. No real customer consent or production message delivery/failure rehearsal is claimed. |

The operational detail and exact gates are in [deployment profiles](deployment-profiles.md), [deployment operations](deployment-operations.md), and the [verification matrix](verification-matrix.md).

## What the updater and deployment manager do

They have separate jobs:

- **`bun run nova:update` updates source and schema.** It checks a pinned stable release, stages changes in an isolated candidate, preserves committed customer changes through a reviewed merge, checks migration hashes and the target database ledger, requires the operator to attest to a recent restorable backup, applies approved migrations, checks the restricted app role, and can offer a separate push to the customer's fork. It does not restart Docker or automatically deploy the customer host. A successful Git push is not proof that the site is healthy.
- **`bun run nova:deployment` diagnoses infrastructure and prepares plans.** `status`, `doctor`, `plan`, `show`, and `verify` inspect selected resources, compare identity/readiness, and record safe plans. The manager does not create customer accounts, write runtime secrets, move a public domain, copy a database, or execute a cutover. `apply` and automatic resume/rollback are not implemented.

The release updater is **not ready for general customer rollout yet**. The repository has no published stable baseline release/tag. The isolated direct PostgreSQL updater rehearsal through `0079` passes. Hosted commit verification requires the deployed runtime to report the same database fingerprint as the migration target, the schema and migration ledger to be ready, and public API readiness to succeed. That guard is locally tested; it has not been exercised against a real customer release. Supabase Management API reads, clean-clone adoption, customer-fork conflict handling, hosted deployment after schema change, backup restore, and interrupted-migration recovery remain unproven. CI run [#109](https://github.com/amxcodes/novaprime/actions/runs/38076798924) passed for the currently published `fd1e520` source.

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

1. **Verify the actual live baseline — application code is published and CI passed; runtime checks remain.** The live application bundle corresponds to `fd1e520`; later `main` publications only changed documentation. GitHub #109 passed `checks` and `postgres`. The disposable Supabase project is on checksum-verified `0080`, with RLS and execute-only lease access. Its latest recorded named scheduler tick was at 18:10 UTC after `1f14e3e`, and the acquire RPC had five calls. Re-read readiness and protected runtime/database identity and record a fresh tick for the current app build. The selected project cannot prove all triggers in every connected customer account.
2. **Make releases usable by customers — updater is implemented, but stable customer discovery is not active.** Version/package/manifest are `0.1.3`; local fresh install, SQL/RLS checks, restricted-role checks, updater migration rehearsal and archive restore pass. The GitHub Releases inventory is empty; the workflow creates drafts only, which updater discovery ignores. Publish an updater-bearing baseline and a newer stable release, then test clean-clone adoption, customer-fork conflicts, wrong-project refusal, migration failure/retry, declined push and host-build failure after schema change.
3. **Prove each advertised first install — local Docker flow passed; hosted profiles are partial.** Docker/PostgreSQL 17 migration, restore, background tick, and a complete isolated first-run flow through Nginx passed, including a non-default port, founder verification handoff, workspace setup, authenticated office creation/readback, and cleanup. The root cause was Nginx dropping the port from `X-Forwarded-Host`; the proxy fix and regression test passed. Netlify + Supabase is only a disposable live test project; Cloudflare has no live Hyperdrive sign-in/read/write proof. Internet-facing VPS firewall/TLS still needs a reviewed rehearsal.
4. **Complete one safe runtime move — planner and preflight gates exist; real execution is not implemented.** The Netlify→Cloudflare plan keeps the same database, Supabase scheduler, secrets and origin. There is no journaled candidate upload, provider readback, traffic promotion or proven recovery. This requires a scoped Cloudflare account; do not conflate it with a database move.
5. **Keep scheduler ownership clear — a selected Supabase scheduler and lease-backed run were verified before the current deploy.** Exactly one active `nova-background-tick` was observed; its 18:10 UTC run succeeded after `1f14e3e` and before `fd1e520`, with five recorded acquire calls. Local SQL tests cover overlap, expiry, fencing and restricted grants. Record a fresh tick after the current deploy; account-wide duplicates, other-provider triggers and missed-run/recovery cases remain unproven.
6. **Gate database moves as their own project — boundary is in place; transfer remains intentionally separate.** Runtime plans preserve database identity and block an implicit database move. Any future copy/cutover requires a separate plan for write freeze/drain, backup and restore, row/sequence/RLS/auth comparison, and recovery. No cross-database copy was attempted.
7. **Finish user-facing quality checks — the Work renderer and attendance setup copy are live.** After deployment, Work rendered its full sections and People/access showed the protected Super Admin role and authorized people directory. Attendance explains that the disposable organisation needs an office and assignment; it no longer presents the generic load error and retry action. Phone/tablet, keyboard and screen-reader review and full employee, reviewer, and restricted-role journeys remain. Payroll execution is future work; keep its permission/schema foundation only.
8. **Measure speed and capacity — realistic local burst passes; production still slow.** The latest local PostgreSQL 17 run used 200 employees × 10 tasks, up to 25 concurrent requests, and measured work-context p50/p95/p99 at 298/418/455 ms; create/self-assign 171/241/299 ms; timer start 95/138/187 ms; timer stop 54/77/99 ms; assignment reads 365/537/588 ms. This is local in-process load, not a hosted SLA or sustained month-long usage. At 00:20 IST on 11 October, Netlify's rolling 24-hour metrics showed 591 `nova` invocations, zero function errors, average 3.04 seconds, p95 6.20 seconds and p99 6.92 seconds. The window spans deployments; regional A/B, matched protected-route browser waterfalls, longer soak, provider connection headroom, and route-level comparisons remain open. Do not call speed fixed or claim capacity from the local test alone.
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
