# NOVA deployment operations

This runbook applies to both supported runtime shapes:

```text
Same NOVA domain/API
  -> PostgreSQL + constraints + transactions + RLS
  -> Supabase Cloud or direct PostgreSQL/VPS infrastructure
```

## Install and upgrade

Guided first path:

- local/private Docker: `bun run setup` creates fresh local secrets only when
  `.env` is absent, starts Compose, applies migrations, waits for health and
  runs preflight;
- Docker-only Windows laptop: run
  `powershell -ExecutionPolicy Bypass -File .\docker\bootstrap.ps1` with
  Docker Desktop installed and running. For Docker Engine only inside WSL,
  run `bash docker/bootstrap.sh` from an interactive WSL shell and keep that
  shell open while using NOVA; Ubuntu VPS uses the same shell command. These
  wrappers need only Docker/Compose, create `.env` once, start the same stack
  and wait for `/api/ready`;
- Supabase Cloud: run `bun run setup:supabase`; it displays the selected
  project ref and requires you to type it exactly before it performs any write,
  then resolves the transaction pooler, applies the canonical migrations, and
  runs preflight. In a non-interactive run, set
  `NOVA_SUPABASE_PROJECT_REF_CONFIRM` to that exact ref. It prepares the
  database only; it does not deploy or start NOVA's API. Run `bun run dev` for
  a local API check, or copy runtime values into the selected host's private
  settings and deploy the connected repository. The management token is never
  a runtime secret and must not be copied to Netlify, Vercel, or a public repo.
  For an isolated QA project, keep its settings in the ignored
  `.env.qa-supabase` file and run
  `bun --no-env-file run setup:supabase -- --env-file .env.qa-supabase --project-ref YOUR_PROJECT_REF`.
  The `--no-env-file` flag prevents Bun from loading a different root `.env`;
  the setup command then reads and updates only the selected file. It rejects
  paths outside the checkout and symlinked env files. The project token is
  requested with terminal masking when it is not already in the process
  environment; do not pass it as a command-line argument. To repair a rejected
  `nova_app` password, add `--rotate-app-role-password` only when you can also
  update the API host with the newly generated `DATABASE_URL` from that same
  selected file. On Netlify, update Production Functions before serving traffic.
- an already-provisioned VPS/direct PostgreSQL: set `.env` and run
  `bun run setup -- --mode external`.

After the Supabase bootstrap, a hosted deployment needs only the runtime
values `DATABASE_URL`, `BETTER_AUTH_SECRET`, `BETTER_AUTH_URL`,
`NOVA_BOOTSTRAP_TOKEN`, `NOVA_SECRETS_ENCRYPTION_KEY`, and
`NOVA_BACKGROUND_JOB_SECRET` (plus `NOVA_ALLOWED_ORIGINS` for the deployed
origin and `NOVA_PUBLIC_ORIGIN` only when the selected trigger needs it). Keep
credentials separate from ordinary configuration: database/auth/bootstrap/
encryption/tick credentials are secrets; public origins and the scheduler
selector are plain configuration. Set the non-secret
`NOVA_BACKGROUND_SCHEDULER` selector to one of
`cloudflare`, `netlify`, `vercel`, `supabase`, or `vps` on every NOVA runtime
sharing this database. The selected trigger identifies itself to the common
endpoint; mismatched built-in providers are rejected. Migration 0061 creates
the shared Better Auth rate-limit table, and 0062 allows a previous assignee
to receive a new handover assignment without rewriting cancelled history;
both are database state, not runtime secrets. Never add
`SUPABASE_ACCESS_TOKEN` to a hosted runtime. Every hosted
adapter invokes the same protected `POST /api/internal/background/tick`
contract. For Vercel, add `CRON_SECRET` only when Vercel Cron is selected; the
adapter converts Vercel's production Cron GET to the canonical POST. Cloudflare
Cron is the first-class Supabase Cloud path; Netlify uses its published
scheduled function; and the VPS/Docker worker calls the same protected
endpoint. Supabase Cron/pg_net is available through
[`scripts/supabase-background-scheduler.sql`](../scripts/supabase-background-scheduler.sql),
`bun run supabase:scheduler`, and `bun run supabase:scheduler:disable`. Keep
only one production trigger enabled per database. The selector prevents a
stale trigger from another built-in provider from running NOVA work, but it
cannot discover or stop duplicate schedules configured with the same provider
identity. The Supabase SQL sets pg_net's HTTP timeout explicitly to 55 seconds.
The canonical tick sends at most four outbox emails concurrently; remaining
messages stay durable for later ticks instead of extending one serverless
request with a long serial batch. pg_cron success means the request was queued,
not that the API completed: verify both `cron.job_run_details` and
`net._http_response` (`status_code`, `timed_out`, and `error_msg`), then check
the selected API host's function logs. pg_net retains HTTP responses for six
hours by default, so inspect them soon after the first run.
Before rerunning the scheduler command, confirm the local
`NOVA_BACKGROUND_JOB_SECRET` exactly matches the API host's value: setup
replaces the Vault copy as well as rescheduling the job.

For the first run, use the Supabase SQL editor:

```sql
select jobid, status, return_message, start_time, end_time
from cron.job_run_details
where jobid = (select jobid from cron.job where jobname = 'nova-background-tick')
order by start_time desc
limit 10;

select id, status_code, timed_out, error_msg, content, created
from net._http_response
order by created desc
limit 20;
```

The Cron row confirms that pg_cron ran its SQL. The HTTP row is the one that
confirms whether the Netlify/API endpoint answered successfully.

### Where each deployment value goes

Selecting a path in NOVA only selects the browser checklist. It does not change
GitHub or a provider account. The customer must first import/connect the repo
in Cloudflare Workers & Pages, Netlify, or Vercel; after that, a configured
production push deploys committed code and provider configuration. A GitHub
push does not create the database, inject runtime values, map DNS, or enable
the Supabase scheduler.

For each path, the division is:

- **Code:** repository configuration files describe the host adapter and
  native scheduler. The hosting platform deploys those files after the GitHub
  connection and deploy settings are in place.
- **Database:** create the Supabase project or private PostgreSQL server
  separately. Run `bun run setup:supabase` or the direct-PostgreSQL setup from
  a trusted operator computer to apply migrations and establish the restricted
  `nova_app` role.
- **Runtime secrets:** put only runtime values in the chosen host's encrypted
  server-side settings. Supabase management tokens and migration-owner
  credentials stay on the operator computer. Cloudflare gets the PostgreSQL
  connection through Hyperdrive; Netlify/Vercel use the restricted
  `DATABASE_URL`.
- **Domain and generated links:** configure DNS/HTTPS at the host, add exact
  origins to the runtime allowlist, then have the NOVA founder select the
  public origin in first-run setup.
- **Authentication and email:** Better Auth is part of NOVA; Supabase Auth is
  not a separate setup requirement. Configure email later inside NOVA. The
  encryption key remains in the runtime host; encrypted provider credentials
  are stored in PostgreSQL.

The operator does not paste every value into every product. Use this split:

| Deployment | Runtime/API secrets | Scheduler connection |
| --- | --- | --- |
| Netlify + Supabase Cloud | Netlify **Project configuration → Environment variables**. Mark `DATABASE_URL`, `BETTER_AUTH_SECRET`, `NOVA_BOOTSTRAP_TOKEN`, `NOVA_SECRETS_ENCRYPTION_KEY`, and `NOVA_BACKGROUND_JOB_SECRET` as secret values, scoped to Functions. Keep `BETTER_AUTH_URL`, `NOVA_ALLOWED_ORIGINS`, and optional `NOVA_PUBLIC_ORIGIN` as regular Functions variables. `NOVA_BACKGROUND_SCHEDULER=netlify` or `supabase` is a regular, non-secret setting required in both Builds and Functions. | The committed build plugin selects the function directory during the production build. `netlify` bundles the API and five-minute scheduled adapter; `supabase` bundles only the API. Preview and branch builds never bundle a production schedule. After choosing `supabase`, run `bun run supabase:scheduler` only after API readiness. If the selector was already marked secret, delete it and recreate it as a regular variable; keep Netlify secret scanning enabled. Do not put setup-only values (`SUPABASE_ACCESS_TOKEN`, `MIGRATOR_DATABASE_URL`, `NOVA_APP_PASSWORD`, `NOVA_SUPABASE_POOLER_HOST`, `NOVA_SUPABASE_PROJECT_REF`, or `NOVA_APPLICATION_DATABASE_ROLE`) on the hosted API. No source edit is needed. |
| Vercel + Supabase Cloud | Vercel **Project Settings → Environment Variables → Production**: private runtime credentials plus regular configuration values. Use `NOVA_BACKGROUND_SCHEDULER=vercel` (or `supabase` for Supabase Cron); add `CRON_SECRET` only for Vercel Cron. Do not include database bootstrap/operator-only variables. | `vercel.ts` reads the selector during deployment. Production registers the five-minute Vercel Cron only for `vercel`; for `supabase`, it deploys an empty Cron list and Supabase Cron is created separately after readiness. |
| Cloudflare Worker + Supabase Cloud | Worker **Variables & Secrets**: credentials in Worker secrets; public origins as ordinary variables. The scheduler selector is supplied by the selected Wrangler config. Hyperdrive uses Supabase's Direct endpoint with restricted `nova_app` credentials (not the generated transaction-pooler URL); choose a deploy command under **Worker → Settings → Build**. | Cloudflare Cron uses `npx wrangler@4.141.0 deploy --config cloudflare/wrangler.toml`. Supabase Cron uses `npx wrangler@4.141.0 deploy --config cloudflare/wrangler.supabase-cron.toml`; that file sets `crons=[]` and selector `supabase`. Save the command and trigger a connected GitHub build/deploy. Both configs set `keep_vars=true` so dashboard-managed origin values persist. |
| Supabase Cron/pg_net alternative | Keep API runtime values on the selected API host and set `NOVA_BACKGROUND_SCHEDULER=supabase` there | Run `bun run supabase:scheduler` from the trusted operator checkout. It reads the project ref and tick secret from private `.env` and requires the exact project ref typed before any write. It prompts for the deployed HTTPS origin if not configured and requests the management token with hidden input if absent. To switch away, run `bun run supabase:scheduler:disable`; it requires the same project confirmation and removes only NOVA's named Cron job and two Vault secrets. The token is not saved. |
| Direct VPS/Docker | `.env` on the VPS; set `NOVA_BACKGROUND_SCHEDULER=vps`; Compose passes values to the API/maintenance containers | Compose starts the maintenance service. A non-Compose install must supervise exactly one maintenance worker; no systemd unit is shipped. Do not also enable a cloud scheduler for this database. |

The repository-root manifest mirrors the API workspace runtime dependencies so Netlify and Vercel can discover them from the project base; a test keeps both manifests synchronized. Netlify additionally lists `pg` and `nodemailer` as external function dependencies so both packages ship with its API function. Cloudflare Wrangler bundles npm dependencies from the root manifest.

These are server-side values. `NOVA_BACKGROUND_SCHEDULER` is not a secret.
Do not prefix any of these values as browser/build variables
(`NEXT_PUBLIC_`, `VITE_`, or similar), commit them, or place the Supabase
management token in a hosted runtime. After changing a host secret, redeploy
or restart that host. After changing the scheduler selection, update the
selector on every runtime sharing the database, disable the previous provider
trigger, run one manual tick, and check provider logs plus `/api/ready`.
Preview/staging runtimes must use separate databases or have no production
scheduler enabled.

Vercel's Hobby plan only supports once-daily Cron jobs, so NOVA's
five-minute Vercel schedule is not compatible with Hobby. Use Supabase
Cron/pg_net for the free Vercel path, or use a Vercel plan that supports
five-minute schedules. Vercel Cron delivery is best effort and does not retry
failed invocations; monitor its logs even though the NOVA tick is idempotent.

Manual equivalent (useful for CI or an existing runtime):

1. Provision PostgreSQL 17 (Supabase Cloud or a private VPS database).
2. Create the non-owner `nova_app` login with `NOSUPERUSER`, `NOCREATEDB`,
   `NOCREATEROLE`, `NOBYPASSRLS`; keep a separate migration owner.
3. Set deployment secrets from `.env.example` and run `bun run migrate` with
   `MIGRATOR_DATABASE_URL`.
4. Run `bun run deployment:preflight` with `DATABASE_URL` set to `nova_app`.
   For direct PostgreSQL/VPS, also provide the separate
   `MIGRATOR_DATABASE_URL`; for Supabase Cloud setup, the temporary
   project-scoped token and exact project ref let the command read that
   project's migration ledger through the Management API. Full readiness
   requires one of those migration checks; without one it reports
   `migration_verification_required` and exits nonzero. Preflight also rejects
   application roles that own NOVA objects or can assume an object-owner or
   privileged role, and verifies the Better Auth rate-limit table exists.
5. Start the API with `DATABASE_URL` set to `nova_app`, then check `/api/health`
   (process liveness) and `/api/ready` (schema plus Better Auth rate-limit table
   availability).
6. Run `bun run test:database` from a disposable database before production
   upgrades. Migrations are append-only and recorded in
   `public.nova_schema_migrations`.

NOVA is open source and has no checkout, trial, subscription or license gate.
After readiness succeeds, open the same-origin setup screen and complete the
guided founder flow. The first-run order is deliberate: select the exact public
origin, record the initial hour-based or scheduled attendance policy, then
configure an email adapter. Only after the origin is saved can NOVA create
email connections, invitations, verification links, password-reset links or
notification email. Then create the first office (timezone and geofence), a
department, a calendar/shift, roles and people. The operator should hand over
only the setup URL and one-time bootstrap token; never hand over database
credentials or deployment secrets.

Email is optional for runtime operation. If no sender is configured, the
Super Admin can still sign in, change their own password, use the in-app inbox
and configure the organisation. Invitations, verification and password resets
use the protected Secure System Handoff queue: the authorised administrator
reveals a short-lived link once for handoff to the person. The link is not a
temporary password, is encrypted at rest and is audited. Activate an email
adapter later to resume normal delivery.

The migration runner takes a PostgreSQL advisory lock, so a repeated operator
run is safe even if two deployment jobs start together. The Docker API image
runs as a non-root user and exposes the same liveness check through its
container healthcheck.

Never run normal API traffic through the migration owner, a PostgreSQL
superuser, or a Supabase `service_role` connection.

## Public origin and custom-domain setup

The public origin is the exact HTTPS origin used in invitations, Better Auth
verification/password-reset links, Gmail OAuth callbacks, notification email
links, and browser redirects. Supabase provides PostgreSQL; it does not host
this web origin. Cloudflare/Netlify/Vercel domain mapping or the VPS reverse proxy must
be configured first.

The deployment fallback is retained for trusted-origin plumbing and the
settings display, but delivery paths never silently use it: an organisation
must explicitly select an approved origin before NOVA can create or send a
customer link.

1. Attach the custom domain and verify DNS/HTTPS in Cloudflare, Netlify, Vercel, or the
   VPS reverse proxy. Keep the provider's default URL as a fallback until the
   custom domain is proven.
2. Set `BETTER_AUTH_URL` to the deployment fallback and set
   `NOVA_ALLOWED_ORIGINS` to a comma-separated list of exact mapped origins
   (for example `https://nova.example.com`). Restart/redeploy the API after
   changing these values. Do not put paths, query strings, credentials, or
   arbitrary wildcard domains in this list.
   For a VPS behind a reverse proxy, set `NOVA_TRUST_PROXY_HEADERS=true` only
   when that proxy strips incoming forwarded headers and sets
   `x-forwarded-host`/`x-forwarded-proto` itself; leave it false when NOVA is
   directly exposed. The same opt-in controls the client-IP headers used by
   Better Auth's shared rate limiter; leaving it false is the safe default.
3. On the first-run setup screen, enter the exact public origin and save it.
   The unverified founding Super Admin may perform this one setup action only
   while presenting the one-time bootstrap token; later changes require the
   normal public-origin permission. Clearing the setting requires the active
   email connection to be deactivated first, so queued links cannot be
   generated for an unknown host; NOVA then blocks all new outbound links
   until an origin is selected again. This choice is stored per organisation
   and audited.
4. Configure and test an email adapter, then test a new invitation, verification link, password reset, Gmail OAuth
   connection, and notification email. Existing links are immutable one-time
   credentials; changing the origin affects newly generated links.

The deployment allowlist is intentionally operator-controlled. A database or
Super Admin compromise cannot turn the application into an open redirect or
make it mint trusted authentication links for an unowned host. The same
environment variables and migration work for Supabase Cloud, local/direct
PostgreSQL, Cloudflare, Netlify, Vercel, and a VPS.

## Backups and restore

For direct PostgreSQL, take an encrypted custom-format backup before every
upgrade and retain a tested restore copy:

```powershell
pg_dump --format=custom --no-owner --file=nova-YYYYMMDD.dump $env:MIGRATOR_DATABASE_URL
pg_restore --list nova-YYYYMMDD.dump
```

Restore into a fresh database first, apply the canonical migrations, restore
application schemas/data as appropriate, run `bun run test:database`, and only
then switch the API connection. Do not restore a production dump over a live
customer database as an in-place experiment.

For Supabase Cloud, use the project's managed backup/PITR controls and test a
restore into a disposable project. The NOVA migration ledger and rollback-only
PostgreSQL tests are the portability check; the Supabase management token is
never a runtime secret.

## Secret rotation

- Rotate `BETTER_AUTH_SECRET` with a planned session invalidation window.
- Rotate `NOVA_SECRETS_ENCRYPTION_KEY` only with an explicit credential
  re-encryption procedure; it protects stored SMTP/Gmail/Resend credentials.
- Rotate `NOVA_BOOTSTRAP_TOKEN` after first-run setup and never reuse it.
- Rotate database passwords only as a coordinated change: run
  `bun run setup:supabase -- --rotate-app-role-password`, update the selected
  API host's `DATABASE_URL` to the generated value, deploy/restart that API,
  and validate `/api/ready` plus sign-in before retiring the old credential.
  Routine bootstrap preserves an existing `nova_app` password. Setup never
  changes hosted secrets, and the management token never belongs in the runtime.

## Scheduled maintenance

Run the canonical background tick every five minutes (or more often for
notification latency). It first closes attendance at each office's local
midnight, then closes productive work sessions at the first boundary after
their recorded office-local start date, then purges expired location evidence,
enqueues due reminders and processes the optional notification outbox. The
tick is safe to retry and can be triggered through one of these equivalent
provider adapters:

- Docker Compose starts the long-running `maintenance` service with the local
  `vps` selector; it calls the API's protected endpoint over the Compose
  network rather than executing a separate domain implementation;
- Cloudflare Cron invokes the protected endpoint through
  [`cloudflare/worker.ts`](../cloudflare/worker.ts);
- Netlify's published `nova-background-tick` scheduled function invokes the
  protected endpoint (use **Run now** to verify it before waiting for the first
  schedule);
- Vercel's production Cron entry generated by [`vercel.ts`](../vercel.ts)
  invokes the same path with `CRON_SECRET` and the adapter translates it to the
  protected POST;
- Supabase Cron/pg_net invokes the same path using secrets stored in Vault by
  `bun run supabase:scheduler`;
- a direct VPS/operator timer runs `bun run maintenance` (one-shot, using
  `http://127.0.0.1:${PORT:-3001}/api/internal/background/tick`) or sets
  `NOVA_MAINTENANCE_LOOP=true` for the same worker.

Provider schedulers must send `Authorization: Bearer
$NOVA_BACKGROUND_JOB_SECRET` and the `x-nova-background-scheduler` identity;
the secret is never sent to the browser. The API fails closed when the
configured provider identity is absent or differs from the selected adapter.

Cloud provider setup is deliberately split: database migrations and the
one-time Supabase management token are operator actions; runtime secrets live
in the selected API/host environment (Netlify, Vercel, Cloudflare, or VPS).
Only the Supabase Cron alternative stores its scheduler copy of the origin
and background secret in Supabase Vault. Its install command safely replaces
the named job and secret values on rerun; its disable command removes those
same named resources. Never put `SUPABASE_ACCESS_TOKEN` in a host's runtime
variables.

## Ownership and support

The normal ownership path is the audited Super Admin transfer command. A
self-hosted deployment operator may recover access only through a separately
controlled, documented operational procedure; never expose the migration role
or a hidden database-owner login as a product shortcut.

### Emergency deployment-owner recovery (operator-only)

This is a break-glass procedure for a self-hosted installation where every
Super Admin is unavailable. It is not a normal NOVA API route and must require
an operator incident record plus two-person approval.

1. Stop the API and scheduled workers, take an encrypted database snapshot,
   and record the incident, operator identities and reason.
2. In a private maintenance window, create a temporary, verified Better Auth
   identity through the configured auth adapter. Never insert a password hash
   directly into PostgreSQL.
3. Using the migration-owner connection, run the reviewed
   [`scripts/operator-owner-recovery.sql`](../scripts/operator-owner-recovery.sql)
   asset with two distinct approver identities, the incident id/reason and the
   temporary auth user id. It links that identity to a temporary active
   `nova.people` row and grants the protected `super_admin` role. The
   transaction writes an auditable `organisation.owner_recovered` event with a
   nullable/system actor; it must not change historical people, work or
   attendance records.
4. Start the API, sign in once, use the normal owner-transfer command to move
   ownership to the permanent operator, then revoke the temporary identity and
   all of its sessions.
5. Inspect the audit trail, verify `/api/ready`, run the rollback-only database
   tests, rotate any temporary credentials, and close the incident.

The reviewed script and two-person approval are deployment-operator assets,
not a product API or portable domain table. Supabase Cloud operators should
use the same control record and database-owner protections; the Supabase
management token is never a runtime identity.
