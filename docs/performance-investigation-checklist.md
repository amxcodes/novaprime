# NOVA API and page performance investigation

Date: 2026-10-07

This checklist separates browser time, Netlify execution, database connection
wait, PostgreSQL round trips, and query execution. It records evidence before
changing runtime or database architecture. The production database is in Seoul
(`ap-northeast-2`); the Netlify function currently runs in Ohio (`cmh`).

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
some cold latency but is not the main warm-request cost. The present evidence
is not a matched per-request database timing sample; collect a delta from
`pg_stat_statements` and compare an Asia-region runtime before selecting a
permanent hosting change.

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

- [ ] Compare `handler_ms` with `app_ms`. A large gap points outside NOVA's
  route handler, such as function startup or platform/gateway work. A small
  gap means the application route dominates.
- [ ] Compare `entry_module_load_ms` and `auth_module_load_ms`. If these remain
  small while `app_ms` is high, changing bundle imports will not fix the warm
  request.
- [ ] Compare `nova_db_pool_acquire_ms` and `auth_db_pool_acquire_ms` with their
  acquisition counts. High acquisition time with many acquisitions points to
  connection creation or queueing; high query time with low acquisition time
  points to database/network round trips.
- [ ] Compare query count, total round-trip time, and maximum round-trip time.
  A high maximum points to an outlier query; many moderately slow round trips
  point to query fan-out or a distant database. These are aggregate timings,
  so do not add them to `app_ms` as separate elapsed intervals.
- [ ] Treat `queryRoundTripMs` as driver/network/Postgres elapsed time, not
  PostgreSQL execution time alone. Validate execution time and locks with
  database-side statistics before rewriting SQL.

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

- [ ] Use browser traces to count API requests per page and identify true
  dependencies. Preserve server permission checks; optimize only requests
  proven to be redundant or independent.
- [ ] Evaluate reusing the already loaded grant projection for Admin's first
  page read. Keep a refresh/invalidation rule for permission changes and keep
  the API as the final authorization authority.
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

- [ ] Confirm the currently selected Netlify Function region in the project
  settings, rather than relying only on the site's age or default. Netlify's
  current documented default is `cmh` (Ohio); `nrt` (Tokyo) is available on
  Pro and Enterprise plans.
- [ ] If the plan allows it, compare an `nrt` deploy against the same
  authenticated workload and database. Netlify runs each function in one
  region, so this is a controlled regional comparison, not geo-routing. Keep
  a known-good deploy available for rollback.
- [ ] Compare warm p50/p95, cold latency, errors, and function execution costs
  before selecting a region. Since all `/api/*` traffic currently enters the
  same `nova` function, a per-function region affects the whole API.
- [ ] If regional configuration is unavailable or still too slow, test a
  small Deno/Supabase Edge Function canary near the Seoul database, not a
  wholesale API cutover. Keep the canary limited to a read path with a clear
  auth contract and equivalent result semantics.
- [ ] Before moving Better Auth, PostgreSQL access, or all APIs, verify the
  Deno runtime dependencies, transaction/isolation behavior, trusted origins,
  session cookies, CSRF protection, CORS, same-origin routing, rate limits,
  migrations, logging, and rollback with integration tests.

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

Recommended order:

1. Publish the diagnostics and measure authenticated warm and cold requests.
2. If database round trips dominate, run the Netlify Asia-region comparison
   first when the plan supports it. This retains the existing Node runtime,
   same-origin cookies, auth behavior, and deployment model.
3. If a region switch is unavailable or insufficient, build a small Supabase
   Edge Function canary with the same auth and RLS/domain checks. Compare it
   against the same API workload before deciding whether an API migration is
   justified.
4. Use PostgreSQL functions for specific data-intensive transactions when
   the measured bottleneck is database-side work that benefits from executing
   close to the data. Keep external services, email, and orchestration in an
   application runtime.

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
