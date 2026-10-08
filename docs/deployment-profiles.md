# NOVA deployment profiles

**Status:** curated customer deployment contract. Provider automation remains
limited to the boundaries described below.

NOVA offers three supported deployment profiles. The UI presents these tested
shapes instead of exposing every combination of runtime, database, and
scheduler. Internally, the API, PostgreSQL schema, migration runner, and
protected background-tick contract remain portable.

| Profile | UI/API runtime | Database | Scheduled work |
| --- | --- | --- | --- |
| Netlify + Supabase Cloud | Netlify Functions | Supabase PostgreSQL | Supabase Cron |
| Cloudflare + Supabase Cloud | Cloudflare Worker + Hyperdrive | Supabase PostgreSQL | Supabase Cron |
| Self-hosted Docker + PostgreSQL | Docker services behind Nginx on an always-on customer machine | PostgreSQL 17 in Compose by default | One Compose maintenance worker |

The managed profiles can use the same Supabase project. Moving the UI/API
runtime from Netlify to Cloudflare does not copy the database or change the
Cron provider. The Cron job stores its callback origin in Supabase Vault: if
the public origin stays the same, its requests follow the new host route after
the domain cutover; if the origin changes, rerun `bun run supabase:scheduler`
against the same project with the new verified HTTPS origin. Keep the old
runtime available until the candidate, public route, and next `pg_net`
response pass. Verify there is still one named job before retiring the old
runtime. This does not migrate the database or create a second scheduler. The
self-hosted profile packages PostgreSQL, the API, Nginx, and the maintenance
worker together. It binds the published port to loopback by default. An
operator who needs access from other devices must provide a trusted
TLS-terminating reverse proxy and a stable public origin; a sleeping personal
computer is not an always-on host.

## Profile boundary

Vercel runtime and Cron adapters, plus native Netlify/Cloudflare scheduler
adapters, remain in the repository for existing installations and explicit
operator use. They are not shown as new-customer profiles. Removing an adapter
from the customer guide does not disable a deployed customer runtime. The
deployment manager must inventory and preserve existing configurations before
it proposes a move.

Supabase Edge Functions are not a supported profile. NOVA's current shared API
is a Node/PostgreSQL service; a Deno/Edge adapter would need runtime
compatibility work and a full authentication, database, scheduler, migration,
and load-test rehearsal before it can be offered. Other PostgreSQL vendors
can use the direct PostgreSQL setup path when their networking, extensions,
TLS, roles, backup, and restore behavior pass the same checks; NOVA does not
claim that every PostgreSQL-compatible provider is interchangeable.

## Operator responsibilities

`bun run nova:update` owns source and schema upgrades. It stages a pinned
release in an isolated candidate, validates the migration manifest and target
ledger, asks for backup confirmation, applies supported migrations, checks the
restricted application role, and can offer an explicit push to the customer's
repository. A successful push is not proof of a host deployment. Local Docker
activation and hosted deployment/readiness verification remain separate until
the updater adds and rehearses those steps.

`bun run nova:deployment` owns infrastructure diagnosis and future runtime,
scheduler, domain, and database moves. It is a local operator tool; provider
tokens and database-owner credentials must never enter the public browser
assistant or employee application. Its current status/doctor/plan/verify
commands are read-only. Remote inventory can inspect selected Netlify production
variable names/scopes/contexts and Cloudflare Worker binding names/types, plus
site domains and Cloudflare Worker custom domains. For each attached Worker
domain, Cloudflare inventory reads that zone's Worker Routes and exact-host DNS
record names, types, and proxy flags; it does not retain DNS targets or other
variable values. Only the allowlisted scheduler selector is read as a
configuration value. An overlapping route assigned to another Worker, a
missing exact-host record, or incomplete route/DNS permissions blocks a
Cloudflare runtime move. This metadata still does not prove public TLS or
candidate readiness. Runtime-move previews require the exact current public
hostname to appear in the target provider's verified domain inventory;
unknown hostnames and unrelated or empty target-domain lists block the move.
They also block if required production bindings are missing, have the wrong
secret classification, or select a different scheduler. `apply` remains
disabled until public route/TLS readiness, scoped write adapters, precondition
checks, read-after-write verification, crash recovery, and a disposable live
rehearsal are complete.

Remote scheduler plans are scoped to the customer's actual NOVA footprint.
Review all runtimes and schedulers that can call the selected database, then
pass `--confirm-scheduler-scope`. This stores an operator attestation; it does
not search or certify unrelated accounts. The plan still blocks on missing or
incomplete inventory for the selected source runtime, target runtime, and
current or target scheduler.

Keep these resources separate in every plan:

- source release and deployed runtime revision;
- API host and required runtime bindings/secrets (presence only in inventory);
- PostgreSQL endpoint, project identity, migration head, and data copy;
- one scheduler identity and its active state;
- public domain, TLS, and canonical authentication origin.

A runtime move should be the first automated transition and must keep the
database and scheduler unchanged. A scheduler move must inventory all known
triggers, disable and verify the old trigger, then enable and verify the new
one. A database move remains guided until NOVA has a database-wide write
maintenance gate, request drain, tested backup/restore, row-level comparison,
and a rehearsed recovery path. Changing only an API host does not require
copying data; changing the database does.

## Capacity planning baseline

Use this workload for initial QA planning, not as a measured capacity promise:

| Assumption | 100 employees | 200 employees |
| --- | ---: | ---: |
| Workdays/month | 22 | 22 |
| Task submissions/employee/workday | 10 | 10 |
| Task submissions/month | 22,000 | 44,000 |
| Estimated API requests/month, including other daily workflows | 66,000–132,000 | 132,000–264,000 |
| Five-minute background ticks/month (30-day month) | 8,640 | 8,640 |

The tick count is a fixed schedule baseline; user-facing work grows with
activity. Reviews, notifications, file traffic, and task start/stop behavior
can change the estimate. Run a representative load test and watch p95 request
and database latency, PostgreSQL CPU and connection headroom, function CPU,
and egress before promising performance. Paid provider tiers provide quota and
support headroom; they do not fix query, region, pooler, or runtime-latency
problems. Customer employee count is not the same as hosting-provider team
seat count.

## Release gates

Before describing a path as production-ready, verify it from a fresh clone and
from an upgrade of a populated disposable database:

1. Install the selected profile and prove `/api/health`, `/api/ready`, sign-in,
   one representative write, and one background tick.
2. Update source and schema from a pinned stable release, including a fork with
   committed customer changes, a failed migration, a retry, and a host deploy
   that fails after migration.
3. For runtime changes, preserve the live database, auth/encryption secrets,
   public origin, and scheduler; verify both the new route and rollback before
   removing the old runtime.
4. For database changes, restore into a fresh target and compare application
   and auth data, sequences, RLS, encrypted configuration, sessions, and
   migration checksums before cutover.
5. Run the 100-employee baseline and a doubled 200-employee scenario with
   observed p95 and connection-pool measurements.

The local code test suites do not replace these live-provider and scale gates.
