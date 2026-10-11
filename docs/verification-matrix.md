# NOVA verification matrix

## Live baseline and release refresh — 2026-10-11

Netlify currently publishes main `4a85727` as deploy
`6acb96b13484ca000837623c`; GitHub Verify #148 passed repository checks and
the clean PostgreSQL lifecycle. Anonymous health, database readiness, and
empty-session checks returned 200. Cloudflare's separate public candidate now
runs exact main source `6498e15e4ce0ea6628de23b33bc9ef16d9075c6c` as Ready
version `185d9929-c3ee-448f-b710-01079699d3a5`. It uses the disposable
database, restricted `nova_app`, disabled query caching, and a 20-connection
soft ceiling; it has no customer hostname or Cron. A signed-in Super Admin
loaded People/access and Organisation database-backed pages, but My Day and
Work remained in loading states.

A same-client serial sample used one excluded warm-up and ten measured
readiness requests per host; all returned 200. Cloudflare total response
p50/largest-observed was 308/316 ms, with `nova-app` handler time 40/45 ms.
Netlify measured 510/543 ms total and 163/164 ms in the handler. That paired
sample came from the earlier, unidentified candidate version and was anonymous.
The current exact-source Hyperdrive dashboard snapshot showed 11 ms query
latency, 3 ms connection latency, zero errors, 203 queries, and six open
connections with no waiting clients. Neither snapshot is a capacity test or a
current authenticated route timing.
See the [performance investigation](performance-investigation-checklist.md).

Tags `v0.1.3`, `v0.1.4`, and `v0.1.5` passed exact-tag verification and each
has a GitHub draft release. Customer updater discovery is not active until a
maintainer reviews and publishes the intended drafts.

Current Netlify function logs after deploy `6acb5d10ece4b700080a203a` show a
warm Notifications request at 1.20 seconds with no pool-acquisition wait,
Work at 5.23 seconds, Work sessions at 4.19 seconds, and session lookup at
3.29 seconds. Supabase's simultaneous connection snapshot showed 19/60
connections, one active query, and no blocked or idle-in-transaction sessions.
The query report showed a 99.99% cache hit rate; its cumulative dashboard and
scheduler traffic is not a matched endpoint profile. These observations favor
investigating inter-region and database round-trip cost, but are too small to
establish a sole cause or route percentiles. See the
[performance investigation](performance-investigation-checklist.md#live-telemetry-snapshot-after-c622961-11-october-2026).

The latest `/api/health` and `/api/ready` responses were not verified in this
environment: the browser blocked the API URL and shell DNS could not resolve
the Netlify hostname. The isolated local PostgreSQL proof was rerun on
2026-10-11; details follow below. Hosted health and readiness remain open.

Cloudflare Zero Trust setup remains declined. Cloudflare documents
`wrangler dev --remote` as uploading code to a temporary remote preview, but
does not document that the temporary route is unreachable publicly. Omitting
`--tunnel` only avoids the documented tunnel; it does not prove route privacy.
Do not run that path with production credentials or a live database until the
actual candidate route is verified private. No Worker or Hyperdrive has been
created for NOVA.

## Fresh isolated PostgreSQL proof — 2026-10-11

`bun run qa:postgres` passed against a unique WSL/Docker PostgreSQL 17
instance. It applied all 80 canonical migrations, passed the rollback/RLS
fixtures and authenticated lifecycle (623 assertions), and passed the
attendance/WFH/leave/geofence runtime smoke. The application-role preflight
confirmed that `nova_app` owns no NOVA objects, cannot assume their owner, and
has no privileged membership. The updater rehearsal upgraded a trusted
72-migration baseline through all eight pending migrations to 0080 and passed
the post-upgrade role check. A separate full dump/restore rehearsal verified
80 migration checksums, 65 table row counts, 59 RLS policies, sequence and
extension state, auth/session data, tenant isolation, encrypted credentials,
and restricted-role boundaries.

The harness used generated credentials and a run-specific Compose project,
network, database, data volume, and TLS volume. It removed only those verified
test resources after success; the shared `nova` database and volume were not
touched. This is current local PostgreSQL and customer-update-path evidence;
it does not prove a hosted cloud install or a production performance target.

## Task-catalogue permission follow-up — 2026-10-11 (`7d338af`)

Netlify published application commit `7d338af` as deploy
`6acb3f759d24190007f0d169`. It fixes the task-catalogue permission response:
the server now projects canonical grants to the stable `view`, `propose`,
`manage`, and `review` contract that both Work Setup and the task composer
consume. A signed-in Super Admin opened Work Setup and Work administration on
the published build. The reusable-definition form and its approved/suggestion
sections rendered, and the task composer exposed its enabled optional
definition selector. The disposable catalogue has no definitions yet, which
is shown as an empty state; no records were changed. Focused server tests (2),
web route tests (19), and the server TypeScript check passed. No migration was
needed. This is a narrow authorization/UI smoke, not full role or workflow QA.

Live Netlify diagnostics from 1:19–1:25 PM IST show continuing high latency.
During one Work Setup load at 1:23 PM, `api.notifications` took 3,416 ms,
`api.task-catalog` 3,764 ms, and `api.work-context` 4,611 ms in the handler;
entry-module load was only 3 ms. Those requests counted roughly 1.0–1.1 s in
NOVA pool acquisition and 1.0–2.2 s in NOVA queries, plus about 1.0 s in auth
pool acquisition and 0.3 s in auth queries. Earlier 1:19–1:20 observations
included `api.task-catalog` at 4,766 ms, `api.work-context` at 2,677 ms,
`api.notifications` at 1,397–4,377 ms, and `api.me` at 1,620–4,447 ms.
Acquisition/query totals may overlap and must not be added to infer elapsed
time. These are live samples, not route distributions or a before/after
result. The 3 ms module load rules out import time as the main cause for that
page sample; database round trips and unmeasured handler/runtime time remain
to be profiled.

The Netlify project settings show Functions running in `CMH (Ohio, US East)`;
the selected Supabase primary database is in Seoul (`ap-northeast-2`). Netlify
shows region customization as locked behind an upgrade for this project. The
region mismatch is a plausible contributor, not a proven sole cause. No
provider, region, or database setting was changed. See the current Netlify
[function region guidance](https://docs.netlify.com/build/functions/configuration/)
and [Supabase region guidance](https://supabase.com/docs/guides/platform/regions).

The later runtime deploy `68d2631` is published as Netlify deploy
`6acb52834f8e250008b6e15e`; GitHub runs [#132](https://github.com/amxcodes/novaprime/actions/runs/38127425505)
and [#133](https://github.com/amxcodes/novaprime/actions/runs/38127662627)
passed both required jobs. Small logs after that deploy show warm Work around
2.23 seconds, Notifications and Work-session reads around 4.15–4.24 seconds
with roughly 3 seconds of aggregate pool-acquisition time, and a later warm
session read at 1.18 seconds. This is too little evidence for percentiles or
to establish a sole cause. The user declined Cloudflare Zero Trust after its
checkout required payment/card details. On 11 October, a separate public
candidate Worker was deployed with fresh secrets and only a disposable
database; Hyperdrive readiness and Better Auth session probes passed. That
unprotected candidate is not suitable for production data or as a production
move proof. See the current candidate and comparative latency results in the
[performance investigation](performance-investigation-checklist.md).

Earlier fixes in `c025824`, `2099ad0`, and `fd1e520` preserve non-default
forwarded ports, load the Work review actions, and explain the no-office
attendance condition.

The disposable Supabase project `owfgvojdaxafayutbcuf` has checksummed
migration `0080`, RLS enabled on the lease table, no direct `nova_app` table
privileges, and execute-only lease RPC access. A fresh read-only check found
one active `nova-background-tick` and a successful run at 06:35 UTC on 11
October. The matching `net._http_response` row returned HTTP 200 with no
error. A later run at 07:00 UTC also returned HTTP 200, before the `522d049`
application deployment. Public `/api/health` and `/api/ready` each returned
HTTP 200 in one probe (1.37 s and 1.62 s inclusive). These checks verify the
selected project and named job, not every external trigger or authenticated
product-route performance.

WSL/Docker QA applied all 80 migrations to isolated PostgreSQL 17, passed the
SQL/RLS fixtures and least-privilege app-role checks, exercised the protected
maintenance tick, and restored a dump with table counts, RLS policies,
sequence state, auth/session rows, encrypted secrets, and app-role boundaries
compared. A local 200-employee × 10-task burst at concurrency 25 passed; its
in-process p50/p95/p99 were work-context 151/225/247 ms, create/self-assign
85/121/135 ms, timer start 102/150/169 ms, timer stop 56/75/84 ms, and
assignment reads 372/633/648 ms. This is not an HTTP/network measurement,
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
`canRenderRequestReviewActions` was referenced but not imported. Work is now
split into My work, Tasks, Reviews, Requests, Reviewer management, and Work
context. Area availability is resolved from the server-issued read plan and
create capability; the URL only selects among areas the plan already permits.
Each area limits its request dispatch and lazy UI imports to its own read plan.
The live Super Admin smoke showed the expected authorized empty states for
Tasks, Reviews, Requests, Reviewer management, and Work context, and the
existing My work setup state. Its search copy confirms queries run on NOVA and
return only access-scoped context. This smoke did not submit or change records.
The My work screen shows
“Attendance setup required” with guidance to configure an office and assignment;
the generic attendance error and retry action are absent. This is the correct
setup state for the disposable organisation, which has zero offices and
departments, as confirmed in Organisation settings. People/access also loaded
with the protected Super Admin role and scoped people directory. No records
were changed.

Customer release discovery is still unavailable because tags `v0.1.3` and
`v0.1.4` point to verified draft releases, not published releases. The
200-employee local burst and Docker restore do not prove fresh Netlify+Supabase
or Cloudflare+Supabase customer installs. The live Cloudflare Worker/Hyperdrive
candidate now proves disposable database connectivity, but no authenticated
business workflow or same-database route move is verified. At 00:20 IST on
11 October, the rolling Netlify Function Metrics window showed 599 total
invocations and zero function errors. The `nova` function accounted for 647
calls: average 3,241 ms, p50 2,926 ms, p95 5,633 ms, and p99 5,666 ms. Only
about six minutes of this mixed-route window followed `dd4f891`; API/page speed
remains open and this is not a before/after result. The recorded Work batch and
work-context reads took 5.79 s and 5.70 s respectively on `dd4f891`. Later
`68d2631` samples are recorded above but are not yet matched distributions or
browser waterfalls.
Public readiness and protected runtime/database identity for the exact
current build have not been rechecked, and Supabase job history has not been
re-read since the latest deploy. Detailed local commands and evidence remain in
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

The 11 October 2026 live profiler check narrows the cause. In Supabase Query
Performance, the authenticated-actor resolver ran 3,017 times in the selected
60-minute window: 5.92 seconds total database execution, 2 ms mean, and 132 ms
maximum. The work-context client query ran 106 times in that window: 0.06
seconds total, 1 ms mean, and 2 ms maximum. The 1:23 PM Netlify diagnostics for
those Work Setup requests still showed 3.4–4.6 seconds per handler, including
1.0–2.2 seconds summed client-observed NOVA query round trips and about 1.3
seconds in auth pool acquisition/query measurements; module loading was 3 ms.
The client-observed query duration includes network round trips, unlike
`pg_stat_statements` server execution. Taken together, this points to database
connection acquisition and network round trips as the dominant measured cost,
rather than slow SQL or cold module loading. The Netlify–Seoul region mismatch
is a likely contributor, but the aggregate windows are not tied to the same
request IDs and do not isolate exact per-request network latency.

A second live sample came from read-only navigation through People, Work, My
Day, and Operations at 1:38 PM IST. The initial `api.me`, `api.work-sessions`,
and `api.notifications` handlers took 4.4–4.5 seconds; `auth.get-session` took
3.2 seconds. Their pool acquisitions summed to about 3.0 seconds per pool under
that cold/bursty load. Subsequent warm requests ranged from 1.3 to 2.8 seconds;
the combined Work read took 5.4 seconds in the handler (7.0 seconds total) and
made 23 database round trips. Module loading remained 4–12 ms. This is a small
live sample, not a percentile distribution. The attendance `409` was the
expected no-active-office setup state and is separate from the latency issue.
The adjacent Supabase live connection snapshot showed 19 of 60 connections, no
active queries, no idle-in-transaction sessions, and no blocked queries. This
rules out obvious database connection saturation at that instant, not short
peaks outside the snapshot.

The current Netlify region screen requires an upgrade to change the site's
function region. Netlify's [function region documentation](https://docs.netlify.com/build/functions/configuration/)
limits region customization to Pro and Enterprise, includes Tokyo (`nrt`),
applies the selection to every function on the site, and requires a redeploy.
For a customer willing to use that plan, an `nrt` redeploy is the smallest
same-stack comparison for this Seoul database; it still needs a before/after
measurement and is not enabled here.

The other useful comparison is the same authenticated reads against the same
Supabase database through a protected Cloudflare Worker + Hyperdrive candidate.
Cloudflare's [Hyperdrive guide](https://developers.cloudflare.com/hyperdrive/get-started/)
describes pooled connections avoiding seven setup round trips, and its
[placement guide](https://developers.cloudflare.com/workers/configuration/placement/)
recommends placement near the database when a request makes multiple sequential
queries. For this Seoul-only experiment, `aws:ap-northeast-2` is the candidate
placement hint; it must not become a hardcoded global default for customer
projects. Keep the API Worker-first and static assets edge-served. Protect the
candidate before binding database credentials: Cloudflare [version URLs](https://developers.cloudflare.com/workers/versions-and-deployments/version-urls/)
are public when enabled, and enabling `workers_dev` enables version URLs by
default. The [Free Workers plan](https://developers.cloudflare.com/hyperdrive/platform/pricing/)
currently limits Hyperdrive to 100,000 SQL statements per day and about 20
origin connections, and [Workers limits](https://developers.cloudflare.com/workers/platform/limits/)
include 100,000 requests per day and 10 ms CPU per invocation. A 100-employee
customer profile therefore still needs an observed statement, request,
connection, and CPU budget before Cloudflare Free can be called suitable. The
production origin, database, and scheduler remain unchanged pending a protected,
matched test.

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
| TypeScript/API and adapters | Existing API and adapter suites passed in CI as recorded above. On 2026-10-11, the Cloudflare TypeScript check passed, Wrangler 4.141.0 bundled the candidate config in dry-run mode, and `bun test cloudflare/worker.test.ts server/src/db.test.ts` passed 10 tests and 36 assertions in the authorized run. The default Windows sandbox could not traverse the installed `node_modules` junction, so the focused harness needed that authorized environment. The remote candidate has exact source identity and signed-in admin-page reads, while My Day and Work remain stuck loading. | PARTIAL: adapter contract tests and limited remote Hyperdrive reads pass; resolve the stalled routes and finish authenticated workflow and capacity tests |
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
| Deployment-guide provider handoff | `deployment-guide.js` covers all five runtime shapes and every allowed scheduler; tests verify provider files/actions, Supabase Cron retirement, readiness gating, and Cloudflare Hyperdrive Direct-endpoint versus Node transaction-pooler setup. The UI gives a compact source→runtime↔database map and keeps the six-part settings map collapsed by default; it distinguishes code deploys, schema, runtime secrets, domain/auth/email and the single scheduler. Vercel registers Cron only for Production `vercel`; Netlify's build plugin selects its scheduled function only for `netlify`, API-only for `supabase`, and no schedule for previews/branch builds. | PASS for 118 tests / 512 assertions, API/Cloudflare/operator typechecks, JavaScript syntax checks, plugin-selection contract, all-pairing rendered smoke, and a local browser walkthrough of all eight supported host/scheduler combinations. The Supabase job-write command stays gated until health/readiness and the selected scheduler match. The browser check verified the shown provider action and confirmation location, but did not log in to or change a provider account. Local Workerd/PostgreSQL tick and scheduled-handler checks pass. No hosted provider mutation, live schedule change, responsive/accessibility review, or deployment-manager apply was performed by this walkthrough; the separate disposable Hyperdrive connectivity check is documented above. See `docs/visual-deployment-task.md` |
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
| Actual deployed baseline | **Netlify currently publishes main `4a85727` as deploy `6acb96b13484ca000837623c`; Verify #148 passed.** Fresh anonymous checks on that deployment returned 200 for health, database readiness (`scheduler=supabase`), and session lookup (`null` without a cookie). The disposable Supabase project remains checksum-verified through `0080`. | Collect matched authenticated browser waterfalls and repeated route distributions, a fresh scheduler observation, and hosted first-install evidence. The present checks do not verify signed-in routes. |
| Customer releases and updates | **Updater code and local migration/restore evidence exist; verified release drafts v0.1.3, v0.1.4, and v0.1.5 are present.** `v0.1.3` at `a957cd4` is the updater-bearing baseline with 80 migration hashes. `v0.1.4` at `50b4b6e` has no SQL changes and requires a `0.1.3` starting version; `v0.1.5` at `4a85727` also has no SQL changes. All three exact-tag verification workflows passed, and all releases remain invisible to updater discovery until reviewed and published. | Rehearse update from `v0.1.3` through `v0.1.4` and `v0.1.5`, including clean-clone adoption, fork conflict handling, wrong-project refusal, failed migration/retry, declined push, and host-build failure after schema migration; then review and publish the intended drafts. |
| Advertised first installs | **Local Docker/PostgreSQL lifecycle and archive restore pass in prior evidence; hosted first installs remain unproven.** The local PostgreSQL 17 install applied all 80 migrations, passed protected maintenance and authenticated workflow suites, and restored counts, RLS, sequence, auth/session, encryption, and role boundaries. The published Netlify + Supabase site and Cloudflare candidate are test infrastructure, not clean-customer installs. Cloudflare now has a disposable Hyperdrive and separate public candidate Worker; no customer provisioning flow was exercised. | Complete clean, isolated Netlify + Supabase and Cloudflare + Supabase first installs. Prove internet-facing Docker only after public exposure, firewall, and TLS checks are ready. |
| Same-database runtime move | **Cloudflare Hyperdrive and two signed-in database-backed admin pages are proven on an isolated disposable target; a runtime move is not.** The current public candidate is Ready at exact main SHA `6498e15e4ce0ea6628de23b33bc9ef16d9075c6c` (version `185d9929-c3ee-448f-b710-01079699d3a5`). A Super Admin loaded People/access and Organisation; no business records were changed. The last-24-hour Hyperdrive snapshot showed 203 queries, 11 ms query latency, 3 ms connection latency, zero errors, six open connections, zero waiting clients, and a 20-connection ceiling. | My Day and Work stayed in loading states, so authenticated business workflows are not verified. Cloudflare Issue detection is disabled and offers no exception trace for the stalled routes. The Worker is public and must stay on disposable data; it has no customer hostname or Cron, and no traffic was moved. Earlier anonymous readiness timings are from an unidentified previous candidate version and do not measure the current deployment. Diagnose the stalled routes, repeat authenticated read-only checks, then implement and rehearse journaled promotion and rollback before calling a runtime move complete. Keep this separate from any database migration. |
| Scheduler ownership | **The selected Supabase scheduler and lease-backed run succeeded before the latest application deploy.** One active named Cron row was observed; its 07:00 UTC run on 11 October succeeded after migration `0080` and before `522d049`, and the matching Net HTTP callback returned 200 with no error. The `0080` migration tests overlap, expiration, renewal, stale-owner fencing and execute-only app-role checks. | Record a fresh tick after the currently deployed application revision. Extend inventory to duplicate triggers outside this project and exercise missed runs, retries, secret rotation and recovery on each live supported profile. The current inventory cannot prove every trigger account-wide. |
| Database moves | **Separately gated by design; no transfer was attempted.** Runtime plans preserve database identity. | Treat database copy/cutover as its own future project with write freeze/drain, verified backup/restore, object/data/sequence/RLS/auth comparison and rehearsed recovery. Payroll execution remains future work; retain its schema/permission base. |
| User-facing quality | **The signed-in Super Admin Work experience is now split into six areas:** My work, Tasks, Reviews, Requests, Reviewer management, and Work context; live smoke rendered their empty/setup states. Existing attendance setup guidance remains. No records were changed. Restricted-role journeys, phone/tablet layouts, keyboard and screen-reader review remain open. | Complete representative employee, reviewer, and restricted-role journeys plus narrow/tablet, keyboard, and screen-reader review. Payroll execution remains future implementation; keep only its current permission/schema foundation. |
| Speed and capacity | **Local 200×10 PostgreSQL bursts pass; hosted latency and capacity remain open.** Prior local p95s and pool experiments are detailed in [`runtime-smoke.md`](runtime-smoke.md). An earlier same-client diagnostic used one warm-up, then ten serial `/api/ready` requests per host; all returned 200. Cloudflare p50/largest-observed total latency was 308/316 ms and handler time 40/45 ms; Netlify was 510/543 ms and 163/164 ms. Those timings came from an unidentified earlier Cloudflare candidate version and are not a controlled same-build comparison. The current exact-source candidate dashboard snapshot shows 11 ms Hyperdrive query latency, 3 ms connection latency, 0 Hyperdrive errors, and 16.05 ms median Worker CPU, but its My Day and Work screens remained loading. These aggregate observations are not route distributions or capacity evidence. | Resolve the stalled signed-in routes, capture authenticated browser waterfalls and repeated route distributions on both current builds, then run sustained 100/200-employee hosted capacity tests and record database CPU/connection headroom. If Netlify's account moves to Pro/Enterprise, separately compare a Tokyo (`nrt`) function deployment. Keep the speed gate open until controlled results exist. |

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
