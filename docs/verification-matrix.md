# NOVA verification matrix

## Latest deployment profile follow-up — 2026-10-11

The current application source baseline is `main` / Netlify `fd1e520`. Netlify
published deploy `6aca86da31a9180009230764` from that commit. GitHub verification
[run #109](https://github.com/amxcodes/novaprime/actions/runs/38076798924)
passed both required `checks` and `postgres` jobs. The earlier run #107 failed
because its Docker profile test still expected Nginx to drop a non-default
port; `c025824` aligned that assertion with the intended `$http_host`
forwarding behavior. `2099ad0` fixed the Work review-action import and origin
port forwarding. `fd1e520` makes the no-office attendance condition explicit.

The disposable Supabase project `owfgvojdaxafayutbcuf` has checksummed
migration `0080`, RLS enabled on the lease table, no direct `nova_app` table
privileges, and execute-only lease RPC access. The latest recorded query
observed one active `nova-background-tick`, a successful 18:10 UTC tick after
the earlier `1f14e3e` deploy, and five lease-acquisition calls. That scheduler
evidence predates the later `2099ad0` and `fd1e520` deployments; a post-latest-
deploy tick still needs a fresh read. This verifies the selected project and
named job only; it cannot inventory every external trigger.

WSL/Docker QA applied all 80 migrations to isolated PostgreSQL 17, passed the
SQL/RLS fixtures and least-privilege app-role checks, exercised the protected
maintenance tick, and restored a dump with table counts, RLS policies,
sequence state, auth/session rows, encrypted secrets, and app-role boundaries
compared. A local 200-employee × 10-task burst at concurrency 25 passed; its
in-process p50/p95/p99 were work-context 298/418/455 ms, create/self-assign
171/241/299 ms, timer start 95/138/187 ms, timer stop 54/77/99 ms, and
assignment reads 365/537/588 ms. This is not an HTTP/network measurement,
hosted capacity guarantee, or sustained soak.

The normal founder first-run workflow through the loopback Nginx proxy exposed
a real regression: registration with a non-default local port failed the
server's same-origin check because Nginx removed the port from
`X-Forwarded-Host`. The focused fix preserves the incoming authority. A fresh
isolated Compose rerun then passed founder registration, the no-email
verification handoff, workspace setup, authenticated office creation and
readback, health/readiness, and one protected worker tick. The API and worker
had no host port bindings; Nginx and PostgreSQL were loopback-only. The run's
containers, volume, network, images, temporary `.env`, and directory were
removed afterward. Focused request-security tests passed 7/7 and the server
image built successfully.

The signed-in production Work page previously failed while mounting reviews:
`canRenderRequestReviewActions` was referenced but not imported. After that fix,
the Super Admin Work route rendered assignments, visible tasks, reviews,
collaboration and handovers, reviewer management, sessions, timeline,
attendance, and server-side work-context search. The latest live page shows
“Attendance setup required” with guidance to configure an office and assignment;
the generic attendance error and retry action are absent. This is the correct
setup state for the disposable organisation, which has zero offices and
departments, as confirmed in Organisation settings. People/access also loaded
with the protected Super Admin role and scoped people directory. No records
were changed.

Customer release discovery is still unavailable: there are no published
stable GitHub releases/tags, and the current release workflow creates drafts
only. The 200-employee local burst and Docker restore do not prove fresh
Netlify+Supabase or Cloudflare+Supabase customer installs. No live Cloudflare
Worker/Hyperdrive runtime or same-database move is verified. At 00:20 IST on
11 October, the rolling Netlify Function Metrics window showed 599 total
invocations and zero function errors. The `nova` function accounted for 591
calls: average 3,035 ms, p50 2,670 ms, p95 6,203 ms, and p99 6,916 ms. This
window spans deployments and is not route-level; API/page speed remains open.
Public readiness and protected runtime/database identity for the exact
current build have not been rechecked, and no post-latest-deploy scheduler tick
is recorded. Detailed local commands and evidence remain in
[`runtime-smoke.md`](runtime-smoke.md).

Evidence snapshot: 2026-09-27. The latest end-to-end PostgreSQL 17 QA command
passed twice in WSL Docker using fresh generated databases and private,
unpublished QA services: migrations 0001–0074, all 53 rollback/RLS fixtures,
604 default and 2,414 100-employee authenticated lifecycle assertions,
pending/approved/rejected/
cancelled WFH attendance, geofence/leave smoke (including scoped review across
different office-local dates), application-role preflight and the 0072-to-0074
upgrade rehearsal. A separate customer-style Docker Compose run also passed
against its own direct PostgreSQL database, checked the deployed API and ran
one protected `vps` tick. These runs were isolated from the shared `nova`
database and volume. This proves local direct-PostgreSQL behavior, not a live
VPS or hosted-provider deployment.

Latest follow-up on 2026-09-27: a fresh `bun run qa:postgres` run again passed
the 74-migration database build, rollback/RLS fixtures, 604-assertion
authenticated lifecycle, specialized WFH/attendance/leave/geofence smoke,
application-role preflight and 0072-to-0074 upgrade rehearsal. Only that run's
unique QA database and verified Compose resources were removed. The same pass
also reran the unit suite (118 tests / 512 assertions), typechecks, syntax
checks and all-pairing deployment-guide smoke. A local in-app-browser
walkthrough exercised all eight supported host/scheduler pairings. It did not
configure a cloud provider, and hosted deployments/schedulers remain untested.

The full Node-pool gate passed with 100 synthetic employees; the latest repeat
measured work-context p95 at 3,052.4 ms, task creation/self-assignment at
527.2 ms, timer start at 677.5 ms, timer stop at 318.2 ms and assignment reads
at 283.6 ms. This run verified 100 server-classified tasks, 100 assignments,
100 closed timers and zero open timers. It is a one-shot burst, not a sustained
multi-office capacity or SLA result; production pool defaults were not
increased.
Repeating the burst through Wrangler's request-scoped local-direct connection
hit PostgreSQL's default connection ceiling, as that local mode bypasses
Hyperdrive pooling. This is not a hosted Hyperdrive capacity result; a real
Hyperdrive 100-employee burst remains unverified.

## Follow-up evidence — 2026-10-07

The disposable Supabase log export records migrations 0075–0078 as applied,
then later PostgreSQL `28P01` authentication failures. Better Auth's schema
validation message is secondary to that connection failure. A credential-free
Netlify probe returned `/api/health` 200 in 0.857–1.367 s, `/api/ready` 503 in
2.356–2.384 s, and `/api/auth/get-session` 500 in 3.466–3.915 s (three samples
per route). These failed-readiness timings include caller/network and function
overhead; they are not a healthy API performance baseline. Do not tune database
pools from these failed-auth samples.

Two safeguards now address the setup path: routine bootstrap preserves an
existing `nova_app` password unless rotation is explicitly requested, and
bootstrap/preflight reject a Supabase connection URL whose project identity
does not match the confirmed project. The latter was checked against the
current QA env file without displaying or transmitting its credentials and
failed before any database write. GitHub Actions `Verify NOVA` passed for
commit `cfb3c761bbbd79d4f48cfa653f6ba7e7dc1ec3b7` ([run 37521496578](https://github.com/amxcodes/novaprime/actions/runs/37521496578)).
The subsequent baseline commit `e4351562b060450840376a3b0c1238d5a35120f7`
also passed the full GitHub Actions checks and PostgreSQL lifecycle gate
([run 37522254064](https://github.com/amxcodes/novaprime/actions/runs/37522254064)).

### Historical sign-in incident — recovered on 7 October 2026

The initial Netlify logs showed `28P01` password-authentication failures. The
Production database URL visible during diagnosis had a project-qualified
username for another Supabase project, while NOVA's intended disposable test
project was `owfgvojdaxafayutbcuf`. After the database URL was corrected and
Netlify redeployed, read-only checks returned `/api/ready` 200 and
`/api/auth/get-session` 200 with a signed-out session; the user then confirmed
normal sign-in succeeded. These logs explain the earlier outage and must not be
read as the current status. No schema migration was needed to resolve it.

The target database was shown in Seoul (`ap-northeast-2`); use the exact host
from that project's Transaction Pooler connection dialog because the shared
pooler hostname's index cannot be inferred from region. The successful sign-in
did not verify runtime/database identity for the later `fd1e520` application
deploy. A fresh readiness and protected identity check for that build remain
open.

The supplied detailed Supabase export confirms migrations 0075–0078 completed
and `ALTER ROLE nova_app ... PASSWORD` succeeded at 18:44 UTC; the earlier
`42P01` missing-table events precede those migrations. Netlify then reported
`28P01` at 19:17 UTC and later, consistent with a hosted runtime password that
was not updated after the successful role-password change. A separate
read-only QA connection attempt returned Supavisor `ENOTFOUND tenant/user`, a
host/username routing failure rather than a bad-password result. The QA URL's
pooler username suffix did not match its declared project, and the currently
configured management token returned 403 for the project's pooler-config
endpoint. No migration or password rotation was attempted during this check.

Setup now always resolves the shared transaction-pooler host from the selected
project's read-only Supabase configuration endpoint; it no longer trusts a
saved host for the same project ref, and rejects a conflicting explicit host.
The focused pooler tests (9/9) and `bun run typecheck` pass. Netlify remains
blocked until its Functions `DATABASE_URL` is updated to the current
target-project `nova_app` credentials and exact transaction-pooler endpoint,
then redeployed and checked through readiness and sign-in. Do not rotate the
role password again until the hosted secret can be updated in the same change.

The attendance `currentAvailability` read was consolidated from six serial
PostgreSQL statements into one query that preserves effective-date, office
timezone, calendar/shift, holiday, and WFH override precedence. `bun run
typecheck` and `bun test scripts/update` passed (60 tests / 233 assertions).
The isolated PostgreSQL 17 lifecycle run passed 78 migrations, 53 rollback/RLS
fixtures, 614 lifecycle assertions, specialized attendance/WFH/leave/geofence
smoke, application-role preflight, and the 0072→0074 billing upgrade rehearsal;
its database and containers were removed afterward. These are local query and
schema correctness checks. They do not provide a hosted latency measurement or
resolve the Production `28P01` credential failure.

Phone navigation was refined so a role with bottom quick navigation has one
drawer trigger at phone widths: “More” remains and the duplicate top-bar menu
is hidden through 639px. Tablet widths retain the top-bar trigger, and roles
with no quick destinations retain it on phones. Responsive behavior tests
(11/11), shell component tests (7/7), UI typecheck, and production Vite build
passed. No authenticated live-browser or physical-device visual check was run.

Production recovery — 2026-10-07, 13:08 IST: Netlify's Production
`DATABASE_URL` was updated after the then-published deploy. I triggered a fresh
deploy of the same verified `d78b472` source; Netlify published it successfully
at 13:07:34 IST. Live read-only requests then returned `/api/ready` 200 with
`status=ready` and `scheduler=supabase`, and `/api/auth/get-session` 200 with
`null` while signed out. The user retried the normal sign-in and confirmed it
succeeded. The new function log showed no `28P01`; it did show Better Auth
falling back to one shared per-path rate-limit bucket because its client IP was
missing. The current Netlify adapter forwards only the provider-trusted
Function `context.ip` through an overwritten private header, with
caller-supplied values rejected; this code is included in the published
application source. Production logs have not been rechecked to confirm the
fallback warning is gone.

Healthy-path latency is still a release concern. Netlify reports the function
region as CMH (Ohio, US East), while the selected Supabase project's primary
database is in Seoul (`ap-northeast-2`). This geographic mismatch is a plausible
contributor, not a measured causal breakdown. Small unauthenticated samples
varied: an independent five-sample run found `/api/auth/get-session` median
1.315 s total / 512 ms app time, with a cold first sample at 2.439 s / 1,753 ms
app time; three later requests from this runner took 1.65–2.15 s total. These
samples are not p95s or authenticated-route measurements. No function-region,
database-region, or hosting-provider change was made. Netlify currently locks
custom function regions for this project; use a measured same-region deployment
or a deliberate database migration plan before changing infrastructure.

The permission-catalogue migration 0079's new column is present on the
disposable target, but its migration-ledger row/checksum could not be read as
`nova_app` (expected least privilege), and the available management token could
not read that endpoint. Do not apply the raw SQL again. Verify the row through
the migration-owner path or the normal ledger-aware updater before the next
upgrade. Production readiness, the anonymous Better Auth session endpoint, and
the user's successful sign-in are now verified; full authenticated Admin/Work
coverage, live migration-ledger verification, and responsive device/browser
checks remain open.

## Verified evidence (database and host-local scopes)

| Area | Evidence | Result |
| --- | --- | --- |
| Unit and API contracts | `bun run test` — 118 tests, 512 assertions; includes pooler-host discovery, project-scoped host selection, canonical billing-rule route, editable role-starter draft/scope tests, provider adapter contracts, Cloudflare Direct-vs-pooler guidance and required Hyperdrive binding, deployment host/scheduler actions and locations, Netlify scheduler-specific function-directory selection, runtime-value placement, conditional Vercel Cron configuration, role-grant round trips, permission-grant scope and navigation, unverified-user guidance, read-failure versus empty-state tests, static asset paths, SMTP STARTTLS enforcement, Gmail HTTPS/MIME delivery, sanitized Google errors, Cloudflare Cron failure propagation, and rendered deployment-assistant phase/probe gating | PASS locally on 2026-09-27 |
| Continuous integration | `.github/workflows/verify.yml` defines fast checks and the isolated PostgreSQL lifecycle gate; `Verify NOVA` passed for commit `cfb3c761` on 2026-10-06 UTC | PASS on hosted GitHub Actions |
| Public-origin link safety | `public-origin.test.ts` rejects network-path, backslash-host and absolute external paths; `notification-worker.test.ts` verifies notification links are rebased to the configured NOVA origin | PASS for pure link formatting; persisted-origin integration remains a separate smoke gate |
| TypeScript/API and adapters | `bun run typecheck`, `bun run typecheck:cloudflare`, server build, `node --check web/app.js` and `web/deployment-guide.js`; Vercel/Netlify wrapper tests and Cloudflare Worker Bun harness, including fail-closed behavior when Hyperdrive is absent even if a legacy `DATABASE_URL` exists. An earlier Wrangler 4.141.0 dry-run and local `workerd` startup/Gmail MIME smoke passed. After the Wrangler configs gained `keep_vars=true`, a refreshed dry-run was attempted but the CLI bootstrap could not fetch its bundled CLI, so the updated TOML was not re-bundled in this pass. | PASS for current type/syntax/tests; current Wrangler dry-run and live Cloudflare deployment remain unverified |
| Smoke harness and QA launcher type safety | Strict TypeScript check of the preflight, WSL-aware QA launcher, local QA runner and both runtime smoke scripts | PASS |
| Deployment assistant actions | Rendered-flow smoke covers all eight valid host/scheduler pairings, identifies where each setting is applied, distinguishes a checklist selection from a provider change, and keeps Supabase Cron creation hidden until API health/readiness pass with `scheduler=supabase`. The VPS/Compose API image was rebuilt and verified to contain the revised UI assets. | PASS locally; provider accounts remain untouched |
| Bootstrap encryption secret | A customer-style Compose rerun exposed that the installers emitted hex while NOVA requires a 32-byte base64url key. Bash and PowerShell bootstrap now generate the required format; setup, deployment preflight and `/api/ready` reject malformed values. Tests accept valid 32-byte keys and reject the previous hex form. A fresh isolated browser run used a test-only setup token, created a synthetic founder, saved the public origin, requested and revealed the no-email verification handoff, consumed its local link, and showed `Verified` with no pending handoff. | PASS locally; WSL had to remain active during browser loopback testing |
| PostgreSQL schema and migration upgrade | Fresh generated PostgreSQL 17 database; migrations 0001–0074; all 53 rollback/RLS fixtures. A separate upgrade database applied 0001–0072, seeded active and reset-to-inherit legacy rules, applied 0073 and 0074, and verified restoration of the latest active rule and reset-to-default revision from migration-0073 audit evidence without changing task/session snapshots. | PASS on the 2026-09-26 isolated WSL run |
| App-role boundary | Preflight returned `ready`: `nova_app` owns no NOVA objects, cannot assume object-owner roles, has no privileged membership; `nova_auth."rateLimit"` present; 74 migrations/latest 0074 verified through the migration role | PASS |
| Supabase Cloud database/API path | On the explicitly selected disposable project, the Management API returned the configured transaction-pooler host; `DATABASE_URL` authenticated as `nova_app` (`rolsuper=false`, `rolbypassrls=false`); preflight verified all 74 migrations through 0074 and returned `ready`; a loopback NOVA API connected to that database returned health/readiness 200 and unauthenticated tick 401; four failed sign-ins for a random `.invalid` identity returned 401, 401, 401, 429; no tick ran. On 2026-09-26, the root `.env` token was used only with the explicit disposable ref `ytfuwtlioxggccbarmdz`; project lookup returned `ACTIVE_HEALTHY`, and read-only app-role/migration preflight returned `ready` (scheduler enum supplied to that process only). A fresh read-only check found `pg_cron` enabled and zero active NOVA Cron jobs; a prior catalog audit found 54 RLS tables, zero policy gaps and zero PUBLIC security definers. Bootstrap is unavailable because the project has one organisation/five auth users, and no disposable Super Admin login is configured. | PASS for DB/schema/security/readiness/auth rejection; no deployed hosted API, authenticated domain lifecycle, valid tick, or live scheduler is proven in Cloud |
| Cloudflare local Worker + scheduler | On 2026-09-26, Wrangler 4.141.0 ran in local Workerd against disposable PostgreSQL 17 in WSL using the request-scoped `Client` path intended for Hyperdrive. Migrations 0001–0074 completed. `/api/health` and `/api/ready` returned 200; the unauthenticated Worker tick returned 401; the protected tick returned 200 with zero-work counts. Wrangler Local Explorer dispatched the actual scheduled handler (`outcome=ok`), and captured Workerd logs recorded `background tick completed with HTTP 200`. A separate 100-employee request-scoped burst hit PostgreSQL's default `max_connections` because Wrangler local connects directly and does not apply Hyperdrive pooling; this is not a Hyperdrive load result. The bounded Node-pool 100-employee burst passes separately. No Cloudflare account, remote Hyperdrive binding, Supabase database, or production scheduler was used. | PASS for local Workerd API, protected tick, and scheduled-handler execution. Cloudflare 100-employee pooled load and remote Worker/Hyperdrive/Cron deployment remain untested |
| Auth, invitations and recovery | Founder bootstrap, invitation email mismatch/replay denial and expiry, verification/onboarding, expired verification token without identity verification followed by successful resend, sign-in, one-time reset and replay rejection, expired reset token preserving the existing credential, session revocation, manual invitation/reset handoffs without configured email, expired manual reset handoff is neither listed nor revealed | API/database PASS. Fresh current-build browser flow passed founder setup, email-free verification request/reveal/consumption, generic forgot-password response, reset-handoff staging/reveal, reset form submission, and sign-in with the new synthetic password. The raw Better Auth reset URL did not visibly land on the reset form in that browser run; the NOVA `/reset-password?token=…` screen was opened using the locally revealed token, so direct customer-click redirect remains an investigation item even though the API lifecycle harness verifies the redirect target. Provider delivery, failure/rotation matrix and broader authenticated journeys remain unverified |
| Email runtime compatibility | Node runtime advertises Console/SMTP/Gmail API OAuth/Resend. HTTPS runtime advertises Gmail API OAuth + Resend; Gmail setup uses the shared configured-origin flow and send-only `gmail.send` grant. SMTP is rejected with 422 before persistence. Nodemailer composes RFC-compatible MIME, then Gmail API sends over HTTPS. | Unit + API/lifecycle + local Wrangler `workerd` smoke PASS; no deployed Worker, live Google consent or message delivery |
| Office-local onboarding date | Onboarding now requires an explicit employment start date after office selection and displays the selected office's IANA timezone; it no longer guesses from the browser's UTC date. The API continues to reject dates later than the selected office's PostgreSQL-derived business date. | Source change and `node --check web/app.js` PASS. Browser confirmation remains open because the available browser QA service serves its older bundled asset; the fresh isolated database rerun does not include an interactive browser journey. |
| Custom roles and grants | Create scoped role, assign it, revoke/regrant permissions, reject escalation and out-of-scope writes. Two concurrent edits based on one revision yield one saved revision and one `ROLE_VERSION_CONFLICT`; stored role, grants and policy match the winner as one complete state. Editable Employee, HR, Supervisor, Admin and Client Coordinator starter profiles prefill only unsaved drafts; unsupported grants/scopes are omitted rather than widened, and targeted scopes stay unset until explicitly selected. Admin omits payroll, manual recovery, public-origin and billable/catalog authority. | API/lifecycle and starter resolver PASS: the 604-assertion lifecycle creates/reads back an Employee starter role with exact grants/policy and rejects an HR starter lacking target IDs without persisting a partial role. Browser verified role create/edit and persisted revocation after reopen, but did not exercise the starter selector/Apply interaction; complete role-based browser matrix remains. Optional reads across Admin, Work and Operations preserve per-resource permission/connection failures rather than claiming empty queues or counts. All 16 Admin reads are independently wrapped with `readOrError`; renderers retain successful data and replace only the dependent section on failure. The earlier note that a core 403 can blank the whole console was stale. Actual restricted-role browser coverage remains incomplete. |
| Employee task creation | Work-context offers only eligible scopes and reports current self-assignment eligibility; editor creates task and self-assignment atomically; changing role policy makes self-assignment return a stable conflict without a partial task, while unassigned task creation remains available; two concurrent identical idempotency-key requests return one task/assignment; changed-payload key reuse conflicts; client review gate retained; accepted reviewer request recorded | PASS in API/database smoke. Browser verified the ineligible Super Admin is prevented from self-assigning in Work/Admin forms and is absent from task-assignee choices; the eligible employee remains selectable and reviewer choices remain separate. In Admin, a synthetic task was assigned to the eligible employee with the founder selected as its independent reviewer; the UI showed assignment plus `review required`. Employee-originated task creation/submission and review are not claimed by this browser step; server remains authoritative |
| Archived work-context boundary | Archived clients, client/organisation workstreams and groups are omitted from new-work context. New workstreams/groups/tasks cannot be attached to an archived ancestor or group; billing-policy reads/writes under archived clients also fail closed without changing the policy revision; parent rows are locked during child creation/configuration. Existing task history is not rewritten by these guards. | PASS in default and 100-employee PostgreSQL lifecycle smoke. Archive/rename commands themselves remain absent; their product lifecycle and effects still require a canonical decision |
| Task class and correction task | Migrations 0071–0074 make classification automatic. Organization workstream tasks are non-billable; each client workstream has a required default for one-off/inherited tasks and may have an authorized per-definition rule scoped to that workstream. Neither task creators nor catalog authors can select a class. `tasks.create.billable` independently gates creation of a server-classified billable task. Corrections use their selected definition's rule or the workstream default, never inherit the source class, and never alter the source. | PASS in local PostgreSQL/API: class-input rejection, manager-scope/employee denial, reason/revision/audit, rule reset-to-default, same definition with different workstream rules, independent billable-action gate, policy-edit/task-create serialization, migration-0074 legacy-state restoration, and correction/source independence. Cloud ledger through 0074 verified; hosted domain behavior is not claimed |
| Task due-date edit and reminders | PostgreSQL `DATE` and office-local due evaluation are preserved. Migration 0066 implements scoped `tasks.edit`, date+revision compare-and-set, audited writes, terminal-state rejection, required in-app notice/optional email staging, expiry of old due notices and cancellation of pending/leased stale email. Reminder idempotency includes revision, the tick skips task rows locked by an edit, and the worker verifies lease/currentness before SMTP. Lifecycle and rollback checks cover stale/invalid/no-op requests, role grant visibility, claimed-email invalidation and scheduler/edit overlap. | PASS in isolated PostgreSQL/API smoke. The authenticated browser saved 2026-10-01 on an unassigned synthetic task and confirmed the date in the task list plus `tasks.due_date_changed` in audit history. Multi-office same-date rendering and assignee notification delivery remain to verify |
| Assignment collaboration | Duplicate onboarding, reviewer acceptance and two-sided handover races; recipient acceptance permission is rechecked at write time; A→B→A return creates separate historical assignments; concurrent handovers to the same recipient yield one success and one `PERSON_ALREADY_ASSIGNED` conflict with no duplicate active assignment; new assignee loads/submits; old-assignee reuse rejected; timer closes on handover; freeze/session revocation; inactive reviewer replacement; handover withdrawal/decline/expiry/replay; submit-vs-handover serialization; competing review decisions; cancellation during pending review; changes-requested/resubmit/final approval with cycle history and notices | PASS; fresh default lifecycle 604 assertions and latest 100-employee run 2,414 assertions. The burst creates 100 tasks with verified class/rule provenance, 100 matching assignments and closed timers, zero open timers |
| Role edits with active sessions/timers | Audit includes before/after role grants and operational policy. Revoking timer-start permission takes effect on the next write; the auth session remains valid and owner can stop an existing timer; regrant enables a new timer. Stale role-editor submissions cannot overwrite a newer revision. | PASS in lifecycle smoke and API contract tests |
| Attendance and availability | Pending WFH remains non-creditable; required timer links only to matching open provisional evidence. Local smoke covers approval/promotion, rejection and cancellation with an open timer, pending-request office check-in conflict, task-history preservation, leave conflict and exact timer/evidence timestamp equality. A PostgreSQL fixture calls the business-boundary function on the America/New_York DST-short day and verifies repeat-tick idempotency; lifecycle API smoke freezes a person with linked provisional evidence and proves no attendance credit is created. Attendance recovery preserves exact microseconds under API clock skew. Concurrent rejection-versus-cancel has one winner, one expected conflict and exactly one final decision event. Concurrent approval-versus-cancel with live provisional attendance and a running task timer also passed: approval won, cancellation conflicted, exactly one final decision persisted, attendance was promoted and the timer continued until explicit cleanup. Ordered approval/cancel and cancel/review edges pass. A scoped WFH/leave review regression also passed with the reviewer evaluated on UTC date 2026-09-26 while the target employee's Pago Pago office date was 2026-09-25; both target-local office and department scopes remained effective. | PASS in isolated PostgreSQL/API smoke; missed-tick recovery against the long-running deployment worker remains |
| Manual work-time corrections | Timeline adjustments preserve exact microseconds in PostgreSQL and audit history and use the database clock under API clock skew | PASS in isolated authenticated lifecycle |
| Background tick | Unit coverage verifies valid-secret provider mismatch returns 409, absent selector returns 503, and wrong/missing secret remains unauthorized. Two concurrent selected-`vps` tick requests both returned 200 and reconciled one unavailable reviewer with one notice. | PASS for local overlap/idempotency; no live provider schedule proof or failure-injection coverage |
| Work UI integration | Task and reusable-definition forms have no billing selector. Authorized policy managers can configure the workstream default and per-definition override; reason/revision and inherit/reset behavior are explicit. Creators see the resulting class/provenance read-only; correction linkage is separate and the source remains unchanged. | PASS in authenticated browser on local WSL PostgreSQL: created a disposable client/workstream, saved an audited non-billable default, added a content-only predefined task, saved its separate workstream rule, and created both one-off and predefined tasks. UI confirmations and the task list showed the server-derived class and provenance. The Admin form disables self-assignment for an ineligible role/status; task assignee choices exclude ineligible people while the reviewer selector remains separate. A synthetic task was assigned to an eligible employee with a distinct selected reviewer; the UI confirmed `review required`. Due-date edit on a second unassigned synthetic task persisted 2026-10-02 and `tasks.due_date_changed`; the UI confirmed `No active assignees to notify.` The preceding UI check exposed and this change fixed the misleading zero-recipient message. No assignee-notification delivery, employee-originated task creation, submission, reviewer action, correction creation, or handover was exercised in this browser run. For this UI proof, the updated web asset was served from the workspace through a temporary loopback-only proxy to the existing QA API because WSL Docker is inaccessible in the current shell; the compiled read handler remains the previously patched container version. A clean image rebuild/deployment with these changes is still to verify. Still remaining: employee work/submission and reviewer/handover journeys, correction creation in browser, keyboard/screen-reader and responsive QA. UI remains text-heavy. |
| Restricted-role UI | In an empty-grant browser mock, Admin and Invite navigation were absent while Today, Work, Operations, Notifications and Settings remained. Directly opening Admin or Invite showed permission errors and no write forms. Settings retained self-service password change and verification request; public-origin controls, email-connection form and system handoffs were hidden with explanatory notices. A Super Admin mock retained Admin/Invite links, public-origin controls and email setup. | PASS for mock browser behavior and fail-closed permission helper tests; real onboarding-only HR/workstream-only journeys remain unverified. Server authorization is still authoritative. |
| Deployment and entry/recovery UI | Public setup, sign-in, forgot-password, reset, invitation and deployment screens render. The secret-free assistant was exercised across Cloudflare + Supabase, Netlify, Vercel, VPS/direct PostgreSQL and local Docker, with scheduler choices matching each path; its no-database probe kept Continue disabled. On 2026-09-26, a fresh local PostgreSQL-backed browser run selected all five runtime shapes and verified each path's scheduler choices; changing a hosted path to Supabase Cron showed instructions to retire that host's native schedule. The live UI probe reported API/database ready and stated it did not verify the full ledger, role privileges or a live trigger. Setup hides the hour-duration field for scheduled attendance, preserves its value when switching back, and blocks an empty founder form with native required-field validation. An earlier isolated Compose browser run created a synthetic founder, saved the public origin, requested/revealed/consumed the email-free verification handoff, and signed in as `Verified`; forgot-password returned the neutral response, reset handoff opened the reset screen with its URL token removed, and the new password worked while the old one was rejected. **Latest rerun is not a pass:** setup and canonical-origin save succeeded, but clicking “Request verification link” showed a generic error; sanitized DB counts immediately afterward were zero rows in both `nova_auth.verification` and `nova.auth_handoffs`. The isolated DB had one active protected founder mapping, and the lifecycle API smoke still passes its verification/handoff assertions (604 assertions overall), so the browser/API discrepancy is unresolved. The UI now reads Better Auth's stable error `code` and maps common origin/session/verification errors to safe guidance, but that exact failing browser action has not yet been rerun against a stable WSL-hosted API. | PARTIAL; require a clean browser rerun of founder verification/handoff before calling onboarding/recovery UI complete. Employee Work/HR journeys, accessibility/responsive checks and live hosted deployments also remain unverified |
| Deployment-guide provider handoff | `deployment-guide.js` covers all five runtime shapes and every allowed scheduler; tests verify provider files/actions, Supabase Cron retirement, readiness gating, and Cloudflare Hyperdrive Direct-endpoint versus Node transaction-pooler setup. The UI gives a compact source→runtime↔database map and keeps the six-part settings map collapsed by default; it distinguishes code deploys, schema, runtime secrets, domain/auth/email and the single scheduler. Vercel registers Cron only for Production `vercel`; Netlify's build plugin selects its scheduled function only for `netlify`, API-only for `supabase`, and no schedule for previews/branch builds. | PASS for 118 tests / 512 assertions, API/Cloudflare/operator typechecks, JavaScript syntax checks, plugin-selection contract, all-pairing rendered smoke, and a local browser walkthrough of all eight supported host/scheduler combinations. The Supabase job-write command stays gated until health/readiness and the selected scheduler match. The browser check verified the shown provider action and confirmation location, but did not log in to or change a provider account. Local Workerd/PostgreSQL tick and scheduled-handler checks pass. No hosted provider build, account change, live schedule, responsive/accessibility review, or remote Hyperdrive operation is claimed. See `docs/visual-deployment-task.md` |
| Supabase write-target safety | `setup:supabase`, direct Supabase bootstrap, and Cron install/remove now require typing the exact displayed project ref; non-interactive use requires `NOVA_SUPABASE_PROJECT_REF_CONFIRM`. Setup does not persist that confirmation in `.env`. | PASS for exact/missing/mismatched confirmation unit checks. The disposable project's read-only audit and `nova_app` preflight returned latest migration 0074 and `ready`; no migration or schedule write was made. Root `.env` still names the primary project; `.env.qa-supabase` lacks its own management token, public HTTPS origin and tick secret. Cloud writes and live Cron activation remain blocked until a correctly scoped QA configuration and publicly deployed API exist. |
| Direct-PostgreSQL customer deployment | Fresh isolated full Compose project applied all migrations through 0074; `/api/health`, `/api/ready`, `/`, and `/app.js` returned 200; `nova_app` was non-superuser, non-BYPASSRLS, non-createdb and non-createrole. Invalid tick secret returned 401, unselected provider 409, and the selected local `vps` tick 200. The WSL-only Docker stack used verified loopback ports; a port conflict with an existing WSL container was detected and avoided. Exact project labels were checked before cleanup; zero project containers/volumes/networks remained. | PASS as local Docker/direct-PostgreSQL deployment paths; not proof of an internet-facing VPS or hosted-provider deployment |
| Docker pool configuration | Compose passes `NOVA_DB_POOL_MAX` to API and maintenance and `NOVA_AUTH_POOL_MAX` to API; Compose config validation is clean. QA-only bounded overrides are logged and passed through WSL. The latest 100-employee burst passed all 53 fixtures, 2,414 lifecycle assertions, specialized smoke and readiness. | PASS locally; no production default increase. Hosted connection caps and replica multiplication still require deployment-specific budgeting |
| Windows-to-WSL local UI bridge | WSL-only Docker requires elevated local access and a live distribution for stable host-forwarded requests. Initial loopback refusal was resolved by keeping WSL active; then Windows health/readiness and the in-app browser succeeded for founder setup, email-free verification handoff, and password-reset handoff. The 2026-09-25 `E_ACCESSDENIED` occurred before Docker and did not affect the elevated isolated PostgreSQL run. | PASS with WSL kept active; Docker Desktop remains the simpler Windows path. Do not treat an idle-distro connection refusal as an application failure. API bind remains loopback-only. |
| PostgreSQL QA rerun on 2026-09-24 | The latest run found a synthetic reviewer missing an office assignment, making its business date fall back to UTC while the role effective date used Asia/Kolkata. The fixture now assigns its office; clean rerun passed and QA removed only its generated database/resources. | PASS; shared `nova` DB/volume and pre-existing QA databases were untouched |

### Browser recovery attempt on 2026-09-27

The two preserved `nova-ui` QA stacks auto-started when the WSL Docker engine
became available. Their API health and readiness endpoints both returned 200
through Windows loopback (`vps` selector). The in-app browser could not reach
the loopback ports (`ERR_CONNECTION_REFUSED`); Brave/Chrome browser targets are
not available to this session, and the isolated API image contains no browser
binary. No founder verification or recovery action was submitted, so this is
not a browser pass or a product failure. I left all six existing containers,
their databases and volumes untouched; the authenticated founder-verification
browser gate remains partial.

## Hosted/provider evidence

- On the explicitly selected disposable Supabase project, migrations 0001–0074
  and the latest migration were verified through the migration ledger; the
  `nova_app` connection authenticated directly through the configured
  transaction pooler with no owner-style bypass; preflight, API readiness and
  Better Auth's database-backed throttling passed. The current test used a
  random reserved `.invalid` identity, not an employee account.
- A temporary Supabase Cron installation was previously created, checked, and
  removed. On 2026-09-25, read-only inventory on the exact disposable project
  confirmed Cron is available but there are zero NOVA background-tick jobs.
  The invalid tick-secret check still returned 401; no valid tick was invoked
  and no live scheduler is configured.
- The access token currently resides in root `.env`, whose project ref is the
  primary project; `.env.qa-supabase` has the disposable ref and matching QA
  database URL/password but no token. The latest read-only checks explicitly
  overrode the ref to the authorized disposable project and used only its QA
  database URL. Do not run root-env cloud commands until the target values are
  deliberately aligned; no Management API request was sent to the primary ref.
- A sandboxed repeat was refused before reaching Supabase. The approved
  elevated retry ran the fixed read-only boundary audit against only the
  disposable ref and confirmed migration 0074, attendance/work-boundary
  functions, work sessions and office snapshot; no cloud write was attempted.
- The browser verified the manual invitation → verification handoff →
  onboarding path in one shared browser while the admin session remained
  present, role create/edit/reopen, billing-policy setup, task creation and
  classification, an admin assignment with a distinct reviewer, and due-date
  editing. Employee-originated task creation, timer/submission/review, correction
  creation, handover and broad Work/HR browser journeys remain unverified.

## Current readiness status — 2026-10-11 (latest evidence)

This table is the current summary. Older date-stamped results below are kept as
history; use newer evidence above when results differ.

| Gate | Current result | What's still needed |
| --- | --- | --- |
| Actual deployed baseline | **Application code from `fd1e520` is published and required CI passed.** Netlify published that application bundle as deploy `6aca86da31a9180009230764`; subsequent `main` publications update documentation only and preserve the same app code. Verification [run #109](https://github.com/amxcodes/novaprime/actions/runs/38076798924) passed `checks` and `postgres`. Live signed-in Super Admin checks confirm Work, People/access, and Organisation render. Work displays the explicit no-office setup state. The selected disposable Supabase project's ledger is checksum-verified through `0080`; the lease table has RLS, `nova_app` has no direct table access and can execute the lease RPCs. The latest recorded scheduler tick was 18:10 UTC after `1f14e3e`, before the current app build. | Re-read public readiness and protected runtime/database identity for the live app code, record a fresh scheduler tick, and extend scheduler inventory beyond the selected project. This does not establish any customer install. |
| Customer releases and updates | **Updater code and local migration/restore evidence exist; customer release discovery is unavailable.** Version `0.1.3` has 80 manifest hashes. Fresh install, SQL/RLS fixtures, restricted-role preflight, and PostgreSQL 17 dump/restore pass. The updater's direct PostgreSQL upgrade rehearsal and zero-pending rerun pass. There are no published stable GitHub releases/tags. | Publish the updater-bearing baseline and the newer tested stable release, then prove clean-clone adoption, fork conflict handling, wrong-project refusal, failed migration/retry, declined push, and host-build failure after schema migration. |
| Advertised first installs | **Local Docker/PostgreSQL lifecycle and archive restore pass; hosted first installs remain unproven.** The local PostgreSQL 17 install applied all 80 migrations, passed protected maintenance and authenticated workflow suites, and restored counts, RLS, sequence, auth/session, encryption, and role boundaries. The founder setup through loopback Nginx was rerun successfully after fixing non-default-port forwarding. The published Netlify + Supabase site is test infrastructure, not a clean customer project. Cloudflare packaging passes CI but no live Hyperdrive connection exists. | Complete isolated Netlify + Supabase and Cloudflare + Supabase first-install checks. Prove internet-facing Docker only after the exact public exposure is confirmed and external TLS/firewall checks are ready. |
| Same-database runtime move | **Planner and safety constraints pass; real cutover is not implemented.** Netlify→Cloudflare planning preserves database identity, scheduler ownership and public origin and disables Worker Cron when Supabase owns the schedule. | Complete and rehearse a journaled Worker candidate upload, exact readback, health/auth/workflow validation, traffic promotion and recovery in a disposable Cloudflare account. This requires an available scoped Cloudflare account/token and must keep the existing database and scheduler unchanged. |
| Scheduler ownership | **A selected Supabase scheduler and lease-backed run were observed before the current deploy.** One active named Cron row existed; its latest verified success was 18:10 UTC after `1f14e3e` and before `fd1e520`, with five lease-acquire calls. Migration `0080` has local overlap, expiration, renewal, stale-owner fencing and execute-only app-role checks. | Record a fresh tick after the current deploy; extend verification to duplicate triggers outside this project and exercise missed runs, retries, secret rotation and recovery on each live supported profile. The current inventory cannot prove every trigger account-wide. |
| Database moves | **Separately gated by design; no transfer was attempted.** Runtime plans preserve database identity. | Treat database copy/cutover as its own future project with write freeze/drain, verified backup/restore, object/data/sequence/RLS/auth comparison and rehearsed recovery. Payroll execution remains future work; retain its schema/permission base. |
| User-facing quality | **The Super Admin Work and People/access routes render in the signed-in production test session.** Work no longer fails while mounting reviews; the People/access screen lists the protected Super Admin role and scoped people directory. Attendance now explains that an office and assignment are required instead of showing the generic API error/retry state. Admin Organisation confirms zero offices and departments. No records were changed. Employee/reviewer workflows, restricted-role journeys, phone/tablet layouts, keyboard and screen-reader review remain open. | Complete representative employee, reviewer, and restricted-role journeys plus narrow/tablet, keyboard, and screen-reader review. Payroll execution remains future implementation; keep only its current permission/schema foundation. |
| Speed and capacity | **200×10 local burst passes; production is still slow.** With 25 concurrent requests, local work-context p95 was 418 ms, create/self-assign 241 ms, timer start 138 ms, timer stop 77 ms and assignment read 537 ms. These are in-process PostgreSQL measurements, not hosted SLA evidence. Netlify's rolling 24-hour metrics viewed at 00:20 IST on 11 October showed 591 `nova` invocations, zero function errors, average 3.04 s, p50 2.67 s, p95 6.20 s and p99 6.92 s. Metrics span deployments and are not route-level. | Measure interleaved authenticated route/page waterfalls, per-route server timing, sustained capacity and pool headroom; compare the same code and database across regions/runtimes before choosing a move. Do not claim the speed issue is fixed from local load alone. |

## Not verified / release gates

| Area | Remaining evidence needed |
| --- | --- |
| Workspace preview freshness | The existing localhost API at `127.0.0.1:39131` returned healthy status but served `app.js` and `styles.css` whose hashes do not match the current workspace, so it is an older image and is not valid evidence for current UI behavior. The workspace deployment guide was instead opened from a temporary loopback-only static preview; no existing container was changed. | Current-source UI behavior is verified by the rendered-flow smoke and workspace preview. Rebuild/redeploy the local API image before using that older localhost instance for any further UI review. |
| Local QA cleanup | On 2026-09-25, WSL showed 16 prior repository-owned `postgres-qa` containers and 17 UUID-scoped QA volumes; 15 containers had restarted under the inherited `unless-stopped` policy and one was already exited. All were verified against this repository's Compose-file/service/project labels. The 15 active containers were stopped while preserving prior containers/logs/volumes for diagnosis; the shared `docker-api` and `docker-postgres` services remained running. The QA-only Compose service now disables auto-restart, and the harness stops `postgres-qa` after a failed run while preserving that run's volume. Successful-run cleanup continues to remove only the current run's verified resources. No shared or unrelated database volume was removed. |
| Provider deployment | No live Cloudflare, Netlify, Vercel or customer VPS deployment was run in this pass. Cloudflare Wrangler 4.141.0 dry-run and local `workerd` database-backed protected tick/scheduled-handler smoke passed; the separate mocked Gmail HTTPS-MIME smoke also passed. The existing Bun harness checks Worker API forwarding and Cron selection. Vercel/Netlify wrapper contract tests and Cloudflare typecheck pass. Supabase Cloud database/app-role/migration-ledger/readiness/auth-throttle checks passed on the disposable project through 0074, but authenticated domain lifecycle and a live provider scheduler were not run there. Native Windows PostgreSQL is also untested. |
| Scheduler | The protected endpoint now requires a supported `NOVA_BACKGROUND_SCHEDULER` selection and rejects a mismatched built-in provider. Cloudflare has an explicit `crons=[]` profile for Supabase Cron; Supabase install/disable commands target NOVA's named job and Vault values. Still verify one active production trigger in each live provider, same-provider duplicates, missed/overlapping ticks, secret rotation, retries and run history. |
| Load and concurrency | Fresh isolated QA on 2026-09-27 applied migrations 0001–0074 and passed 53 SQL/RLS fixtures, 2,414 lifecycle assertions, specialized attendance/WFH/leave/geofence smoke and application-role preflight (`ready`) in the 100-employee burst. p95s: work-context 3,052.4 ms, task creation/self-assignment 527.2 ms, timer start 677.5 ms, timer stop 318.2 ms and assignment reads 283.6 ms. Integrity: 100 server-classified tasks, 100 assignments, 100 closed timers and no open timers. The harness removed only its run-scoped database, volume and containers. This is a one-shot burst, not sustained multi-office capacity proof. |
| Timezone and location | Fixture 0062 passed: 23-hour/25-hour office days, a stable-offset office, exact one-microsecond attendance/session closure, repeated-tick idempotency, and original-boundary closure after office transfer while records are open. Fixture 0069 checks office-local business dates for four timezones against one statement instant. API checks reject missing, low-accuracy, malformed and outside-radius location evidence without changing state. DST gap/repeated wall-time policy, overnight sessions, browser permission-denial UX and spoof-recovery paths still need deterministic tests. Browser GPS is a signal, not proof of physical presence. |
| Email and notifications | Fixture 0063 passed: duplicate staging, app-role denial of direct outbox reads, expired-lease recovery, new lease-token ownership, stale/replayed worker rejection and one-time completion. The local authenticated lifecycle simulates Gmail OAuth state/PKCE, configured-origin redirect, send-only scope, token exchange, encrypted refresh-token storage, metadata secrecy, expiry/replay rejection, missing-send-scope denial and failed reconnect preserving existing credentials. Unit tests mock Google token refresh and Gmail HTTPS send, decode the composed MIME payload, and verify sanitized API failure behavior. The HTTPS runtime advertises Gmail API + Resend and exercises Gmail setup while rejecting SMTP before persistence. No real Google consent or live SMTP/Gmail/Resend message was sent; provider outages, rate limits, actual credential rotation and end-to-end mail-sink delivery remain unverified. In-app notification persistence is independently covered. |
| New product rules and broad UI | PRD v2.02 specifies provisional WFH while work continues, the permission-controlled catalog, draft-only role starter profiles, automatic task classification, and Cloudflare request-scoped DB clients through Hyperdrive. Migrations 0071–0074 implement a workstream default plus optional per-definition class rules; task creators cannot submit a class, billable creation remains a separate role permission, and corrections are distinct linked work items classified by the selected definition rule or workstream default (never as a “billable correction”). Existing tasks/sessions do not change when policies change. Authenticated API/product rules pass and browser checks cover role editing, billing-policy setup, basic task creation and due-date editing; eligible employee assignment, correction/reviewer/handover journeys, accessibility, and responsive QA remain. Existing workflow screens are still text-heavy. |
| Recovery and upgrades | Restore/backup rehearsal, migration upgrade from the previous supported release, scheduler recovery, secret rotation and native-Windows/VPS recovery remain. |

The repeatable local command is `bun run qa:postgres`. It uses the local Docker
CLI where available and falls back to WSL Docker on Windows when that CLI is
absent. It creates a unique Compose project and private `postgres-qa` service
with no published host port, then creates a uniquely named database, runs
migrations, rollback/RLS fixtures, both authenticated smokes and
application-role preflight. On success it drops the test database, stops the
generated containers/network and removes only the PostgreSQL volume whose
Compose labels match that run. A failed test preserves the generated database
and project for diagnosis. Do not use `docker compose down -v` as QA cleanup.
