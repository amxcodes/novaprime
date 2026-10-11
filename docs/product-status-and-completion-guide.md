# NOVA today: what works, what is live, and what is left

**Reviewed:** 11 October 2026<br>
**Latest published application source:** `main` at `68d2631` (Netlify production deploy `6acb52834f8e250008b6e15e`). GitHub verification runs [#132](https://github.com/amxcodes/novaprime/actions/runs/38127425505) and [#133](https://github.com/amxcodes/novaprime/actions/runs/38127662627) passed both required jobs. The documentation-only commit `a957cd4` is also published at deploy `6acb53792043370008e33da4`.
**Purpose:** a quick, plain-language guide to the product's current state. The linked technical plans contain the detailed commands and test evidence.

## The short version

NOVA is a substantial, working people-operations product with a shared API, PostgreSQL data model, role and scope checks, attendance and availability workflows, task/work tracking, and a feature-based UI. Application code from `68d2631` is published on Netlify and two verification runs passed. The Super Admin Work experience is split into six areas: My work, Tasks, Reviews, Requests, Reviewer management, and Work context. A live smoke rendered those areas and their expected empty/setup states; restricted real-user roles and mobile/tablet browsers were not part of that smoke.

The disposable Netlify + Supabase deployment has migration `0080`. Small live samples after the latest runtime deploy show warm Work around 2.23 s, Notifications and Work-session reads around 4.15–4.24 s with about 3 s of accumulated pool-acquisition time, and a later warm Work-session read around 1.18 s. Netlify Functions run in Ohio while Supabase is in Seoul; the account's region control is locked behind a paid Netlify plan. These samples do not establish a p95 or prove one cause. GitHub still has no published stable release, so a fresh customer clone cannot discover the updater path. WSL/Docker/PostgreSQL 17 fresh install, restore and local authenticated lifecycle evidence pass. A Cloudflare remote-development test, permanent Worker, runtime cutover, internet-facing Docker host/TLS, restricted-user role journeys, mobile/tablet browser review and sustained hosted capacity evidence remain incomplete.

The clearest gaps before calling NOVA a finished, customer-ready product are: publish and exercise the customer release path; prove fresh installs and updates on the hosted stacks; finish one safe runtime-move executor and recovery; complete real-user role and workflow checks; finish responsive and accessibility QA; prove the internet-facing Docker path; and measure performance beyond a one-time test burst.

## What “live” means here

| What we can confirm | What that proves |
| --- | --- |
| The live application bundle corresponds to source `68d2631`. GitHub runs [#132](https://github.com/amxcodes/novaprime/actions/runs/38127425505) and [#133](https://github.com/amxcodes/novaprime/actions/runs/38127662627) passed `checks` and `postgres`; the signed-in Super Admin smoke rendered six Work areas. | The test site serves this source and its required CI is green. This is not evidence of a customer's independent installation or a restricted-role workflow. |
| Small live route samples after this deploy show about 2.23 s for warm Work, 4.15–4.24 s for Notifications and Work-session reads with roughly 3 s aggregate pool acquisition, and a later warm Work-session read at 1.18 s. | These are a few samples, not route percentiles or matched browser waterfalls; hosted performance remains open. |
| The disposable Supabase project `owfgvojdaxafayutbcuf` is recorded at migration `0080`. Read-only checks found one active named Cron job; its 06:35 UTC tick on 11 October succeeded, and the matching `net._http_response` row recorded HTTP 200 with no error. | The selected job completed through the lease-protected path after the current application deploy. This does not prove that no unselected external scheduler exists. |
| The earlier Netlify rolling 24-hour window through 11:12 IST on 11 October showed 647 `nova` invocations, average 3,241 ms, p50 2,926 ms, p95 5,633 ms and p99 5,666 ms; it predates `68d2631`. | The window spans deployments and does not identify slow routes or client page waterfalls. The newer samples still lack enough repetitions for percentiles. |

The inspected project is explicitly disposable test infrastructure. No customer database was changed during the Work update. Migration `0080` is checksum-recorded there, and the latest verified Cron callback is historical; capture a fresh tick for the latest runtime. The live Super Admin Work page rendered its expected empty/setup state without changing records. Attendance explains that an office assignment is required. The deployed release source remains `0.1.3`; `0.1.4` is an uncommitted candidate with no schema changes. For real customers, require project identity, a restorable backup, and a verified migration ledger through the migration-owner path.

## Choices available to a new customer

The first-install assistant intentionally offers three complete profiles rather than every possible provider combination:

| Customer choice | Where the app/API runs | Database and scheduled work | What is proven today |
| --- | --- | --- | --- |
| **Netlify + Supabase Cloud** | Netlify Functions | Supabase PostgreSQL; Supabase Cron is the recommended schedule | `68d2631` is published and both latest verification runs passed. The disposable database is recorded at `0080`. Super Admin Work smoke rendered its setup/empty state. Current latency samples remain high and are too few for percentiles. This is not clean-customer setup/update proof. |
| **Cloudflare + Supabase Cloud** | Cloudflare Worker, using Hyperdrive to reach PostgreSQL | Supabase PostgreSQL; Supabase Cron is the recommended schedule | Worker typechecks, tests, local `workerd` smoke, and a no-upload deploy build pass in CI. No Hyperdrive has been configured for NOVA. A no-public-route `wrangler dev --remote` test is the next option; no permanent Worker, public preview, route move, or Cloudflare schedule is verified. Zero Trust setup was declined after a checkout/card requirement. |
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
| **Netlify runtime** | Shared API entry point and build selection for API-only versus legacy Netlify Cron. | Live application code corresponds to `68d2631`; CI #132 and #133 passed. Super Admin Work smoke rendered its setup/empty state. A fresh Cron tick and repeated matched performance distributions remain open. |
| **Cloudflare runtime** | Shared API Worker, Hyperdrive binding, protected tick handling, and read-only inventory of selected Worker/domain/routing state. Public previews require a reviewed access boundary. | Typecheck, local Worker tests/smoke, and deploy dry-run pass. Wrangler remote development is a private test path that may exercise Hyperdrive without a public preview, but NOVA has no Hyperdrive configuration yet. No permanent upload, route promotion, or rollback is claimed. |
| **Docker / direct PostgreSQL runtime** | Compose API, PostgreSQL, Nginx entry point, and maintenance worker. Fresh Compose install, restore, protected tick, and authenticated lifecycle were rehearsed against PostgreSQL 17; the updater's separate direct-PostgreSQL migration path was rehearsed through `0079` with verified TLS. | Strongest local end-to-end evidence. A real remote VPS, native Windows PostgreSQL, external Nginx/TLS, and disaster recovery are not certified. |
| **Vercel runtime** | Compatibility entry point and some read-only inventory. | Retained for existing installations; not a new-customer profile. Cron active/disabled state is not fully provable through the current inventory. |
| **Database setup** | Supabase bootstrap and direct PostgreSQL setup, migration manifest, restricted `nova_app` role checks. | The selected disposable Supabase project is checksum-verified through `0080`; its lease table has RLS enabled, the app role has no direct table privileges, and all three lease RPCs are executable. Fresh local PostgreSQL install/restore also passes through `0080`. Database provisioning and cross-database copying are not deployment-manager actions. |
| **Scheduled work** | One protected background-tick API contract; Supabase Cron install/disable commands; Docker maintenance worker; Cloudflare, Netlify, and Vercel compatibility schedules. Migration `0080` adds a database lease that serializes overlapping maintenance executions. | The selected disposable test project's one observed named Supabase Cron job is active. Its 06:35 UTC tick on 11 October succeeded after the current deploy, and the matching Net HTTP callback returned 200 with no error. Inventory cannot prove every external trigger account-wide. |
| **Email** | NOVA supports configured email connections; Node-hosted paths support SMTP, Gmail API, and Resend; the HTTPS Worker path supports Gmail API and Resend. | Local tests and a Cloudflare local-runtime smoke pass. No real customer consent or production message delivery/failure rehearsal is claimed. |

The operational detail and exact gates are in [deployment profiles](deployment-profiles.md), [deployment operations](deployment-operations.md), and the [verification matrix](verification-matrix.md).

## What the updater and deployment manager do

They have separate jobs:

- **`bun run nova:update` updates source and schema.** It checks a pinned stable release, stages changes in an isolated candidate, preserves committed customer changes through a reviewed merge, checks migration hashes and the target database ledger, requires the operator to attest to a recent restorable backup, applies approved migrations, checks the restricted app role, and can offer a separate push to the customer's fork. It does not restart Docker or automatically deploy the customer host. A successful Git push is not proof that the site is healthy.
- **`bun run nova:deployment` diagnoses infrastructure and prepares plans.** `status`, `doctor`, `plan`, `show`, and `verify` inspect selected resources, compare identity/readiness, and record safe plans. The manager does not create customer accounts, write runtime secrets, move a public domain, copy a database, or execute a cutover. `apply` and automatic resume/rollback are not implemented.

The release updater is **not ready for general customer rollout yet**. The repository has no published stable baseline release/tag. The `0.1.3` source at `a957cd4` is the proposed updater-bearing baseline; the local uncommitted `0.1.4` candidate adds diagnostics only and no SQL changes. Hosted commit verification requires the deployed runtime to report the same database fingerprint as the migration target, the schema and migration ledger to be ready, and public API readiness to succeed. That guard is locally tested; it has not been exercised against a real customer release. Supabase Management API reads, clean-clone adoption, customer-fork conflict handling, hosted deployment after schema change, backup restore, and interrupted-migration recovery remain unproven. CI runs [#132](https://github.com/amxcodes/novaprime/actions/runs/38127425505) and [#133](https://github.com/amxcodes/novaprime/actions/runs/38127662627) passed for the published runtime source.

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

1. **Verify the actual live baseline — application code is published and CI passed; runtime checks remain.** The live application bundle corresponds to `68d2631`. GitHub #132 and #133 passed `checks` and `postgres`. The disposable Supabase project is on checksum-verified `0080`, with RLS and execute-only lease access. A fresh current-build readiness/identity read and scheduler tick remain to record. The selected project cannot prove all triggers in every connected customer account.
2. **Make releases usable by customers — updater is implemented, but stable customer discovery is not active.** `0.1.3` at `a957cd4` is the proposed updater-bearing baseline; `0.1.4` is the current uncommitted diagnostics candidate with no SQL changes. Local fresh install, SQL/RLS checks, restricted-role checks, updater migration rehearsal and archive restore pass. The GitHub Releases inventory is empty; the workflow creates drafts only, which updater discovery ignores. Publish a baseline and a newer stable release after exact tag/manifest checks, then test clean-clone adoption, customer-fork conflicts, wrong-project refusal, migration failure/retry, declined push and host-build failure after schema change.
3. **Prove each advertised first install — local Docker flow passed; hosted profiles are partial.** Docker/PostgreSQL 17 migration, restore, background tick, and a complete isolated first-run flow through Nginx passed, including a non-default port, founder verification handoff, workspace setup, authenticated office creation/readback, and cleanup. The root cause was Nginx dropping the port from `X-Forwarded-Host`; the proxy fix and regression test passed. Netlify + Supabase is only a disposable live test project. Cloudflare has no NOVA Hyperdrive config yet; `wrangler dev --remote` is a no-public-route path to test Cloudflare execution and Hyperdrive once configured. Internet-facing VPS firewall/TLS still needs a reviewed rehearsal.
4. **Complete one safe runtime move — planner and preflight gates exist; real execution is not implemented.** A remote-dev comparison can test the Worker and Hyperdrive while preserving the same database and Supabase scheduler, with no public preview or production route change. A real Netlify→Cloudflare cutover still needs a journaled candidate upload, provider readback, traffic promotion and proven recovery. The user declined Zero Trust setup after it required payment/card details; do not create a public Worker preview with production credentials unless a separate access boundary is approved and verified. Do not conflate a runtime move with a database move.
5. **Keep scheduler ownership clear — a selected Supabase scheduler and lease-backed run were verified before the current deploy.** Exactly one active `nova-background-tick` was observed; its 19:00 UTC run on 10 October succeeded after migration `0080`, with 15 recorded acquire calls. Local SQL tests cover overlap, expiry, fencing and restricted grants. Record a fresh tick after the current deploy; account-wide duplicates, other-provider triggers and missed-run/recovery cases remain unproven.
6. **Gate database moves as their own project — boundary is in place; transfer remains intentionally separate.** Runtime plans preserve database identity and block an implicit database move. Any future copy/cutover requires a separate plan for write freeze/drain, backup and restore, row/sequence/RLS/auth comparison, and recovery. No cross-database copy was attempted.
7. **Finish user-facing quality checks — the Work experience is split into six server-planned areas and live for Super Admin.** The live smoke rendered My work, Tasks, Reviews, Requests, Reviewer management, and Work context in their authorized empty/setup states. It did not exercise restricted real-user roles or change records. Attendance explains that the disposable organisation needs an office and assignment. Phone/tablet, keyboard and screen-reader review and full employee, reviewer, and restricted-role journeys remain. Payroll execution is future work; keep its permission/schema foundation only.
8. **Measure speed and capacity — realistic local burst passes; hosted latency remains high and distribution evidence is incomplete.** The latest local PostgreSQL 17 run used 200 employees × 10 tasks, up to 25 concurrent requests, and measured work-context p50/p95/p99 at 298/418/455 ms; create/self-assign 171/241/299 ms; timer start 95/138/187 ms; timer stop 54/77/99 ms; assignment reads 365/537/588 ms. This is local in-process load, not a hosted SLA or sustained month-long usage. Post-deploy live samples include warm Work around 2.23 s, Notifications and Work-session reads around 4.15–4.24 s with roughly 3 s aggregate pool acquisition, and a later warm Work-session read around 1.18 s. The older mixed Netlify 24-hour window showed p95 5.63 s and predates `68d2631`. Regional A/B, matched authenticated browser waterfalls, longer soak, provider connection headroom, and route-level comparisons remain open. A `wrangler dev --remote` test is a no-public-route Cloudflare comparison option, but has not yet run. Do not call speed fixed or claim capacity from the local test alone.
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
