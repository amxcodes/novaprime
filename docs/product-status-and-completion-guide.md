# NOVA today: what works, what is live, and what is left

**Reviewed:** 10 October 2026  
**Repository snapshot:** `main` at `01bfe1d` (`origin/main`)  
**Purpose:** a quick, plain-language guide to the product's current state. The linked technical plans contain the detailed commands and test evidence.

## The short version

NOVA is a substantial, working people-operations product with a shared API, PostgreSQL data model, role and scope checks, attendance and availability workflows, task/work tracking, and an increasingly separated UI. The source at this snapshot is on GitHub `main`, and its verification workflow passed.

That does **not** mean the current source has been proven live on your Netlify site, or that every deployment can be moved automatically. We have not verified the current deployed commit, current hosted database migration head, or a live provider cutover in this review. The deployment assistant guides setup; the local deployment manager can inspect and plan, but cannot yet safely perform a provider move. The updater is implemented in preview, but still needs its published release path and hosted upgrade rehearsals before customer rollout.

The clearest gaps before calling NOVA a finished, customer-ready product are: prove fresh installs and updates on the actual supported hosted stacks; finish the safe runtime-move executor and recovery; complete real-user role and workflow checks; finish responsive and accessibility review; and measure performance beyond a one-time test burst.

## What “live” means here

| What we can confirm | What that proves |
| --- | --- |
| `main` and `origin/main` point to `01bfe1d`; the worktree was clean. | The reviewed code is committed and pushed to GitHub. |
| GitHub verification run [#99](https://github.com/amxcodes/novaprime/actions/runs/38047227858) passed its `checks` and `postgres` jobs. | The repository's automated checks passed for that commit. |
| A Netlify test site has been used in earlier work. | A test deployment existed; that alone does not tell us which commit it serves today. |

This review could not confirm the current Netlify deploy SHA, public readiness, active scheduler, or the live Supabase schema head. Treat those as **unknown until the provider dashboard and `/api/ready` are checked**. The newest source includes migrations through `0079`. Earlier hosted Supabase evidence recorded a ledger through `0074`; it does not prove the newer migrations are present on the project you currently use. Do not run an update against a customer database until its project and migration ledger are explicitly confirmed.

## Choices available to a new customer

The first-install assistant intentionally offers three complete profiles rather than every possible provider combination:

| Customer choice | Where the app/API runs | Database and scheduled work | What is proven today |
| --- | --- | --- | --- |
| **Netlify + Supabase Cloud** | Netlify Functions | Supabase PostgreSQL; Supabase Cron is the recommended schedule | The production function packages are checked offline in CI. No current live Netlify rollout or trigger is confirmed by this review. |
| **Cloudflare + Supabase Cloud** | Cloudflare Worker, using Hyperdrive to reach PostgreSQL | Supabase PostgreSQL; Supabase Cron is the recommended schedule | Worker typechecks, tests, local runtime smoke, and a no-upload deploy dry-run pass. Real Hyperdrive connectivity and a live Worker rollout are unverified. |
| **Self-hosted Docker + PostgreSQL** | NOVA containers behind Nginx | PostgreSQL in Compose; one local maintenance worker | Fresh local PostgreSQL 17/Compose runs passed health, readiness, and scheduled-work checks. This does not certify an internet-facing VPS, external TLS, or backup/restore operation. |

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
| **Netlify runtime** | Shared API entry point and build selection for API-only versus legacy Netlify Cron. | Packaging and adapter checks pass. A current hosted deploy, secret configuration, public health, and live schedule still need verification. |
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

The release updater is **not ready for general customer rollout yet**. Repository release guidance says maintainers still need to publish the updater-bearing `v0.1.2` baseline and a later stable release, then pass upgrade rehearsals for Supabase and direct PostgreSQL. The direct PostgreSQL updater rehearsal through `0079` now passes locally; that does not close the Supabase Management API, customer-fork conflict, hosted deployment, or recovery tests.

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

1. **Verify the actual live baseline.** In Netlify, confirm which commit is deployed. Check public `/api/health` and `/api/ready`, the selected Supabase project, current migration head/checksums, runtime bindings, canonical URL, and which scheduler is active. Do not let a healthy GitHub run stand in for this check.
2. **Make releases usable by customers.** Publish the reviewed `v0.1.2` updater baseline, then a newer stable release. Rehearse customer-fork conflicts, wrong-project refusal, failed migration/retry, backup restore, denied push, and a host build failure after migration on disposable Supabase and PostgreSQL targets.
3. **Prove first install on each advertised profile.** From a fresh clone, complete sign-in, one real representative read/write, a background tick, and backup/restore instructions on Netlify + Supabase, Cloudflare + Supabase, and Docker/PostgreSQL. Record the deployed commit and provider evidence.
4. **Complete one safe runtime move.** Start with Netlify → Cloudflare while keeping the same Supabase database, scheduler, secrets, and public origin. Implement a journaled candidate upload, readback, route promotion, and recovery. Rehearse stale plans, wrong database, duplicate jobs, Access exposure, DNS/TLS delay, crash between writes, and rollback failure. Keep `apply` blocked until those pass.
5. **Keep scheduler ownership clear.** Inventory all triggers that could call a database, prove the old trigger is disabled before enabling a new one, and test duplicate, missed, overlapping, failed, and retried ticks. Provider inventory currently sees selected resources, not every possible account or external trigger.
6. **Gate database moves as their own project.** Before automatic copying, add a write-maintenance gate and request drain, tested backup/restore, table/data/sequence/RLS/auth comparison, cutover, and rehearsed recovery. Runtime switching must not silently copy or change a database.
7. **Finish user-facing quality checks.** Run actual restricted-role browser journeys, complete the employee task/submission/review/handover and HR flows, and verify keyboard use, screen-reader announcements, mobile/tablet breakpoints, and responsive layouts. Ensure inaccessible screens don't fetch sensitive data. Some local filters exist over bounded, already-authorized records; if the product rule is that every search/filter must be server-side, finish migrating those remaining cases.
8. **Measure speed and capacity in realistic conditions.** A recorded one-shot 100-employee burst passed, but work-context p95 was about 3.05 seconds; that is a clear optimization target. The burst is not a sustained service-level result. A local request-scoped connection test also hit PostgreSQL's default connection limit and does not represent hosted Hyperdrive pooling. Measure p95 API/database time, pool headroom, runtime duration, and scheduled work at 100 employees and a doubled 200-employee scenario.
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
