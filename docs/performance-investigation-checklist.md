# NOVA API and page performance investigation

Date: 2026-10-11

## Latest latency work and provider constraints — 11 October 2026

The current source now sends `BEGIN` and the transaction-local RLS identity in
one PostgreSQL request for every `withDatabaseRequest` transaction. Both IDs
are validated as UUIDs before they are interpolated; transaction scope and
policy checks are unchanged. This removes one network round trip per scoped
command. Verification passed the complete 575-test suite, server/operator and
Cloudflare TypeScript checks, plus the isolated PostgreSQL 17 lifecycle,
restore, and 0072→0080 updater rehearsals.

The post-change local workload used 100 employees, 10 tasks each and at most
25 concurrent requests. The five wave p95s were 289.5 ms for work context,
182.7 ms for task creation/self-assignment, 210.0 ms for timer start, 310.3 ms
for timer stop, and 64.6 ms for assignment reads. All waves had zero database
diagnostic failures; the complete lifecycle passed 2,433 assertions. This is
a local PostgreSQL burst, not a controlled before/after comparison, a hosted
latency result, or a sustained capacity guarantee.

Netlify's Functions → Region settings page confirms the deployed region is
`CMH (Ohio, US East)` and shows “Upgrade to customize region.” Netlify's
official configuration guide limits custom regions to Pro and Enterprise;
its self-serve Asia Pacific options include `nrt` (Tokyo). A closer Netlify
region is therefore a paid-plan experiment, not a free setting we can apply
in code ([Netlify Functions configuration](https://docs.netlify.com/build/functions/configuration/)).
The user reports Cloudflare Zero Trust onboarding requires payment/card details
and declined that setup. No Cloudflare application, policy, Worker, Hyperdrive,
or production route was created. Although `wrangler dev --remote` serves local
requests while executing remotely, Cloudflare does not document that its
temporary remote environment has no public route. Omitting `--tunnel` is not
proof of privacy. Do not connect a production database or credentials until the
candidate route and access boundary are independently verified; otherwise keep
the Hyperdrive comparison unrun.

Netlify published this runtime change as deploy
`6acb52834f8e250008b6e15e` (`68d2631`) in 29 seconds. Its first live logs at
2:41 PM IST show two warm `POST /api/work` requests at 2.23 seconds with 17
queries and about 1 ms summed pool-acquisition time. At 2:41:34 PM,
`GET /api/notifications` took 4.15 seconds and `GET /api/work-sessions` took
4.24 seconds; each recorded about 3.0–3.1 seconds of summed pool-acquisition
time across five or six acquisitions. A later warm work-session read took
1.18 seconds with no acquisition wait. The app's API diagnostics show mostly
sub-190 ms individual query maxima for these examples. These are a handful of
live observations, not matched distributions or proof of a broad speedup.
They confirm the one-round-trip change is deployed, but cold-instance
connection acquisition and warm multi-query request latency still need work.
The app currently renders the Work screen and its empty/setup states, but an
authenticated browser request waterfall is still not recorded.

The `0.1.4` candidate adds aggregate pool-state counters to slow-request logs:
whether an idle client was available, whether the pool had room to open a
client, whether it was already at capacity, and the maximum waiting count seen
at acquisition start. These are snapshots of the process-local `pg.Pool`, not
proof of a new TCP/TLS connection or the database proxy's borrow wait. After
deployment, use them to distinguish likely local-pool saturation from
connection creation, then correlate with warm/cold samples and provider-side
metrics before changing pool limits or hosting.

## Current live telemetry after `c622961` (11 October 2026)

Netlify's authenticated dashboard now confirms `c622961` is published as
deploy `6acb5d10ece4b700080a203a`. The production function remains in
`CMH (Ohio, US East)`; Supabase identifies the selected database as Seoul.
The current function logs show `GET /api/auth/get-session` at 3.29 seconds
inside the handler, `/api/me` at 3.52 seconds, a warm `/api/notifications`
request at 1.20 seconds, `/api/work-sessions` at 4.19 seconds, and a Work read
at 5.23 seconds. The Work log counted 20 NOVA queries, with the largest
individual query at 192 ms; its recorded work-read spans overlap and are not
additive. Module loading was 4–13 ms in these examples.

Pool diagnostics reported no acquisition at pool capacity. The Work request's
largest observed waiter count was two; the warm Notifications sample had zero
pool-acquisition time but still recorded 863 ms across five NOVA query
round-trips and 330 ms across two auth queries. Summed query and acquisition
times can overlap, so they must not be added to estimate elapsed time. These
samples point toward network/round-trip cost and some cold connection setup;
they do not prove a single cause or give route percentiles.

At the same time, Supabase's live connection view showed 19 of 60 connections,
one active query, zero blocked queries, and zero idle-in-transaction sessions.
Its query-performance report showed a 99.99% cache hit rate and 3.3 average
rows per call. That report is based on accumulated `pg_stat_statements` data
and includes dashboard/catalog and scheduler SQL, so it is not a matched
profile of the logged NOVA HTTP requests. It does not show evidence of current
connection exhaustion or a cache miss problem, but it cannot exclude brief
resource pressure outside the snapshot.

The next speed comparison should capture route-specific distributions with
the same authenticated read workload against the current Netlify region and a
verified isolated runtime closer to Seoul. Netlify shows custom region settings
locked behind an upgrade; the code cannot move its function region. Supabase
Edge Functions remain a candidate only after a NOVA runtime adapter and
same-origin auth routing are tested. No provider, database, pool, or scheduler
configuration was changed during this read-only inspection.

This checklist separates browser time, Netlify execution, database connection
wait, PostgreSQL round trips, and query execution. It records evidence before
changing runtime or database architecture. The production database is in Seoul
(`ap-northeast-2`); the Netlify function currently runs in Ohio (`cmh`).

## Query-path fix and current deployment — 11 October 2026

Netlify has published `a4e64ea` (`perf: avoid correction task scans`) to
Production as deploy `6acb4e021787e000087b6622`; the build took 29 seconds.
GitHub Actions run [#130](https://github.com/amxcodes/novaprime/actions/runs/38126275344)
passed both `checks` and `postgres`. The live function log now provides
post-deploy route samples, but they do not yet show that the whole product is
fast.

A controlled local PostgreSQL 17 regression test found and fixed a specific
slow read: the employee assignment and Admin task queries self-joined the
tenant's visible `tasks` table for correction-source details. PostgreSQL chose
to scan all 1,032 visible tasks once per assignment, even when no correction
source was selected. The queries now use a correlated lateral lookup by the
source task's primary key. This keeps the existing row-level security and the
separate permission check that decides whether correction details may be shown.

With 100 synthetic employees, 10 tasks each, 25 concurrent requests and the
default application/auth pools (10/5), the local assignment-read p95 fell from
1,175 ms to 58 ms. The matching `EXPLAIN ANALYZE` fell from 204 ms to 3.2 ms;
the old plan's repeated full task scan disappeared. The updated run passed
2,433 lifecycle assertions, the 80-migration install, RLS and workflow checks,
the 0072-to-current updater rehearsal, and PostgreSQL dump/restore verification.
The run used only a disposable local database and removed its containers,
volumes, network, and random credentials afterward. This is a reproducible
query regression result, not a Netlify/Cloudflare timing or capacity guarantee.

Netlify's project dashboard confirms that the production Function runs in
`CMH (Ohio, US)`, while NOVA's Supabase database is in Seoul (`ap-northeast-2`).
Post-deploy logs from 14:21–14:25 IST show the handler and database costs
remain high: `GET api.work-context` took 5,568 ms inside NOVA (7,149 ms total
Function duration), with 14 database queries and 2,766 ms summed query time;
`POST api.work` took 3,364 ms inside NOVA with 20 queries; and
`GET api.work-sessions` took 4,386 ms inside NOVA (6,014 ms total). Several
other requests took 1.3–1.7 seconds warm. Slow calls also show roughly 1–3.3
seconds of accumulated pool-acquisition time across 3–6 acquisitions in each
pool. These subtotals overlap and are not elapsed time to add. The first
post-deploy session read shows only about 4 ms of entry-module load, so cold
module startup does not explain these samples. The geographic mismatch and
database round-trip/pool costs are now the leading measured causes; Netlify
platform overhead adds a smaller but visible amount on some calls. A matched
regional runtime test is still required before claiming which change will
improve employee experience or by how much.

A pool-size comparison before this query fix also showed why simply raising
the default is unsafe. With 10 connections, assignment-read request p95 was
1,175 ms, NOVA acquisition p95 was 827 ms, and NOVA query-total p95 was 452 ms.
At 25 connections, those figures were 1,284 ms, 1 ms, and 1,266 ms. The larger
pool removed queueing but drove much more work into the small local database;
it improved request p95 by only about 9% while making p50 slower. After the
query fix, the default pool measured 58 ms request p95, 27 ms acquisition p95,
and 22 ms query-total p95. Pool defaults stay unchanged until the hosted
request mix and the database's shared connection budget justify a different
value.

The signed-in Cloudflare account has no Worker project or Hyperdrive binding
for NOVA. Zero Trust setup led to a checkout/card requirement, so the user
declined it; no Access application or policy was created. No Worker, domain,
or scheduler was created. Cloudflare documents `workers.dev` preview URLs as
public by default, so do not put production database credentials on an
unrestricted preview. `wrangler dev --remote` serves requests locally while
running the Worker in a temporary Cloudflare environment, but Cloudflare does
not guarantee in its docs that the temporary environment has no public route.
Omitting `--tunnel` is not proof of isolation. Do not connect production
credentials or a live database until a candidate route can be verified
private; otherwise leave the remote Hyperdrive comparison unrun. The
production Netlify route, Supabase database, and Supabase Cron remain as they
were.

## Earlier live and code-level evidence — 11 October 2026

Netlify published `dd4f891` as deploy `6acb2050f6bb2a0008aac061` at 11:06
IST. A signed-in Work page refresh rendered. At 11:08 IST the batched
`POST /api/work` returned HTTP 200 in 5,792 ms; its nine internal reads each
took 4,394–5,760 ms. That request recorded 50 NOVA query round trips and 14
pool acquisitions (8,648 ms and 9,178 ms summed across concurrent reads),
with no diagnostic DB failures. The separate `/api/work-context` read returned
200 in 5,702 ms with 14 NOVA queries and a 533 ms maximum query. These sums
overlap across concurrent operations and must not be added to infer elapsed
time. The first production sample shows that Work remains slow; a matched
before/after comparison is still needed to determine the batch's effect.

The protected internal background tick returned HTTP 200 at 11:10 IST in
2,929 ms (11 NOVA queries); the preceding five-minute tick was 2,943 ms.
These scheduled calls contribute to the mixed function metrics and should be
reported separately from interactive page/API traffic. They do not explain
the 5.7–5.8 second Work reads, which have their own route diagnostics.

The 24-hour Function Metrics window through 11:12 IST showed 647 `nova`
invocations, zero errors, average duration 3,241 ms, p50 2,926 ms, p95
5,633 ms, and p99 5,666 ms. Only roughly six minutes of that window followed
the new deploy, so it is not a before/after estimate. A useful comparison
still needs enough route-specific warm samples on this deployment and a
signed-in browser waterfall. The 200-employee local PostgreSQL run on 11
October passed at concurrency 25; its results and limitations are recorded in
`docs/runtime-smoke.md`.

A later authenticated Tasks-page sample at 12:17 IST returned HTTP 200 for
`POST /api/work` in 4,829 ms and `GET /api/tasks` in 4,506 ms inside NOVA
(6,073 ms total Netlify duration for the latter invocation). The `api.tasks`
diagnostic counted six NOVA acquisitions and nine query round trips
(3,062 ms and 1,736 ms summed), plus five auth acquisitions and eight auth
query round trips (3,037 ms and 2,444 ms summed). Query maxima were 349 ms
and 540 ms respectively. Acquisition and query subtotals overlap and are not
elapsed time; these counters cannot separate database execution from network
round trips. The invocation's extra ~1.57 seconds outside the NOVA handler
also shows that platform overhead matters on this sample. Source inspection
found that Work did not consume the `/api/tasks` full-roster response at all;
the rendered task list uses the separately permission-filtered,
server-paginated `/api/work/tasks/visible` endpoint. A Work-only removal of
that redundant request was subsequently deployed in `522d049`. The `/api/tasks`
endpoint remains in place for Admin and Operations.

At 12:30 IST, a read-only Supabase query confirmed the single
`nova-background-tick` job is active on `*/5 * * * *`; its latest recorded run
started at 07:00:00.066Z and finished successfully at 07:00:00.085Z. The
latest `net._http_response` row was recorded at 07:00:00.086Z with HTTP 200.
This verifies scheduler ownership and delivery at that point in time; it does
not prove uninterrupted month-long scheduling.

The Work page now sends up to nine allow-listed, permission-selected reads in
one bounded `POST /api/work/page-read`. The server resolves the actor once for
that explicit batch, dispatches only the existing read handlers, and preserves
each read's independent error result. Individual handlers remain responsible
for authorization and scope; the batch rejects writes, unknown paths, and
unexpected query parameters. This reduces browser-to-function request fan-out
for Work but does not reduce SQL round trips inside a handler. Code and tests
are on `main` (`33d1b01` plus test correction `dd4f891`). Local full tests
passed 572/572. GitHub Actions run [#113](https://github.com/amxcodes/novaprime/actions/runs/38115319334)
passed both `checks` and `postgres` for `dd4f891`. A matched hosted
before/after comparison is still open. The post-deploy sample shows that
Work's handler latency remains high, but is insufficient to determine whether
browser-to-function batching improved it relative to baseline.

## Latest authenticated production probe — 11 October 2026, 12:50 PM IST

The current Netlify production deployment is `195815d` (deploy
`6acb37e6160bd000082380bf`); the app code includes the Work Tasks request
removal from `522d049`. A signed-in Super Admin opened Work Tasks and My Day.
Both rendered their authorized empty/setup states without changing records.
This confirms the pages render after deployment but does not provide a browser
network waterfall or measure navigation-to-interactive time.

Netlify's live function log recorded `GET auth.get-session` at 12:47:36 PM IST:
HTTP 200, 3,161 ms handler, four NOVA pool acquisitions totaling 3,097 ms,
and four NOVA queries totaling 685 ms; it also recorded three auth pool
acquisitions totaling 3,006 ms and six auth queries totaling 2,036 ms. At
12:49:59 PM IST it recorded `GET api.notifications`: HTTP 200, 4,316 ms
handler, six NOVA acquisitions totaling 3,037 ms across nine queries totaling
1,491 ms, plus five auth acquisitions totaling 3,052 ms across eight queries
totaling 2,471 ms. The query/acquisition subtotals overlap across concurrent
operations and cannot be added to infer elapsed time. These two samples show
that successful API requests remain slow; they are single observations, and
neither identifies a matched before/after improvement.

## Authenticated route sample — 11 October 2026, 12:58–12:59 PM IST

The same signed-in Super Admin session then opened Work, My Day, People,
Organisation settings, and People and access. Those pages eventually rendered
their expected authorized content/setup states; no 5xx was observed and no
records were changed. Attendance returned HTTP 409 because this disposable
organisation has no active office assignment, and the page rendered the
matching “Attendance setup needed” state. This is an expected business-state
response, not a server failure. The Admin routes also loaded the organisation
and protected-role surfaces, including the immutable Super Admin role.

Netlify diagnostics recorded the following route-group timings:

- `api.people`: 1,437 ms (HTTP 200); organisation and department reads were
  1,487–1,500 ms, and a warm Work read was 1,349 ms.
- Work's initial page read took 5,434 ms (HTTP 200). Its measured assignment,
  timeline, and attendance reads each took about 4.4–5.4 seconds. The Tasks
  page read took 4,756 ms, with the visible-task read at 3,454 ms and catalog
  read at 4,748 ms. A later Work request completed in 1,349 ms.
- Leave and availability reads each took 4,711–4,727 ms; office reads ranged
  from 3,441–3,551 ms. A background tick also appeared in this log window and
  is excluded from user-page performance conclusions.
- Warm notifications reads varied from 1,374 to 3,315 ms; another sample was
  4,491 ms. This variation rules out treating a single fast warm sample as a
  stable result.

The slow requests generally recorded roughly 3.0 seconds summed in both NOVA
and auth pool acquisition, while some warm requests recorded zero acquisition
wait. Even those warm requests commonly spent about 1.0–1.2 seconds in NOVA
query round trips. The Work page sample recorded 3.95 seconds in NOVA query
time over 23 queries, with a 205 ms maximum single query. These subtotals
overlap across concurrent operations. They point to connection setup/wait and
many database round trips as material costs; they do not establish that one
slow SQL statement or Netlify cold start is the sole cause. The logs contain
no browser waterfall and are single-session samples, so they cannot be used as
p50/p95 or as proof that Cloudflare will be faster.

The signed-in Cloudflare account has no NOVA Worker or Hyperdrive configuration
and no Access policy. Keep the existing Supabase database, Supabase Cron, and
production origin fixed while testing through local Wrangler remote
development. Begin with bounded read-only requests and compare repeated
cold/warm distributions; do not enable a public preview or consider traffic
promotion from this test alone.

The Work Tasks UI rendered, but this browser inspection did not expose a
network trace. Confirm that Work Tasks omits `/api/tasks` and collect its
`/api/work` and `/api/work-context` timings in the browser Network panel before
calling that request removal a measured speed improvement.

## Earlier live snapshot — 10 October 2026

The Netlify Function Metrics dashboard showed **346 invocations and no
errors** in its latest 24-hour window. The `nova` function accounted for 343
invocations: average 2,651 ms, p50 1,864 ms, p95 4,677 ms, and p99 4,804 ms.
These are mixed-route function invocation durations, not a per-API or page-load
percentile. The successful responses therefore do not mean the experience is
fast. Five public samples each of `/api/health` and `/api/ready` returned 200;
the observed medians were 864 ms and 1,026 ms, with maxima of 1,403 ms and
2,019 ms. These endpoints include platform and network time but do little
application work.

The Supabase Query Performance view showed a 99.99% cache-hit rate and 32
statements in its “slow queries” list. In the inspected NOVA statements,
`net.http_post` had a 51 ms maximum, the attendance business-boundary function
189 ms, and the work-boundary function 105 ms. The query counters are
`pg_stat_statements` aggregates, not a matching 24-hour sample, and do not
identify the database execution time for a particular slow API request. They
do not show one multi-second SQL statement explaining the Netlify p95. The
known Netlify Ohio to Supabase Seoul distance plus request fan-out/pool
acquisition remains a plausible cause, but current measurements do not prove
that moving the runtime alone will meet a target.

## Latest local capacity run — 10 October 2026

The final isolated PostgreSQL 17 QA ran 200 synthetic employees with 10 tasks
each and at most 25 concurrent requests. Per-wave local in-process p50/p95/p99
were: work context 298/418/455 ms; task create/self-assign 171/241/299 ms;
timer start 95/138/187 ms; timer stop 54/77/99 ms; assignment reads
365/537/588 ms. This is a useful write-burst and data-integrity check, not an
HTTP/network test, a sustained month-long workload, or a Netlify/Cloudflare
capacity guarantee. Production remains slow by Netlify's mixed-route function
percentiles; keep the hosted speed gate open.

The Netlify function's privacy-safe request diagnostics provide a clearer
example of the path cost. In the first roughly two hours of the visible
24-hour log window, a sequence of five-minute background-tick calls took
2.47–2.72 seconds inside NOVA, each using nine
sequential database queries. Those calls summed 1.48–1.66 seconds of query
round trips and 0.98–1.11 seconds of pool acquisition time, with individual
query maxima mostly 166–207 ms. Two `auth.get-session` samples measured 3.38
seconds on the first request and 1.17 seconds on the next; the first included
about 2.53 seconds across six auth queries and roughly 3.06 seconds summed
pool acquisition across both pools, while the repeat used one NOVA query
(165 ms) and about one second of acquisition. These are only a couple of auth
requests, not a p95. One cold function invocation lasted about two seconds
longer than its handler; a later warm invocation was within tens of
milliseconds. That separates a cold-start penalty from the recurring
cross-region round-trip and connection cost. Pool/query subtotals overlap and
are not elapsed times to add together.

**Decision:** treat speed as an open production issue. Before changing
providers, capture route-level warm and cold distributions plus browser
waterfalls from an authenticated session, correlate route-group timings with
pool wait and database execution, reduce safe serial fan-out where operation
semantics allow it, then repeat the same workload from a candidate
Asia-region runtime. Keep the same database and scheduler during that
comparison. Do not claim a fix from health probes, a successful build, or an
aggregate function metric.

## What the evidence says so far

- Production authentication recovered after the `nova_app` connection
  credential was corrected. `/api/auth/get-session` now returns HTTP 200 and
the user previously confirmed a successful sign-in. A later full reload showed
the public landing page, so that response may represent an empty session; HTTP
200 alone does not prove a logged-in session.
- Recent Netlify samples for `GET /api/auth/get-session` measured about 3.39 s
inside NOVA on a cold request and 1.21 s on a warm request. Netlify recorded
about 5.01 s for the cold invocation and 1.25 s for the warm invocation. A
single warm sample is not a route-level p95.
- Those samples recorded entry-module loading around 4 ms and Better Auth
module loading around 15 ms. Module import time does not account for the
remaining warm request time. The cold invocation also includes about 1.6 s
outside the measured NOVA handler, consistent with platform/runtime startup
work, though the current evidence cannot attribute all of that interval.
- Earlier slow-request records for People and `me` routes were about 1.5–3.3 s
inside NOVA; organisation, roles, and work-context routes were about 4.5–5.6
s. Those records do not yet separate database round trips from SQL execution,
pool waiting, and application work.
- The Netlify console currently confirms the function runs in CMH (Ohio), and
  region configuration is locked behind an upgrade for this project. Recent
  function logs ranged from about 5.09 s to 4.9 ms, with many neighboring
  calls around 50–175 ms. These are invocation durations without route labels;
  they show variability, not which requests or pages account for it.
- The first authenticated production pass after deploy `6ac6178f` (Oct 7,
  15:28–15:35 IST) produced one privacy-safe aggregate record for each slow
  request. On warm calls, `/api/people` took about 1.50 s in NOVA, with 1.16 s
  of NOVA query round trips across seven queries and 0.33 s across two auth
  queries. A repeated call with the same warmed pools was also about 1.50 s.
- During that pass, My Day reads took about 3.3–3.8 s in NOVA; People and
  access reads took about 3.5–4.5 s; Work reads took about 3.3–4.7 s, with a
  5.2 s task-catalog read. These longer calls had 6–14 NOVA queries (about
  1.0–2.4 s aggregate query time). With a warm auth pool, two auth queries
  took about 0.33 s; on fresher instances the auth queries reached 2.4 s.
  Per-query maxima were usually around 165–190 ms, with isolated calls near
  500–600 ms. A fresh/idle pool added roughly 1 s of summed acquisition time
  per pool; a warmed pool showed zero acquisition time. Pool and query totals
  are aggregate durations and can overlap across concurrent operations.
- On those slower requests, entry-module loading stayed around 3–16 ms, and
  `app_ms` nearly matched `handler_ms`. Netlify’s invocation duration was
  usually within tens of milliseconds of the handler on those samples. One
  earlier cold session request had about 1.7 s outside NOVA, so platform
  startup can hurt cold requests but does not explain sustained warm latency.
- A direct read-only Supabase dashboard inspection found the live database
  using a small fraction of its connection limit: 13/60 connections, zero
  active queries, zero blocked queries, zero idle-in-transaction sessions, and
  no blocker or long-running query at that snapshot. The project overview
  showed 2% CPU, 14% disk, and 56% RAM. This rules out saturation at the time
  checked, but one live snapshot cannot rule out historical spikes.
- Supabase Query Performance, filtered to the `nova_app` role, showed a
  99.99% cache-hit rate and 3.2 average rows per call. Its counters are
  `pg_stat_statements` aggregates since the last statistics reset, not a
  selected time-window sample or a per-request p95. The highest cumulative
  NOVA statements include a Better Auth PostgreSQL schema-introspection query
  (68 s across 1,284 calls; maximum 196 ms), permission and actor checks
  (maximum 227 ms and 132 ms), and boundary-maintenance functions (maximum
  189 ms or less). These maxima and averages do not show a single multi-second
  PostgreSQL query; the largest totals are driven partly by repeated calls.
  The metadata query matches Better Auth's Kysely schema check in the installed
  adapter. Better Auth caches a successful check per adapter instance, so this
  is a cold-instance/startup cost, not a query on every warm API request.
- The code constructs three Better Auth configurations and previously made a
  separate `pg.Pool` for each one. A warm Netlify instance could therefore
  allow up to 10 NOVA plus 15 auth connections (25 total). All three policies
  use the same database URL, so they now share one process-local auth pool;
  the maximum is 10 + 5 (15 total) without changing sessions, schema
  validation, or permission checks. This reduces unnecessary pool creation
  and peak connection capacity, but it does not remove the Ohio-to-Seoul
  distance. The first post-deploy sample still recorded up to about 3.1 s of
  aggregate pool-acquisition time on a fresh runtime, so this fix is capacity
  hygiene, not a demonstrated end-to-end latency cure.
- `nova.configured_public_origins()` is also a high-call-count statement in
  the cumulative report. It is deliberately read by Better Auth's dynamic
  trusted-origin callback on relevant auth requests. It returns a low
  per-call maximum in the report, so preserve the dynamic allow-list contract;
  only consider a cache after measuring the request path and designing a
  reliable invalidation rule.
- The runtime `nova_app` role still cannot read `pg_stat_statements`
  (PostgreSQL `42501`). The dashboard was used for the read-only review; no
  grants or database settings were changed. Do not broaden the runtime role
  for profiling.
- My Day returned HTTP 409 for attendance because the page reported that an
  active office assignment is required. This is a setup/business-state issue,
  not a latency or database-authentication failure. Work’s sampled reads
  returned HTTP 200, while its page displayed a generic unavailable state;
  that client/page error needs a separate investigation.
- The Admin loader starts its authorized read batch with `Promise.all`; the
Work loader also starts its independent authorized reads with `Promise.all`.
That avoids serializing independent API calls, but each page still waits for
its slowest required request. Session bootstrap must finish before page data
loads; it then reads grants and appearance preferences in parallel. Admin
currently reads the permission-grant projection again when its page loader
starts. This extra read is a secondary candidate, not the explanation for
multi-second individual API responses.
- The current deployed code already reduced the attendance availability
calculation from six serial database trips to one statement. Further query
changes should follow the measurements below.
- After commit `3635d61` was published as Netlify deploy
  `6ac61e0ce6e5b90008fd3c00`, a read-only Admin reload emitted fresh production
  diagnostics. Warm `api.me`, offices, permissions, people, and departments
  samples were about 1.5–1.7 s each, with roughly 1.0–1.4 s in 6–7 NOVA query
  round trips and about 0.34 s across two auth queries. Fresh-instance reads
  of `api.me`, people, roles, permissions, offices, and departments were about
  4.4–4.7 s in NOVA, with 10 queries, 1.7–2.5 s query round-trip totals, and
  roughly 3.0–3.1 s summed acquisition time across both pools; Netlify
  recorded about 6.1–6.3 s for these calls while entry-module time stayed
  around 3–16 ms. `api.work-context` remained about 2.6 s with 11 queries and
  a 0.5 s maximum. These are a single post-deploy page-load sample, not p50 or
  p95, but they confirm fresh pools and repeated database round trips remain
  the primary measured costs.

**Working diagnosis:** the strongest evidence is the repeated server/database
round-trip cost across several API queries on a Netlify function in Ohio and a
PostgreSQL database in Seoul. On warm routes, most observed PostgreSQL
statements have sub-230 ms maximum execution time in the cumulative Supabase
report, while NOVA measures about 150–190 ms per application-side query
round-trip and 1.0–2.4 s across 6–14 queries. The database had no current
blocking or resource saturation when inspected. This makes cross-region
network latency plus query fan-out the leading explanation, with query
execution and cold pool acquisition still contributing. Netlify startup adds
some cold latency but is not the main warm-request cost. The post-deploy logs
confirm that interactive route handlers dominate these samples and that
database acquisition/round-trip totals are high. They still do not match each
driver round trip to PostgreSQL execution time, so capture a bounded
`pg_stat_statements` delta around the next controlled workload and compare
the same code/database on a closer runtime before selecting a permanent
hosting change.

## Checklist

### 1. Capture a comparable production baseline

- [x] Keep the existing slow-request log bounded to allow-listed route groups,
  method, status, and timings. It omits IDs, query strings, emails, IPs, SQL,
  and credentials.
- [x] Add per-request totals for pool acquisitions, acquisition time, query
  count, query round-trip total, maximum query time, and failures, separately
  for the NOVA and Better Auth pools. The counters use request-local async
  context; they do not retain SQL or query parameters.
- [x] Commit and publish this instrumentation, then confirm slow requests emit
  one aggregate record each (deploy `6ac6178f`, commit `056fb6a`).
- [ ] After a fresh user sign-in, collect at least ten warm requests per route
  group and repeat after an idle interval for cold-start samples. Include
  session, permission grants, People directory, organisation, roles,
  work-context, attendance, and the slowest page-specific routes.
- [ ] Record median and p95 by method + allow-listed route group, with deploy
  commit, time window, function region, database region, status, and whether
  the request was authenticated. Do not treat unauthenticated session checks
  as authenticated page baselines.
- [ ] In the browser Network panel, record the navigation-to-interactive
  waterfall and request count for My Day, People, Work, and Admin. Keep the
  browser measurement separate from API handler time.

### 2. Attribute each slow request

- [x] Compare handler and application time in the first deployed Work sample:
  5,792 vs 5,791 ms for the batch and 5,702 vs 5,700 ms for work context.
  Application code dominates these samples; platform overhead was negligible.
- [x] Compare module load time for the Work batch. Entry-module load was 4 ms,
  so import time does not explain the 5.8-second response.
- [x] Compare pool acquisitions and query totals for that batch. NOVA pool
  acquisition summed to 9,178 ms over 14 acquisitions; Auth acquisition summed
  to 2,990 ms over five. Query round trips summed to 8,648 ms over 50 queries.
  These are overlapping totals across concurrent reads, not elapsed intervals.
- [x] Compare maximum query duration: the batch maximum was 192 ms; the
  separate work-context maximum was 533 ms. The context statement needs a safe
  plan review, but this sample does not identify its execution-time share.
- [ ] Collect repeat samples before generalizing these first post-deploy
  observations to other routes or time windows.
- [ ] Treat driver round-trip time as network/driver/PostgreSQL elapsed time,
  not PostgreSQL execution time alone. Capture a matched database-side
  statistics delta before rewriting SQL or adding indexes.

### 3. Inspect PostgreSQL and connection capacity

- [x] Inspect aggregate Supabase `pg_stat_statements` data in the dashboard
  without widening `nova_app` access. The dashboard counters are cumulative;
  they identify candidates but are not a matched request-window sample.
- [x] Inspect the live Supabase Database Connections report as a
  read-only super-admin: 13/60 connections, no active or blocked queries, no
  idle-in-transaction sessions, and no blocker or long-running query. This
  single live snapshot does not exclude a past peak.
- [x] Review the Query Performance report for `nova_app`. It shows a 99.99%
  cache-hit rate and 3.2 average rows per call; statement counters are
  cumulative since the last `pg_stat_statements` reset, not a timed sample.
- [ ] Capture before/after `pg_stat_statements` snapshots around the same
  controlled authenticated workload; compare call count, mean/max execution,
  total execution, and synchronous I/O without resetting global statistics.
- [ ] Inspect sequential scans and index usage for any selected route query;
  only inspect plans for statements shown to matter in the controlled sample.
- [ ] Explain the selected slow statements in a safe environment. Add an index
  only when a real filter/join/order path and query plan justify it; review
  write cost and migration rollback before release.
- [ ] Confirm the Netlify runtime uses the target project's transaction-mode
  pooler endpoint (port 6543) and the exact host from Supabase Connect. The
  driver options must remain compatible with transaction pooling.
- [x] Share one process-local Better Auth pool among the three auth
  configurations that use the same database URL. This corrects the previous
  per-instance maximum from 25 connections (10 NOVA + three 5-connection auth
  pools) to 15 (10 NOVA + one 5-connection auth pool) in `server/src/auth.ts`.
- [ ] Reconcile per-instance pool sizes with Netlify concurrency and Supabase
  limits. The live 13/60 snapshot is healthy; measure peak concurrent
  instances and pooled connections before changing either pool size.

### 4. Check request fan-out and UI critical paths

- [x] Merge the People directory's `people.view` grant gate and bounded,
  target-scope-filtered read into one SQL statement. It still returns 403 when
  access is absent, returns an empty page for permitted actors with no matches,
  and performs search and scope filtering in PostgreSQL.
- [ ] After deployment, compare the People directory query count and
  end-to-end p50/p95 with the recorded baseline; the code change alone does
  not prove a production latency improvement.
- [x] Batch the four sequential Task Catalog permission checks into one
  parameterized permission projection, reusing the same effective-grant scope
  predicate. The catalog and proposal reads remain separately bounded by the
  resulting permissions.
- [ ] After deployment, compare Task Catalog query count and handler time with
  the previous 14-query, roughly 5.3-second cold sample; collect warm samples
  before judging the end-to-end effect.
- [x] Remove the unused Work-page `GET /api/tasks` request. The Work Tasks
  screen renders the bounded `/api/work/tasks/visible` result; no Work
  component consumes `tasksResult`. The extra endpoint loaded the full
  task-and-assignment roster and repeated actor/session resolution. Keep
  `/api/tasks` in place for its Admin and Operations consumers. Focused route
  and grant-plan tests pass, and the web typecheck passes.
- [x] Publish the request removal to production. Netlify published `522d049`
  and then the test-only follow-up `5046c1f`; GitHub verification run #119
  passed both `checks` and `postgres`.
- [ ] After deployment, verify in a signed-in browser that Work Tasks no longer
  calls `/api/tasks`, then compare the same authenticated navigation and
  `/api/work` and `/api/work-context` timings. A signed-in post-deploy smoke
  confirmed the screen renders, but the available browser control did not
  expose a network waterfall. The code change removes a proven unused read; it
  is not a quantified production latency improvement.
- [ ] Use browser traces to count API requests per page and identify true
  dependencies. Preserve server permission checks; optimize only requests
  proven to be redundant or independent.
- [ ] Evaluate reusing the already loaded grant projection for Admin's first
  page read. Keep a refresh/invalidation rule for permission changes and keep
  the API as the final authorization authority.
- [x] Consolidate Work's bounded, feature-grant-planned reads behind a
  server-only page-read batch. The batch accepts at most nine allow-listed
  read routes, rejects mutations and unexpected query parameters, preserves
  each route's status/body for partial failures, and leaves unbounded reads as
  separate requests. Existing route handlers still make their normal
  permission and row-scope decisions. A request-scoped actor resolver shares
  session/actor work only inside that explicit batch; it is not a browser or
  cross-request cache. Focused server, dispatcher, diagnostics, and Work UI
  tests pass in local validation in the current `main` commit.
- [x] Publish the current `main` commit and verify Netlify serves `dd4f891` as
  production deploy `6acb2050f6bb2a0008aac061`; a signed-in Work refresh
  rendered and the batch returned HTTP 200.
- [ ] Compare Work's browser request count, warm and cold
  navigation-to-interactive time, `/api/work/page-read` handler/query
  timings, partial-read behavior, and error rate against the baseline. The
  first request still took 5.792 seconds, so the batch reduced function
  request fan-out but did not demonstrate a latency improvement.
- [ ] If a page waits for many independently slow reads, consider a
  permission-aware aggregate read endpoint only where it materially reduces
  repeated session validation, function dispatches, or database round trips.
  Preserve partial-read states and each resource's exact grant check.
- [ ] Avoid client-side data caches for sensitive people, payroll, attendance,
  and role data. Keep authorization and sensitive search on the server; use
  explicit bounded pagination and cache only data whose freshness and access
  semantics are proven safe.
- [ ] Check static JS/CSS request timing and page rendering separately. The
  current dynamic API measurements already demonstrate server-side latency;
  static asset optimizations cannot remove that time.

### 5. Test region and runtime choices before migration

- [x] Confirm the currently selected Netlify Function region in the project
  settings, rather than relying only on the site's age or default. Netlify's
  selected function ran in `cmh` (Ohio); the project's current settings locked
  region configuration behind a plan upgrade. Netlify documents `nrt` (Tokyo)
  as available on Pro and Enterprise plans.
- [ ] If the plan allows it, compare a Netlify Asia-region deploy against the
  same authenticated workload and database. Netlify runs each function in one
  region, so this is a controlled regional comparison, not geo-routing. Keep
  a known-good deploy available for rollback.
- [ ] Compare warm p50/p95, cold latency, errors, and function execution costs
  before selecting a region. Since all `/api/*` traffic currently enters the
  same `nova` function, a per-function region affects the whole API.
- [ ] If regional configuration is unavailable or still too slow, first run
  the Cloudflare adapter through `wrangler dev --remote` without `--tunnel`.
  It uses Cloudflare execution and the configured Hyperdrive while keeping the
  request entry point local. Keep the production route, database, and
  Supabase Cron owner unchanged, and run only bounded read-only probes. This
  measures the Worker-to-database path but is not a public candidate-domain or
  full signed-in browser comparison. A public preview is public by default;
  do not attach production credentials unless a separately verified access
  boundary protects every path.
- [ ] Before moving Better Auth, PostgreSQL access, or all APIs to another
  runtime, verify its dependencies, transaction/isolation behavior, trusted
  origins, session cookies, CSRF protection, CORS, same-origin routing, rate
  limits, migrations, logging, and rollback with integration tests.

## Hosting decision: Netlify Functions or Supabase Functions?

Yes, Supabase Edge Functions can host authenticated HTTP endpoints and can
connect to the project's PostgreSQL database. Supabase also documents
regional invocation for database-heavy functions. This can reduce the
function-to-database part of a request when the function runs near the data.

It is not a direct switch for NOVA today. The existing API is a shared server
application using Better Auth, Node's `pg` pool, Kysely, request-scoped
`AsyncLocalStorage`, trusted-proxy IP handling, and same-origin `/api/*`
cookies. Supabase Edge Functions run in a Deno-compatible runtime. They have
their own gateway, JWT/CORS behavior, secret deployment, observability, and
regional routing. The current Better Auth session and cookie model must
continue to be enforced; Supabase hosting alone does not replace that auth
contract. Moving the browser API from `novaprimetest.netlify.app` to the
default `*.supabase.co` origin also changes cookie and CORS behavior.

The selected customer profiles remain Netlify + Supabase, Cloudflare +
Supabase, and self-hosted Docker + PostgreSQL. Do not present Supabase Edge as
a fourth customer deployment choice until its runtime, auth, and upgrade path
are proven.

Recommended order:

1. Production diagnostics are published and the first authenticated Work and
   work-context samples are recorded. Collect the missing route distributions
   and browser waterfalls before tuning database plans.
2. Test the existing Cloudflare Worker + Supabase profile through
   `wrangler dev --remote`, without `--tunnel`, using the same database and
   Supabase Cron owner while Netlify remains the production route. Start with
   bounded, read-only routes and compare repeated cold/warm samples. This uses
   Cloudflare execution and Hyperdrive without enabling a public preview. It
   is not a public-domain or complete authenticated-browser cutover test; a
   later public candidate needs its own reviewed access boundary.
3. Compare a Netlify Asia-region deploy only if this project's plan supports
   it without a plan upgrade. Its current settings lock region changes behind
   an upgrade; do not spend money solely on an unmeasured latency hypothesis.
4. Use PostgreSQL functions for specific data-intensive operations only when
   matched measurements show database-side execution benefits. Keep external
   services, email, and orchestration in an application runtime.

Keep Netlify for the static frontend during this evaluation. A split runtime
is possible, but it adds a second deployment, auth/CORS/cookie configuration,
and on-call surface. Adopt it only if measured end-to-end benefit pays for that
complexity.

## Research links

- [Netlify Functions configuration and regions](https://docs.netlify.com/build/functions/configuration/)
- [Netlify Observability](https://docs.netlify.com/manage/monitoring/observability/overview/)
- [Supabase connection choices](https://supabase.com/docs/guides/database/connecting-to-postgres)
- [Supabase connection pooling and limits](https://supabase.com/docs/guides/database/connecting-to-postgres/pooling-and-limits)
- [Supabase Edge Functions](https://supabase.com/docs/guides/functions)
- [Supabase regional invocations](https://supabase.com/features/regional-invocations)
- [Supabase database inspection](https://supabase.com/docs/guides/observability/inspect)
- [Supabase `pg_stat_statements`](https://supabase.com/docs/guides/database/extensions/pg_stat_statements)
- [PostgreSQL `pg_stat_statements` reference](https://www.postgresql.org/docs/current/pgstatstatements.html)
- [Supabase database functions](https://supabase.com/docs/guides/database/functions)
- [Better Auth installation and request-handler integration](https://better-auth.com/docs/installation)
- [Cloudflare Workers placement near a database or backend](https://developers.cloudflare.com/workers/configuration/placement/)
