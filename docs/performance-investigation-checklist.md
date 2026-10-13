# NOVA API and page performance investigation

Date: 2026-10-13

## Current source-matched candidate checks — 13 October 2026

Wrangler's read-only deployment inventory now shows Cloudflare candidate version
`c8ad983a-27ad-43ee-bd18-79088a17d5ca` serving 100% of the candidate Worker,
created on 13 October. It was deployed from repository `main` at
`58572f5a47bef0f664e04258f42a72fe73ade61c`; the `web`, `server`, `netlify`,
and `cloudflare` application paths at that commit have no diff from Netlify's
current app source commit `b51edc9`. The candidate remains public on
`workers.dev`, connects only to the disposable Supabase project through the
restricted-role Hyperdrive binding, has no custom domain or Cloudflare Cron,
and leaves Supabase as scheduler owner. The Wrangler version has no Git tag,
so the source match is supported by the deploy command and repository state,
not an immutable provider-side commit tag.

The same signed-in Super Admin opened the candidate's My Day, Work, People,
Organisation settings, and People and access screens. People returned the one
test account; People and access showed only the protected Super Admin role and
the same person. Empty assignments and the attendance setup message are expected
for this disposable organisation. Route changes briefly showed the public
loading shell before the signed-in content appeared. These checks were reads;
no business record or setting was changed. They do not exercise a custom or
restricted role, invitation, or write flow.

Small anonymous GET samples from the same client returned HTTP 200 throughout.
After discarding one warm-up request per candidate route, ten serial samples on
Cloudflare measured total response p50 / p95 / maximum of 410 / 602 / 602 ms
for `/api/health`, 392 / 955 / 955 ms for `/api/ready`, and 739 / 1,192 /
1,192 ms for `/api/auth/get-session`. A separate Netlify sample measured
706 / 788 / 788 ms for `/api/health` across ten requests, then 677 / 2,413 /
2,413 ms for `/api/ready` and 895 / 1,072 / 1,072 ms for
`/api/auth/get-session` across four requests each. The host samples were not
interleaved, the counts differ, and all requests were anonymous; treat them as
directional only. They show both runtimes can serve the tested endpoints, but
do not show that moving the API removes latency. The 2.4 s Netlify readiness
outlier and overlapping auth results need a larger, interleaved sample plus
authenticated route waterfalls.

Three additional interleaved spot traces captured the `Server-Timing`
application header. `/api/ready` returned 963 ms total / 245 ms app on Cloudflare
and 2,142 ms / 1,204 ms on Netlify; another Cloudflare request was 661 ms /
221 ms. `/api/auth/get-session` returned 1,704 ms / 990 ms and 1,079 ms /
519 ms on Cloudflare, and 1,016 ms / 176 ms on Netlify. All returned 200.
These are individual samples, not percentiles, and the application duration
varies too much to name one cause from these traces. Capture repeated
request-level timings alongside pool acquisition and query metrics; compare
both warm and cold invocations.

The Cloudflare dashboard still failed twice while loading its
`cf-AuthOnlyProviders` module, so the older aggregate below was not refreshed
after the new candidate version was deployed. Do not attribute it to version
`c8ad983a`.

## Older accessible Cloudflare metrics and live Supabase checks — 13 October 2026

The last accessible Cloudflare dashboard's 24-hour view for the public isolated candidate
showed 288 Worker invocations and zero Worker errors. The same view recorded
85 static asset 4xx responses; these still need URL/status attribution. Worker
request duration was about 857 ms p50, 1.05 s p90, and 2.70 s p99. The
candidate's Hyperdrive configuration is named
`nova-runtime-candidate-owfg-test` and points to the disposable Supabase
project. Its dashboard showed about 3,000 queries, 11.13 ms query latency,
2.6 ms connection latency, and three database/Hyperdrive errors. The dashboard
reported 12.63 open connections and one waiting client against the 20-connection
pool ceiling.

These aggregates came from the previous candidate version and are not route-
correlated. They do not prove database time is the only remaining cost; the
three database errors and asset 4xx responses are unattributed. The dashboard
failure is a Cloudflare control-plane page error, not evidence that the Worker
is unavailable. The newer endpoint samples and source-matched read-page checks
are recorded above; the old aggregates remain historical and were not refreshed
after the new version deployed.

On 13 October, the signed-in Supabase dashboard also confirmed one active
`nova-background-tick` Cron job on a five-minute schedule. Its five latest runs
were all successful, and the five latest `net._http_response` rows were HTTP
200 without timeout. This shows the existing scheduler is healthy for the
selected project; it does not measure the app's page/API latency.

## Matched readiness sample on the current source — 11 October 2026

Both hosts were confirmed on source commit
`9a97dc9896411c7acfbc9b29f9e876e0173ec2b6`: Netlify production deploy
`6acba663d3655400084dc33b` and isolated Cloudflare candidate version
`9130324d-3b33-4bc3-b85c-ebf601e5f649` (Ready, 100% of that candidate
Worker's traffic). The candidate remains public on `workers.dev`, uses only the
disposable Supabase project through restricted-role Hyperdrive, has no custom
domain or Cloudflare Cron, and leaves Supabase as the scheduler.

From one client, one warm-up per host was excluded; ten follow-up
`GET /api/ready` requests per host were then issued serially in alternating
host order. All 20 returned HTTP 200. Netlify total response p50 / largest
observed was 524.1 / 565.6 ms; Cloudflare was 319.2 / 402.4 ms. The
`Server-Timing: nova-app` p50 / largest observed was 170.7 / 170.9 ms for
Netlify and 43.5 / 125.0 ms for Cloudflare. This sample suggests lower
application-path time on the isolated Worker for this readiness query, but it
does not isolate the database, connection setup, or provider contribution. It
is a small serial anonymous readiness sample; it is not signed-in API/page
latency, a cold-start distribution, a sustained load test, or a 100/200-person
capacity guarantee.

The signed-in Super Admin also opened My Day and Work on both the current
Netlify deployment and current isolated Worker. Both pages rendered their
content. The Cloudflare candidate also rendered the People directory and
People and access page through Hyperdrive; its one-person directory and people
controls loaded, and the browser reported no console errors or warnings. Work
showed no assignments, sessions, or timeline events; My Day showed no
assignments/events/requests and the expected attendance setup state because
the disposable organisation has no active office assignment. No business
records or settings were changed. This proves selected read pages resolve on
the deployed source; it does not yet provide authenticated request percentiles
or a browser waterfall.

## Authenticated candidate and fresh Netlify timing follow-up — 11 October 2026

The signed-in session was already active on the Cloudflare candidate. My Day
and Work rendered there through Hyperdrive, and the production Netlify Work
page also rendered for the same Super Admin. No sign-in or business write was
needed. The attendance setup message is expected for this disposable
organisation, which has no active office assignment.

Cloudflare Workers Metrics showed 264 invocations and zero errors across all
versions in the selected 24-hour view. The current candidate version had 21
invocations and zero errors. The displayed request-duration p50/p90/p99 was
198/499/887 ms and CPU was 11/93/167 ms, but those percentiles combine versions
and routes; they are not authenticated page or API percentiles. Worker
Observability remained disabled, and no account setting was changed.

Fresh Netlify function logs at 22:26–22:28 IST still show multi-second API
requests. `GET /api/auth/get-session` took 2.70 s total; two `GET /api/me`
requests took 1.33 s and 3.25 s; notifications took 1.19 s; and Work's
`POST /api/work` took 3.15 s with 17 NOVA queries. That Work request spent
2.815 s in accumulated query time and 1.955 s across five app-pool acquisitions;
the maximum observed waiter count was two, with no acquisition failures or
acquire-at-capacity event. A nearby `/api/work-sessions` request took 3.23 s.
These per-query/per-acquisition subtotals overlap, so they are not elapsed-time
components that can be added together.

The Netlify Functions region is CMH (Ohio), while the disposable Supabase
database is in Seoul. The log sample supports investigating database-region
round trips and connection acquisition together; it does not isolate their
individual costs. The brief waiter observation also means lowering pool sizes
without a matched concurrency test could make queuing worse. Next, collect a
single-tab authenticated browser waterfall with request IDs, then compare
repeated route p50/p95 and a controlled hosted concurrency profile on both
runtimes. The Worker dashboard sample is too small and too mixed to declare
that Hyperdrive fixes the live slowdown or proves employee capacity.

## Earlier anonymous Cloudflare Hyperdrive smoke and paired readiness sample — 11 October 2026

At this earlier anonymous probe, Cloudflare listed `nova-runtime-candidate`
as Ready at version `6d50dd5c`; the exact-source current deployment and signed-in
route checks are recorded below. The Worker has only its public `workers.dev`
hostname, with no customer domain or Cron. Its `HYPERDRIVE` binding targets the disposable Supabase
project through configuration `nova-runtime-candidate-owfg-test`:
`db.owfgvojdaxafayutbcuf.supabase.co:5432/postgres`, restricted role
`nova_app`, query caching disabled, and a soft origin connection limit of 20.
The password is held by Hyperdrive and is not displayed. This must stay an
isolated test target because the candidate hostname is public.

The earlier anonymous probes returned HTTP 200 from `/api/health`, database-backed
`/api/ready` (`status=ready`, `scheduler=supabase`), and
`/api/auth/get-session` (empty session). The app shell and its referenced
471,207-byte JavaScript asset also returned 200. Cloudflare's dashboard
snapshot showed 90 Hyperdrive queries, 419 kB of uncached results, 26 ms
reported query latency, 26.5 ms connection latency, zero errors, five open
connections, no waiting clients, and the configured ceiling of 20. All 90
queries were recorded as cache-disabled. This verifies a live Worker →
Hyperdrive → Supabase PostgreSQL path; it does not verify authenticated
business workflows, customer provisioning, or a runtime cutover.

A same-machine paired readiness sample used one reused HTTP client per host,
one excluded warm-up, and ten serial follow-up `GET /api/ready` requests to
each. All twenty measured responses returned 200. Total-response p50 and
largest observed response (the p95 for ten samples) were 308/316 ms for
Cloudflare and 510/543 ms for Netlify. The `nova-app` server-timing p50 / max
was 40/45 ms for Cloudflare and 163/164 ms for Netlify. The Cloudflare sample
resolved at `NRT`; another isolated response during the same session resolved
at `SIN`, so the edge route varied. This is a small, anonymous readiness
comparison, not an authenticated page benchmark or capacity test. Cloudflare's
candidate JavaScript and Netlify's served JavaScript had different SHA-256
hashes despite equal byte lengths, and that earlier candidate's source commit
was not verified; therefore this remains directional historical evidence, not
a controlled same-build comparison or proof that Hyperdrive alone caused the
difference.

The measurements include this client's network path. They do not identify a
stable cold-start cause or represent signed-in product routes, browser
waterfalls, sustained concurrency, or 100/200-employee capacity. No production
route, scheduler, or schema was changed. The Supabase Edge Functions option is
not part of this test and remains a separate future adapter evaluation.

## Latest latency work and provider constraints — 11 October 2026

The current source sends `BEGIN`, transaction-local RLS identity, and
`jit=off` in one PostgreSQL request for each `withDatabaseRequest`
transaction. Both IDs are UUID-validated before interpolation; transaction
scope is unchanged. The JIT choice resets automatically at commit and adds no
database round trip. Server and Cloudflare typechecks passed. The broad Bun
test command did not complete after eight minutes of CPU-bound silence in this
session, so it is recorded as inconclusive. The full isolated PostgreSQL 17
QA did complete successfully with all 80 migrations, 200 employees × 10 tasks,
restore verification, and the 0072→0080 updater rehearsal.

The current 200-employee local workload used 10 tasks each and at most 25
concurrent requests. The five p95s were 346 ms for work context, 101 ms for
task creation/self-assignment, 113 ms for timer start, 59 ms for timer stop,
and 59 ms for assignment reads. The assignment EXPLAIN used no JIT and
executed in 3.5 ms; all waves had zero database diagnostic failures. These
local PostgreSQL measurements are not hosted route latency, a sustained soak,
or a customer capacity guarantee.

A second full isolated PostgreSQL 17 QA run used the request-scoped database
mode that Cloudflare uses, with the same 200-employee / 10-task / 25-concurrent
profile. All 80 migrations, authenticated lifecycle checks, restricted-role
preflight, full dump/restore, and the 0072→0080 updater rehearsal passed. The
work-context p95 was 415 ms, task creation/self-assignment p95 304 ms across
2,000 requests, timer-start p95 327 ms across 2,000 requests, timer-stop p95
246 ms across 2,000 requests, and assignment-read p95 271 ms. Database
diagnostics reported zero failures. This validates the request-scoped
PostgreSQL application path against local Docker; it is not a Cloudflare
Workers network or Hyperdrive benchmark.

## Live sample after the scoped-transaction JIT fix — 11 October 2026

Netlify's Deploys page confirms `358776b` (`perf(db): disable JIT for scoped
API transactions`) is the published Production deploy. The signed-in Work
screen rendered from that deployment. Function logs from 4:28–4:32 PM IST
show the live service is still slow on several API routes:

- `GET /api/auth/get-session` returned 200 in 4.78 s total (3.21 s in NOVA);
  entry-module loading was 4 ms and Better Auth module loading was 15 ms.
- `GET /api/ready` returned 200 in 1.19 s total. Its sole NOVA connection
  acquisition was 1.01 s and the query took 166 ms.
- `GET /api/me` returned 200 in 3.54 s; Work's `POST /api/work` returned 200
  in 3.39 s with 17 NOVA queries; `GET /api/work-sessions` and
  `GET /api/notifications` returned 200 in 5.74 s and 5.85 s total.
- Pool diagnostics did not report the pools at capacity. Query maxima in these
  samples were roughly 166–560 ms, while summed acquisition and query times
  were much higher across multiple connections/queries. These subtotals can
  overlap and are not elapsed time.

This confirms the new code is live, but the local JIT improvement did not make
the deployed product fast. The samples do not establish whether the remaining
delay is dominated by cross-region database round trips, pool connection
setup, or their combination. Netlify is in Ohio and the Supabase project is in
Seoul. A same-workload runtime comparison near the database is still needed;
do not tune pool sizes based on this small sample. A Supabase Edge Function
candidate would keep the provider setup simpler, but NOVA still needs a Deno
adapter and same-origin Better Auth routing before it is a supported customer
profile. Those first logs are observations from a few minutes, not route
percentiles; the later authenticated smoke is recorded below and still lacks
a browser network waterfall.

A later fresh Work-page smoke in the signed-in Super Admin session, at
4:36–4:37 PM IST after the documentation deploy, also returned HTTP 200 on
the sampled routes. `GET /api/auth/get-session` took 2.68 s; `GET /api/me`
samples ranged from 1.23 to 4.28 s; notifications took 1.16 s; recorded work
sessions took 5.84 s total; and the Work page's `POST /api/work` took 6.94 s
total (5.33 s inside NOVA). That Work request had 20 NOVA query round-trips,
8 NOVA pool acquisitions, and 5 auth-pool acquisitions. Its largest query
was 530 ms in the auth pool; summed pool acquisition time was about 3.1 s in
each pool and the observed waiter count peaked at two. More than one Work tab
was open during this smoke, so concurrent page-bootstrap activity may affect
these samples. The page rendered the signed-in Super Admin navigation and
Work empty/setup states; no write action was taken. This is a live smoke, not
a single-tab waterfall or stable route distribution.

### Later Netlify Functions log sample — 11 October 2026, 21:13–21:20 IST

The newer production log window still shows slow API requests after the JIT
round-trip change. Auth session requests took about 2.7–4.9 s total; `/api/me`
about 1.4–5.9 s; Work about 1.2–6.8 s; notifications about 1.3 s; attendance
about 5.9 s (the expected 409 because the test user has no office assignment);
and leave/availability reads about 6.1 s. Pool diagnostics showed no pool at
capacity and no waiting clients, while summed acquisition time approached 3 s
per pool in the slow samples. A later protected background tick returned 200;
the handler took 3.214 s, with 1.082 s across 11 NOVA pool acquisitions and
2.128 s in queries, with no database errors.

These log fields are per-request totals and accumulated per-operation
subtotals, so they must not be added as if they were mutually exclusive elapsed
time. They confirm that the current Netlify product path remains slow, but do
not establish pool exhaustion. The next useful comparison is a single-tab
authenticated browser waterfall paired with request IDs and the corresponding
database-side query timings. Until then, cross-region round trips and
connection/setup latency remain hypotheses rather than confirmed causes.

Netlify's Functions → Region settings page confirms the deployed region is
`CMH (Ohio, US East)` and shows “Upgrade to customize region.” Netlify's
official configuration guide limits custom regions to Pro and Enterprise;
its self-serve Asia Pacific options include `nrt` (Tokyo). A closer Netlify
region is therefore a paid-plan experiment, not a free setting we can apply
in code ([Netlify Functions configuration](https://docs.netlify.com/build/functions/configuration/)).
The user declined Cloudflare Zero Trust because the checkout asks for payment
details. On 11 October, we instead deployed the repository's separate
`nova-runtime-candidate` Worker to its public `workers.dev` hostname, with
preview URLs disabled, no custom domain or Cron, fresh candidate-only secrets,
and only a disposable Supabase project plus its restricted `nova_app` role.
Hyperdrive used the database's direct TLS endpoint on port 5432, allowed up to
20 origin connections, and had query caching disabled. The production Worker,
database route, and Supabase Cron were not changed. Because the candidate is
public, its endpoint is only suitable for disposable data and NOVA's normal
authentication; it is not an Access-protected production-move candidate.

### Earlier exact-source Cloudflare candidate check — superseded by `9a97dc9`

This earlier check used source `6498e15e4ce0ea6628de23b33bc9ef16d9075c6c`
and Cloudflare version `185d9929-c3ee-448f-b710-01079699d3a5`. At that point
the My Day and Work panels stayed in loading states. A later fix and the
current-source retest above resolved that symptom; do not use this older route
result as the current candidate status.

People/access and Organisation also loaded in that earlier run. Cloudflare's
Issues panel asked to enable issue detection and it was left unchanged.

A read-only Wrangler tail from the earlier version recorded the attendance
setup response and successful leave reads without Worker exceptions. It did
not explain the then-stuck panels. No response bodies or personal request
headers were retained.

The Hyperdrive dashboard's last-24-hours snapshot after this smoke showed 203
queries, 908.02 kB returned, 11 ms query latency, 3 ms connection latency, and
zero Hyperdrive errors. It classified 196 queries as cache-disabled, four as
transactions, and three as uncacheable; cached bytes were zero. The pool showed
six open connections, zero waiting clients, and a ceiling of 20. Cloudflare's
deployment snapshot showed 0% Worker error rate and 16.05 ms median CPU. These
are aggregate, low-volume dashboard observations, not per-route attribution,
latency percentiles, or evidence of 100/200-user capacity. The current-source
readiness comparison and rendered My Day/Work pages are recorded at the top of
this document; authenticated API percentiles and a browser waterfall remain
open.

On the earlier candidate version, remote checks returned `/api/health` 200,
`/api/ready` 200 with `scheduler=supabase`, and `/api/auth/get-session` 200
with an empty session.
Readiness executed its schema query against PostgreSQL. The session request had
no authentication cookie, so it verified the Better Auth handler response but
did not test a database-backed signed-in session. Together the health and
schema-readiness responses prove the deployed Worker-to-Hyperdrive-to-Supabase
path is connected; they do not prove sign-in, authenticated business
workflows, a customer first install, or a runtime cutover.

An earlier small serial sample from this machine showed warm Cloudflare
readiness at about 0.33 s and its empty-session response at 0.34 s, compared
with about 0.52 s and 0.52 s on the Netlify test deployment. The fresher
matched sample at the top of this document supersedes those values. Both
samples used anonymous GETs without controlled regional or load conditions;
neither isolates Hyperdrive's contribution or represents signed-in workflows.
Treat them as directional observations, not p95s. The 100/200-employee
hosted load gate remains open.

Zero Trust is not needed for a local Worker smoke test. The repository now has
`cloudflare/wrangler.local.toml` and instructions in `cloudflare/README.md` to
run Wrangler locally with a loopback-only listener and a disposable PostgreSQL
database. Wrangler's `localConnectionString` goes directly to PostgreSQL, so
this checks adapter wiring and Better Auth schema access but not Cloudflare's
network path, Hyperdrive pooling, or query caching. That smoke test has not yet
passed. On 11 October, Wrangler's local-only config bundled successfully and
`/api/health` returned 200, but `/api/ready` and `/api/auth/get-session` were
canceled by the local Workers runtime after about 2.1 seconds. The database was
in a throwaway WSL Docker project; the Windows host could connect to it as
`nova_app`, while the request-scoped QA API passed separately in the Docker
network. The local Worker failure is unresolved and is not evidence of a
production or remote Worker failure. Any internet-reachable candidate remains
a separate, public test and must use only disposable data when no access
boundary is in place.

Hyperdrive is a Workers database feature, not Cloudflare Zero Trust; Cloudflare
documents it as available on Workers plans. Cloudflare also supports native
outbound TCP without Hyperdrive, and Supabase recommends its shared transaction
pooler for serverless/edge connections. However, NOVA's Cloudflare adapter
currently requires a Hyperdrive binding. A no-Hyperdrive Supavisor mode would
need an explicit adapter option and a separate authenticated runtime test
before it can be called supported. Supabase's HTTP Data API is not a drop-in
transport for the existing Kysely/`pg` backend or Better Auth's PostgreSQL
adapter. Keep the supported customer path as Cloudflare + Supabase + Hyperdrive
while measuring any alternate transport; don't add this low-level choice to
customer setup before its support and performance are proven.

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

## Live telemetry snapshot after `c622961` (11 October 2026)

At the time of this snapshot, Netlify's authenticated dashboard confirmed
`c622961` was published as deploy `6acb5d10ece4b700080a203a`. The production function was in
`CMH (Ohio, US East)`; Supabase identifies the selected database as Seoul.
The function logs then showed `GET /api/auth/get-session` at 3.29 seconds
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

Netlify's project dashboard confirmed that the production Function ran in
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

At the time of this earlier note, no candidate Worker or Hyperdrive existed.
The separate disposable candidate smoke is now recorded above. Cloudflare
documents `workers.dev` preview URLs as public by default; the candidate uses
only test data and must not be repointed at production. The production Netlify
route, database, and Supabase Cron remain unchanged.

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
signed-in browser waterfall. Fresh 200×10 PostgreSQL runs passed at concurrency
25. Raising the local DB/auth pools from 10/5 to 25/10 removed most acquisition
wait in one read path but increased assignment query time and did not improve
assignment p95. Keep production pool defaults unchanged until a hosted,
connection-budget-aware comparison exists. Full metrics and limits are in
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

At the time of this earlier note, the signed-in Cloudflare account had no NOVA
Worker, Hyperdrive configuration, or Access policy. The separate disposable
candidate deployment and its live readiness/session probes are recorded above.
Keep the existing Supabase database, Supabase Cron, and production origin fixed
while testing. The candidate's public hostname is suitable only for disposable
data; its bounded read-only checks do not justify traffic promotion.

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
- The three Better Auth configurations already shared a dedicated 5-client
  pool, separate from NOVA's 10-client pool. A fresh authenticated Netlify
  read on 11 October still spent about 979 ms acquiring an auth client while
  the NOVA pool already had reusable connections. The current code change
  gives Node hosts one shared pool with the same combined default ceiling of
  15 (the existing 10 + 5 settings), while diagnostics still label auth and
  domain queries separately. It preserves live session and actor checks; it
  does not add a session cache. The isolated lifecycle passed with this pool
  arrangement, but hosted after-deploy timing is still required before calling
  the auth-connect cost resolved.
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
- [x] Take a matched same-source readiness sample after deploy `9a97dc9`:
  ten serial `/api/ready` requests per host after one warm-up, all HTTP 200.
  Netlify p50/max was 524.1/565.6 ms total and 170.7/170.9 ms `nova-app`;
  isolated Cloudflare was 319.2/402.4 ms total and 43.5/125.0 ms `nova-app`.
  This is anonymous readiness evidence only; it does not close signed-in route,
  page-waterfall, cold-start, or hosted-capacity checks.
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
- [x] Share the Node host's process-local pool between NOVA and Better Auth,
  preserving the prior default combined cap of 15 and source-specific
  diagnostics. The isolated PostgreSQL lifecycle verified login, sessions,
  role checks and the 100-employee workload with the shared pool.
- [ ] Confirm from fresh Netlify logs that auth reuses the warm shared pool
  and compare authenticated first-load latency after deployment.
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
- [ ] Run the local Worker smoke in `cloudflare/README.md` first against an
  isolated, migrated PostgreSQL database. This needs no Zero Trust account and
  validates adapter wiring, but it bypasses Hyperdrive pooling and caching.
- [ ] For a Cloudflare-network and Hyperdrive comparison, use a separate
  candidate with disposable data and test credentials. Cloudflare's remote
  development mode uploads code and connects bindings to remote resources; do
  not assume that omitting `--tunnel` makes a candidate private. Keep the
  production route, database, and Supabase Cron owner unchanged. Without a
  verified access boundary, treat any candidate URL as public and do not use it
  as approval for a production runtime move.
- [ ] Before moving Better Auth, PostgreSQL access, or all APIs to another
  runtime, verify its dependencies, transaction/isolation behavior, trusted
  origins, session cookies, CSRF protection, CORS, same-origin routing, rate
  limits, migrations, logging, and rollback with integration tests.

## Timeline read follow-up and matched local load — 11 October 2026

The live Netlify Work trace above identified `GET /api/work/timeline` as a
3.137 s subread on the older deployment. Commit `38e3df9` combined
authorization/date resolution and timeline data, leaving a separate scoped
correction-permission query (three total after actor resolution). The current
local patch returns both view and correction permission from the access query,
so the route needs two serialized data queries. The correction scope remains
server-side, and denied corrections stay non-actionable. Only access/data
`Server-Timing` durations are passed through Work and Netlify diagnostics; no
timeline payload is logged.

The full isolated PostgreSQL 17 QA passed with this patch on 100 employees ×
10 tasks and 25 concurrent requests: 80 migrations, 2,437 lifecycle
assertions, specialized attendance/WFH/leave checks, restricted-role
readiness, backup/restore, updater rehearsal and cleanup. Timeline p50/p95 was
86.1/121.6 ms, with access/data p95 of 19.6/33.7 ms. Assignment reads were
68.0 ms p95; task create/self-assign was 168.5 ms across 1,000 requests. This
was the first run with a shared Node app/auth pool (effective default cap 15,
the prior 10+5 allocations). These local Docker/PostgreSQL bursts are not
hosted latency or a sustained capacity guarantee.

The earlier 100-person run on the prior three-query timeline code measured
117.2 ms p95; the earlier 200-person run measured 124.4 ms p95. Both remain
useful scale context but do not test the latest permission-query merge or
shared-pool changes.

Production Netlify on `38e3df9` still showed 1.60–2.58 s Work-page requests.
The two Work logs recorded 13 NOVA queries with 2.22–2.28 s summed query time;
the individual timeline phase queries were about 177–187 ms each. Separate
`work-sessions` and `notifications` reads took 2.14/2.18 s, including roughly
979/1,014 ms acquiring an auth-pool client while the NOVA pool already had
reusable connections. Cold `/api/ready` requests also showed about 988–1,044
ms acquiring a database client, followed by a ~165–171 ms query; subsequent
warm requests completed near 170–175 ms. These measurements explain the
remaining work: remote PostgreSQL round trips are serial in simple protected
reads, and separate pools can independently pay connection startup. The new
pool sharing and permission merge are locally verified; deploy them and repeat
a single-tab authenticated Netlify sample before calling the hosted issue
resolved. Compare the same source on the isolated Cloudflare candidate as a
separate provider test.

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

## Cloudflare Hyperdrive candidate smoke — 11 October 2026

The signed-in candidate at `nova-runtime-candidate.amanxnu.workers.dev` was
verified against the disposable Supabase database through its Hyperdrive
binding. My Day, People, Work, and Admin loaded for the Super Admin test
account. Admin showed the expected empty office and department setup, and My
Day showed that attendance needs an office assignment; no test records were
created. The candidate keeps Supabase as the database and scheduler owner.
No production domain, Netlify route, or Cron configuration was changed.

The candidate currently runs Worker version `9130324d`, built from commit
`9a97dc9896411c7acfbc9b29f9e876e0173ec2b6`; Netlify production runs `b51edc9`.
The versions are not source-matched, so this is a runtime wiring and
authenticated page smoke, not a controlled provider speed comparison. With
the Cloudflare dashboard filtered to actively deployed versions, its 24-hour
view showed 288 invocations and zero Worker errors. The request-duration
chart showed p50 about 857 ms, p90 about 1.0 s, and p99 about 2.0 s; CPU time
showed p50 about 23 ms, p90 about 226 ms, and p99 about 338 ms. These are
small-sample dashboard distributions, not route-specific timings or a load
test. The separate static-asset panel showed 85 4xx responses; identify their
paths before treating asset delivery as clean.

The candidate uses a public `workers.dev` address because Cloudflare Access
was not available on the test account. Its application APIs still require
NOVA authentication, and its database is disposable, but the URL is not an
access-controlled staging environment. Do not use it for production traffic
or enter production credentials. To make a fair runtime comparison, deploy
the same source commit to both runtimes, use the same signed-in route sequence
and data shape, collect route-level client timings plus server diagnostics,
and repeat cold and warm runs at realistic concurrency.

## Current-source 200-employee PostgreSQL load run — 11 October 2026

The isolated `bun run qa:postgres` run used current application source
`b51edc9`, 200 synthetic employees, 10 tasks per employee, and at most 25
concurrent requests. It applied all 80 migrations, passed lifecycle, role and
RLS checks, the specialized attendance/WFH/leave suite, restricted application
role preflight, full PostgreSQL backup/restore, and the updater rehearsal from
migration 0072 through the current ledger. The test dropped its run-scoped
databases, containers, network, volumes, and temporary credentials. No hosted
database was involved.

| Read or write workload | Requests | p50 | p95 | p99 |
| --- | ---: | ---: | ---: | ---: |
| Work context at 200 employees | 200 | 127 ms | 212 ms | 235 ms |
| Assignment read at 200 employees | 200 | 41 ms | 55 ms | 61 ms |
| Timeline read at 200 employees | 200 | 66 ms | 96 ms | 113 ms |
| Task create and self-assign | 2,000 | 61 ms | 90 ms | 99 ms |
| Timer start | 2,000 | 70 ms | 106 ms | 120 ms |
| Timer stop | 2,000 | 41 ms | 56 ms | 60 ms |

No diagnostic failures were reported. Under this local concurrent run, the
work-context NOVA pool acquisition p95 was 95 ms and its NOVA query total p95
was 106 ms; assignment-read NOVA acquisition/query p95 was 22/23 ms.
This is useful evidence that the current source handles the modeled 200-person
data shape on local PostgreSQL. It does not establish the same latency on
Netlify, Cloudflare, or a customer-hosted database, and it is not a sustained
capacity or SLA test. The remaining performance gate is an authenticated,
same-source hosted comparison with route-level p50/p95/p99 and a controlled
concurrency profile.

## Live Netlify readiness follow-up — 12 October 2026

After push `94a56f3`, Netlify published the deployment successfully. The
application bundle is still source `b51edc9`; this setup/documentation commit
did not change runtime code. From the same Windows client, `/api/health` and
`/api/ready` both returned HTTP 200. One warm-up was excluded, followed by ten
serial anonymous `GET /api/ready` requests: all returned 200, p50 was 529.4 ms,
and p95/max was 543 ms. This includes the full client-to-Netlify-to-database
path for readiness. It is not a signed-in route/page timing, does not isolate
the provider or database contribution, and is not comparable to the older
Cloudflare candidate because that Worker still runs source `9a97dc9`.
