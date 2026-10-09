# NOVA runtime smoke runbook

## Latest deployment verification — 2026-10-10

`bun run qa:postgres` passed against isolated PostgreSQL 17 with 79 migrations,
rollback/RLS fixtures, specialized attendance/WFH/leave/geofence checks,
application-role preflight, and the 0072→0074 upgrade rehearsal. Its bounded
Node-pool profile also passed the 100-employee lifecycle (2,433 assertions):
work-context p95 1,084.4 ms, task creation/self-assignment 599.7 ms, timer
start 779.5 ms, timer stop 394.7 ms, and assignment reads 410.0 ms. The burst
left 100 tasks, 100 assignments, 100 closed timers and zero open timers. This
is a one-shot local PostgreSQL workload, not a hosted latency/SLA result or a
sustained soak. A request-scoped direct-PostgreSQL run passed the functional
checks; its 100-employee burst exceeded PostgreSQL's default connection limit
(`53300`). That local path bypasses Hyperdrive and must not be used as a proxy
for managed Hyperdrive pooling or as a reason to increase production pool
defaults.

A full isolated Docker profile build exposed that the production API image
did not build or include the Vite application: `.dockerignore` excludes
`dist`, and the image had copied source files instead. The Dockerfile now has a
web-build stage and copies the generated bundle plus only the two shared web
modules imported by the server. Its regression test checks that build/copy
contract. With the corrected image, the local Compose profile served
`/api/health`, `/api/ready`, the homepage, invitation/reset entry pages and the
compiled JavaScript asset with HTTP 200; readiness selected the `vps`
scheduler, and the isolated PostgreSQL ledger contained 79 migrations. The
pre-fix startup runs exposed both a connection refusal and a database startup
503. API logs identified PostgreSQL still starting up: the API health
check tested process liveness, allowing dependent services to start before
database-backed readiness. The Compose API healthcheck now uses `/api/ready`,
and the VPS worker retries transient network failures with bounded
1/2/4/8-second backoff, plus the API's specific `BACKGROUND_JOB_FAILED` 503
for a retryable tick failure. Configuration, scheduler-selection and auth
failures are not retried. A fresh clean-start run showed only successful first
ticks, readiness selected `vps`, the homepage and generated JavaScript asset
returned 200, and the database ledger contained 79 migrations. The exact
disposable Compose project, database volume and containers were removed after
the run.

The QA Supabase management token available to this workspace returned 403 for
the target project's migration-ledger endpoint, so a live read-only ledger
check was not possible in this pass. No cloud migration, scheduler change,
provider deployment, or customer database write was attempted. Netlify and
Cloudflare production builds, real Hyperdrive concurrency, provider Cron, and
the three-profile migration rehearsal remain release gates.

## Cloudflare Worker runtime — 2026-09-26

Wrangler 4.141.0 `deploy --dry-run` passed against the production Worker config
without upload (10 assets; 3,205.72 KiB / 549.89 KiB gzip). Local `wrangler dev`
started the configured Worker using a fake unreachable database target; `/` and
`/api/health` returned 200. A separate local Workerd test then used disposable
PostgreSQL 17 and the request-scoped connection path: health/readiness returned
200, an unauthorized tick returned 401, and the authorized tick returned 200.
Wrangler Local Explorer invoked the Worker's real scheduled handler; captured
Workerd logs confirmed the database-backed tick completed with HTTP 200. The
local connection does not emulate managed Hyperdrive or prove remote provider
Cron. The local-only email smoke Worker ran in workerd and
passed all five mocked Gmail HTTPS/MIME checks, including OAuth refresh,
`gmail.send` request behavior, Nodemailer stream MIME composition and message
ID handling. That email smoke contacted no Gmail endpoint, used no database,
and invoked no scheduled event. The GitHub workflow now repeats the email smoke with
Wrangler pinned to 4.141.0; hosted CI has not yet been observed. A deployed
Cloudflare Worker, real Hyperdrive connectivity and live Cron cadence remain
unverified.

## Latest local verification — 2026-09-26

`bun run qa:postgres` passed against a fresh PostgreSQL 17 database in WSL:
74 migrations through `0074_predefined_task_billing_rules.sql`, all 53
rollback/RLS fixtures, 604 authenticated lifecycle assertions, specialized
WFH/attendance/leave/geofence smoke, and application-role preflight (`ready`).
The lifecycle created/read back an Employee role from the canonical starter
profile through the authenticated role API and verified its exact grants and
operational policy. It rejected a targetless HR starter with `ROLE_INPUT_INVALID`
and verified no partial role was persisted; this is not a browser interaction
test.
The lifecycle now also verifies archived clients, client/organisation
workstreams, and groups disappear from new-work context; group/task creation
and billing-policy reads/writes under archived context fail closed without
partial writes or policy revision changes. Parent rows are locked during child
creation/configuration so a concurrent archive cannot leave hidden child records.

The latest 100-employee profile passed the full gate with 2,414 lifecycle
assertions. The latest repeat measured p95 at 2,808.3 ms for work-context
reads, 497.0 ms for task creation/self-assignment, 665.1 ms for timer start,
301.8 ms for timer stop, and 286.7 ms for assignment reads. It also exercised
Gmail OAuth locally with synthetic credentials
and token responses: public-origin redirect, S256 PKCE binding, encrypted
refresh-token storage, secret-free metadata, one-use and expired-state
rejection before token exchange, missing-send-scope rejection and failed
reconnect preserving existing credentials. No Google account or mail was used. The HTTPS-runtime contract
also confirmed the API advertises Gmail API + Resend, preserves metadata for a
saved Gmail connection, and allows creation plus least-privilege OAuth setup
through the same configured-origin flow; it rejects SMTP with 422 before
persisting credentials. Unit delivery tests mock Google's token refresh and
Gmail send endpoints and verify the Nodemailer-composed MIME payload. No real
Google consent or mail was used. Node runtimes advertise Console, SMTP, Gmail
API OAuth and Resend. The
burst verified 100 tasks with
server-checked classification provenance, 100 assignments, 100 closed timers,
and no open timers. This is a one-shot burst, not a sustained load/soak test,
and no production pool default was raised. A separate uniquely named customer-
style Compose project also applied 0074 on the same direct PostgreSQL path;
health/readiness and shared web assets returned 200, `nova_app` was neither
superuser nor BYPASSRLS, invalid and mismatched tick requests returned 401/409,
and the selected local VPS tick returned 200. Its synthetic founder first-run
UI created the workspace and revealed a verification handoff. That earlier
attempt used a malformed encryption key and did not complete the link; after
the installer/readiness fix below, the browser completed email-free verification
and password reset. The isolated project, test founder, database volume and
network were removed after the completed run.

## Public browser entry screens — 2026-09-26

A temporary Windows loopback-only server was started with
`bun --no-env-file --hot server/src/local-dev.ts` and no database URL, auth
secret, or provider credentials. In the in-app browser, the first-run setup
page rendered with the public NOVA URL, attendance-mode choices, duration and
setup-token inputs. Sign-in → forgot-password → back-to-sign-in navigation
worked; the reset screen safely rejected a missing token, and the invitation
screen safely rejected an incomplete link. The Cloudflare + Supabase deployment
choice loaded; its stage-4 check reported API health ready but database/runtime
not ready, and kept verification and Continue disabled. Browser console output
was empty. No form was submitted and no authenticated action, email, or
database transaction was attempted. The temporary server was stopped. This is
public-screen rendering/navigation evidence only—not proof that password reset,
invitation acceptance, authentication, or deployment works end to end. Visual
design, accessibility, and responsive readiness remain unassessed.

On the explicitly selected disposable Supabase Cloud project, the QA-only
`nova_app` URL authenticated through the transaction pooler; deployment
preflight returned `ready` and verified migrations 0001–0074. API
health/readiness returned 200, and an invalid internal-tick secret returned
401 without executing maintenance. Four failed Better Auth sign-ins for a
random `.invalid` identity returned `401, 401, 401, 429`, confirming the
database-backed limiter through the cloud pooler. The read-only Management
API recheck returned `ACTIVE_HEALTHY`; catalog audit found 54 RLS-enabled NOVA
tables, zero policy gaps and zero PUBLIC-executable NOVA security definers.
The business-boundary closure functions and office snapshot are present.
Bootstrap availability is false: the QA project already has one organisation
and five Better Auth users. No disposable Super Admin credentials are
configured, so authenticated mutation/lifecycle smoke was not run and existing
credentials were not reset. On 2026-09-26, the root `.env` token was checked
only against this exact project ref and returned `ACTIVE_HEALTHY`; a read-only
app-role/migration preflight returned `ready` at migration 0074. The required
scheduler enum was set to `supabase` for that preflight process only; no Cron
job was installed or invoked. A fresh read-only Cron catalog check found
`pg_cron` enabled and zero active NOVA jobs. A loopback API connected to the
same QA database returned health/readiness 200 and rejected an unauthenticated
tick with 401. No tick ran; the live scheduler remains unverified.

## Installer encryption-key regression — 2026-09-26

A fresh customer-style Compose run with email disabled exposed a real setup
failure: both installers generated a hexadecimal value for
`NOVA_SECRETS_ENCRYPTION_KEY`, while NOVA's credential encryption requires a
32-byte unpadded base64url key. That let `/api/ready` report ready even though
email-free verification handoff staging could not encrypt its token. The Bash
and PowerShell installers now generate the required 43-character base64url
value. Setup and deployment preflight validate it, and `/api/ready` fails
closed for missing or malformed keys. Unit tests cover accepting the required
format and rejecting the former hex format.

After the fix, `bun run test` passed 103 tests / 315 assertions, API and
Cloudflare typechecks passed, `node --check web/app.js` passed, and the local
Compose API returned health/readiness 200 with a valid 32-byte base64url key.
With WSL kept active, the in-app browser created a synthetic founder, requested
verification with email unavailable, revealed the one-time handoff, and
consumed its verification link. A subsequent sign-in showed the founder as
`Verified` and no pending handoff. The first browser retry had returned
`ERR_CONNECTION_REFUSED` while WSL was idle; keeping the distro active resolved
that environment issue. The separate authenticated lifecycle remains the
evidence for replay/expiry behavior.

The same browser session then exercised no-email password recovery: Forgot
password returned its neutral response, the signed-in Super Admin revealed the
one-time reset handoff, the reset page removed the token from the address bar,
and the user set a new password. The new password signed in successfully; the
old password was rejected. No email adapter was configured and no email was
sent. The reset URL was synthetic and one-time; it was consumed immediately.

NOVA assigns every task's class (`billable` or `non_billable`) from backend
policy; the employee creating the task never chooses it. Organisation
workstream tasks are automatically non-billable. Each client workstream has a
required administrative default for one-off tasks and definitions set to
inherit; an authorized `workstreams.billing_policy.manage` actor may configure
a separate rule per predefined definition and workstream. Catalog permissions
alone cannot classify definitions. `tasks.create.billable` separately
authorizes a task NOVA has already classified as billable. Missing client
default fails closed. Changes require a reason and expected revision, are
audited and apply only to future tasks. Task/work-session class, source and
revision remain immutable snapshots. Migration 0074 restores the latest
active per-definition rules and reset-to-inherit revisions from 0073 audit
evidence without rewriting existing work.

Task groups inherit parent workstream rules. A correction is a distinct linked
work item for correcting approved/completed work; it is not a billing category,
adjustment, or edit/reopen of the source. Its class comes from its selected
definition's configured rule or the workstream default, never from the fact it
is a correction or from the source task's old class. It retains
independent assignment, review, timer, due-date and audit history. Smoke covers
task/catalog/API/SQL class injection, missing-policy fail-closed, tenant
isolation, role gates, stale edits, policy-edit/task-create races, retired
per-definition API behavior, future-only snapshots, and correction
source/scope/completion/workstream/nesting/
multiple/retry rules. Missing and out-of-scope source IDs return the same 404,
preventing a caller from probing for hidden tasks.

Docker Compose passes `NOVA_DB_POOL_MAX` to API/maintenance and
`NOVA_AUTH_POOL_MAX` to the API. Pool totals must be multiplied by the number of
API/maintenance replicas and kept within the PostgreSQL/provider connection
budget.
Due-date edits compare both the local `DATE` and a monotonic revision; local API
and rollback tests cover scoped `tasks.edit`, immediate role grant/revocation,
stale/invalid/no-op edits, current-assignee notices, audit, expiry of old inbox
reminders, cancellation and pre-send rejection of a leased stale email, plus a
scheduler tick overlapping an edit lock.
`person_business_date` now uses a statement-stable instant; fixture 0069 checks
same-statement office dates across four distinct timezones.
WFH approval/cancellation and cancellation/review order checks pass, as does a
concurrent rejection/cancellation race with one final decision event. A
concurrent approval/cancellation race with live provisional attendance and a
running linked timer also passed: approval won, cancellation conflicted, one
decision event persisted, attendance was promoted and the timer remained
running until explicit cleanup. The current isolated QA project applied all
74 migrations; a separate disposable upgrade rehearsal applied 0001–0072,
seeded active and reset-to-inherit rules, applied 0073 and 0074, verified the
latest active rule and reset-to-default revision were restored from audit
evidence, and removed that database. An earlier full customer-style Compose deployment
applied 67 migrations on direct PostgreSQL. In that Compose run, API-container health/readiness and a protected local
`vps` tick returned 200; Windows loopback did not reach API routes with the
WSL-only Docker engine. No hosted provider deployment or scheduler is claimed.

An earlier implementation exposed a task-level Billable/Non-billable selector;
it has been removed. Current source and API/SQL smoke show the policy editor
only to authorized workstream managers, per-definition rules scoped to the
workstream, and the server-assigned result read-only in task context. An
authenticated local browser journey covered the admin-side default/per-
definition policy setup, content-only task definition, one-off/predefined task
creation, and display of server-derived class/provenance; the UI verification
matrix records its exact boundary. It did not cover employee-originated task
submission, correction creation, reviewer decisions or handover. Public setup
and deployment screens also render, but these checks are not accessibility,
responsive or hosted-provider proof.

The local browser also selected the Netlify + Supabase path, completed the
public-origin prerequisite, and confirmed the next step keeps migration
credentials out of browser forms and routes runtime secrets to the host's
secret store. This was a read-only checklist interaction, not a deployment.

This is the final deployment check after migrations. It uses the same API
handler and background tick for Supabase Cloud, Cloudflare, and direct
PostgreSQL; Netlify/Vercel are hosting adapters only.

## Supabase Cloud without Netlify/Vercel

1. Get the transaction-pooler URL for the exact project and set `DATABASE_URL`
   with the non-owner `nova_app.<project-ref>` role, `sslmode=require` and
   `uselibpqcompat=true`. `bun run setup:supabase` reads the exact
   transaction-pooler host from the read-only Management API endpoint
   `/v1/projects/{ref}/config/database/pooler`; it does not infer a cluster
   index from region or trust a previously saved host. The token must be able
   to read that endpoint, and an explicit `--pooler-host` must match its
   response. If the endpoint returns 403, fix the token's project access before
   running setup; it stops before any database write.
2. Set `BETTER_AUTH_URL=http://localhost:3001`, the existing Better Auth,
   bootstrap and encryption secrets, then run `bun run --cwd server dev:local`.
3. Check `GET http://localhost:3001/api/health` and verify an unauthenticated
   protected command returns `AUTHENTICATION_REQUIRED` rather than a database
   or configuration error.
4. Complete the one-time founder registration/bootstrap flow with a disposable
   test deployment or a fresh database, then verify sign-in, `/api/organisation`,
   role creation, WFH/leave approval, geofence attendance and a collaboration
   command. `scripts/runtime-specialized-smoke.ts` is the reusable disposable
   Supabase mutation sequence; it uses the disposable Super Admin credentials
   in `NOVA_SMOKE_EMAIL` and `NOVA_SMOKE_PASSWORD` when those optional env
   values are supplied. It resolves and validates the exact transaction-pooler
   host through the project-scoped Management API when no same-project host is
   configured.

Do not run the founder/bootstrap step against a customer organisation. Use a
fresh or explicitly disposable database for this step; an already-populated
deployment should proceed directly to sign-in and authenticated reads.

## Direct PostgreSQL/VPS

Use the same sequence with `MIGRATOR_DATABASE_URL` for the schema owner and
`DATABASE_URL` for `nova_app` (`NOSUPERUSER`, `NOBYPASSRLS`). Apply migrations
with `bun run migrate`, then run `bun run test:database`. Docker Compose is the
supported convenience path; a normal PostgreSQL 17 server is equivalent. For
the authenticated mutation sequence, set `NOVA_SMOKE_DATABASE_URL` to the
non-owner API URL and `NOVA_SMOKE_FIXTURE_DATABASE_URL` to a separate
migration-owner URL, then run the same `scripts/runtime-specialized-smoke.ts`.
Fixture SQL uses only the explicit owner URL; normal API requests still use the
non-owner URL and therefore exercise the application RLS boundary.

The API must never use the migration owner, PostgreSQL superuser or a
Supabase `service_role` connection for normal requests. Keep the API and
database on the same private network and put a reverse proxy in front of the
API when publishing a VPS deployment.

## Verified evidence and boundaries

The detailed 0062-era run record below is retained as history. Its earlier
0065/353-assertion snapshot is superseded by the current 0074/604-assertion
result at the top of this runbook.

An earlier pre-0073 100-employee profile passed with 2,318 lifecycle assertions;
its metrics are superseded by the current profile at the top of this runbook.
It was also a one-shot burst, not a sustained multi-office or long-soak test.

The end-to-end PostgreSQL 17 QA run on 2026-09-24 applied migrations
0001–0062 and passed all 44 rollback/RLS fixtures, including database test
fixtures `0062_timezone_boundary_microseconds.sql`,
`0063_notification_lease_token_recovery.sql` and
`0064_assignment_handover_history.sql`. It then completed the 314-assertion
authenticated lifecycle, specialized
WFH/attendance/geofence/leave smoke and strengthened application-role
preflight. The lifecycle includes founder setup, invitation/verification,
custom role/grants, password reset/session revocation, employee task
creation/self-assignment with concurrent idempotency replay/key-reuse denial,
reviewer request, live handover-accept permission revocation and regrant,
two-sided handover, A→B→A return handover with assignment history preserved,
concurrent same-recipient handovers with one success and one stable 409,
submit by the new assignee, old-assignee reuse denial, timer closure, freeze, reviewer
replacement, offboarding, handover withdrawal/decline, submit-vs-handover
race, single-winner concurrent review decisions, and cancellation during
pending review. It also completed changes-requested → resubmit → final approval,
verified immutable cycle history and checked the cycle-specific in-app notices.
Reviewer and handover request expiry was checked at one microsecond past the
deadline while the API clock was deliberately a day slow; PostgreSQL time
remained authoritative. An expired manual reset handoff was neither listed nor
revealed. Expired invitation, password-reset and email-verification tokens
were rejected; the expired verification link left the identity unverified, and
a replacement link verified successfully. The password-reset failure left the
existing credential usable. Timeline and attendance corrections also retained
six-digit PostgreSQL microseconds under deliberately skewed API clocks. Fixture
0062 verified that open attendance and work sessions retain their original
office-local business boundary after an office transfer. The specialized smoke
also rejected missing, low-accuracy, malformed and outside-geofence coordinates
without persisting an attendance-mode change. Two
overlapping selected-`vps` protected ticks both returned `200`; reviewer
reconciliation produced one state transition and one in-app notice.
The previous submit-after-handover `ASSIGNMENT_NOT_FOUND` failure is fixed.

That earlier pre-0074 preflight returned `ready`: 73 migrations/latest 0073
verified by the migration role, rate-limit table present, `nova_app` owns no
NOVA objects, cannot assume object-owner roles and has no privileged
memberships. Host-local checks in the current evidence snapshot are summarized
at the top: 101 tests/310 assertions, including Supabase pooler discovery,
Vercel Cron authentication/
translation, Netlify Cron selection/forwarding, and Cloudflare Worker API
forwarding plus selected/unselected Cron gating; API and Cloudflare typechecks,
server build, `web/app.js` syntax, read-failure/empty-state tests across the
Admin, Work and Operations UIs, and strict TypeScript checks for the
QA/preflight/runtime smoke scripts also passed. The Cloudflare Worker handler
was exercised in a Bun harness, not under Wrangler or a deployed Cloudflare
runtime. The first 0066 fixture run found and fixed an ambiguous
PL/pgSQL notification ID reference; the clean rerun passed. `bun run qa:postgres` uses the native Docker CLI or, when absent
on Windows, the repository's WSL Docker engine. It starts a unique Compose
project with a private `postgres-qa` service and no host port mapping. Success
drops the fresh generated database, removes that project's containers/network,
and removes only the PostgreSQL volume after checking its Compose project and
service labels. Failure preserves the generated project/database for
diagnosis. The shared `nova` database and volume were not used or changed.
Pre-existing QA-named databases were intentionally left untouched.

The host-local suite also rejects external-origin escape paths when building
customer and notification links. The authenticated lifecycle additionally
checks the persisted public origin in the Gmail OAuth redirect, but does not
replace live provider delivery or broad browser journey integration tests.

The first test attempt found a mistake in fixture 0063: it queried the
RLS-hidden notification outbox directly under `nova_app`. The fixture now
checks queue internals as the migration-test role and keeps worker operations
under the application role; a subsequent full run passed. This was a test-only
correction, not a relaxation of the production RLS boundary.

Supabase Cloud database/app-role/migration-ledger/readiness and database-backed
Better Auth throttling were verified on the disposable project through
migration 0074 in this pass. No full authenticated Cloud domain lifecycle,
live Cloudflare, Netlify, Vercel or VPS deployment, provider-scheduled trigger,
native-Windows PostgreSQL test, or sustained 50–100-employee soak is claimed.

A separate customer-style Docker Compose run against direct PostgreSQL in WSL
applied all 65 migrations in a uniquely named project. The app role was
non-superuser and non-BYPASSRLS. Health and readiness returned 200, and one
selected-`vps` protected tick returned 200. Exact Compose labels were verified
before the isolated stack and volume were removed. This is a local Docker/VPS-
style test, not an internet-facing VPS deployment.

Current unit tests verify the shared secret plus selected-provider check,
rejection of a mismatched provider, and fail-closed behavior when no selector
is configured. The latest isolated lifecycle also exercised a selected `vps`
tick. No live provider scheduler is claimed. A live local browser pass checked
Cloudflare+Supabase, Netlify+Supabase, Vercel+Supabase and direct PostgreSQL/VPS
paths with their scheduler choices, including Supabase Cron alternatives. The
setup screen rendered public-origin and attendance-mode inputs; sign-in and
forgot-password navigation worked; `/reset-password` rendered and removed a
synthetic token from the visible URL. A synthetic first-run form attempt through
the temporary WSL bridge returned the generic
setup error; diagnosis showed that bridge forwarded an internal Host with the
browser's configured public Origin, so NOVA correctly rejected the mismatch.
Founder registration returned 200 when the public Host/Origin pair was
preserved. A direct follow-up without the browser's session cookie returned
401. A later local browser run verified manual invitation, one-time handoff,
verification and onboarding while the admin remained signed in, and role
create/edit/reopen behavior. Full authenticated Work/HR, task, billing-policy,
due-date, accessibility and responsive journeys remain unverified. The
synthetic database and volume from the earlier setup run were removed.

For the full status and remaining per-module test matrix, see
`docs/verification-matrix.md` and `docs/qa-and-completion-plan.md`.

## Email-disabled recovery check

Deactivate the tested email connection as a Super Admin and verify that normal
sign-in, in-app notifications and the authenticated Better Auth change-password
route still work. Create an invitation or request verification/password reset;
the command must stage an encrypted one-time handoff instead of creating a
temporary password. An authorised administrator can list its metadata and
reveal the URL exactly once. Expired, revoked or already revealed handoffs must
be rejected, and the URL must not appear in logs or ordinary list responses.

For a fresh no-email deployment, complete founder registration and bootstrap,
keep the setup token only in the setup browser session, and verify that the
unverified founding Super Admin can list and reveal only their own verification
handoff. The same token must not reveal an invitation, password-reset handoff,
or another person's verification link; after verification, the normal
verified-actor gate applies.
