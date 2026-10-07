# NOVA

NOVA is a portable people-operations foundation. PostgreSQL is the persistence
and security foundation; Better Auth is embedded at the API edge; Supabase
Cloud is the easiest hosted PostgreSQL deployment, while direct PostgreSQL on a
VPS remains a supported deployment with the same migrations and domain rules.

## Local first run

Requirements for the guided Windows local install: Docker Desktop (with its
WSL2 backend if desired). On Linux, use Docker Engine with Compose v2. Bun is
needed for non-container development; the API runtime image uses Node.js 22+.

For the shortest local guided path, run `bun run setup`. It creates `.env` only when
it does not already exist, generates local-only secrets, starts Docker Compose,
waits for the API, runs the migration/preflight checks, and prints the one-time
setup handoff. It never overwrites an existing `.env` or contacts a hosted
service. Use `bun run setup:supabase` for the guided Supabase Cloud path, or
`bun run setup -- --mode external` when a direct PostgreSQL/VPS environment is
already provisioned.

The browser-based deployment assistant is available at `/?view=deploy`. It is
a secret-free, session-only guide: it shows which repository files and
provider-account steps apply, but it does not connect GitHub, create provider
resources, write secrets, or enable a scheduler. The customer connects the
repo and sets values directly in their hosting/database accounts, then returns
to verify the deployment. The practical order is: import the GitHub repository
into the code host; run the separate database setup from a trusted computer;
add runtime secrets in the selected host's private settings; map HTTPS and
configure NOVA's public origin; then apply exactly one scheduler using that
provider's configuration or the Supabase scheduler command. The Supabase
setup and scheduler commands display the target project ref and require the
operator to type it exactly before any database/scheduler write. A GitHub push
only deploys committed code/configuration; it does not provision the database,
copy secrets, map DNS or create Supabase Cron. Vercel Hobby's daily-only Cron
cannot run NOVA's five-minute maintenance tick; choose Supabase Cron there. See
[`docs/visual-deployment-task.md`](docs/visual-deployment-task.md) for the
provider-specific apply and verification steps.
The evidence boundary and release gates are tracked in
[`docs/verification-matrix.md`](docs/verification-matrix.md).

If the machine only has Docker (no Bun), use the Docker-only wrapper instead.
On Windows this wrapper expects Docker Desktop's Windows CLI and a running
engine; Docker Engine installed only inside WSL is not a Windows Docker CLI.

```powershell
powershell -ExecutionPolicy Bypass -File .\docker\bootstrap.ps1
```

On an Ubuntu VPS, run `bash docker/bootstrap.sh`. Both wrappers refuse to
overwrite an existing `.env`, generate fresh local secrets, start the same
Compose stack, wait for `/api/ready`, and print the one-time setup token.

If Docker Engine exists only inside WSL, open an interactive WSL distro shell,
run the repository's `bash docker/bootstrap.sh` from there, and keep that shell
open while using NOVA from Windows at `http://localhost:3001`. WSL's systemd
services do not by themselves keep the distro running; when the distro stops,
its local API and Windows localhost forwarding stop too. The API and database
should remain bound to loopback—do not set `NOVA_API_BIND_ADDRESS=0.0.0.0` for
this workflow. For a regular Windows install that stays available without an
open WSL shell, use Docker Desktop. See Microsoft's [WSL systemd
guidance](https://learn.microsoft.com/en-us/windows/wsl/systemd) and [localhost
forwarding guidance](https://learn.microsoft.com/en-us/windows/dev-environment/wsl-interop).

```powershell
bun run setup
```

Open `http://localhost:3001`, choose **Set up NOVA**, and use the one-time
`NOVA_BOOTSTRAP_TOKEN` from the local `.env`. The setup screen first asks for
the exact public NOVA URL (the address people will open), then creates the
founder account and organisation and records the initial hour-based or
scheduled attendance interpretation. Only after that origin is saved can
email be configured. Configure and test an email connection in **Email
delivery**, then use **Admin console** to create
offices, departments, custom roles, invitations, onboarding assignments,
freeze actions, Availability configuration for shifts, calendars, and
holidays, office latitude/longitude plus attendance radius, the employee
**Today** attendance check-in/out surface, and the first leave request/review
workflow. Admins can also configure effective-dated WFH overrides, review WFH
requests through the configurable `availability.wfh.review` permission, and
review historical exceptions created by availability changes. Office
attendance uses the effective office's timezone and geofence; WFH attendance
requires an approved date-range request. The Admin console's Client Work
slice can create clients, workstreams, groups and tasks, assign/reassign work,
and cancel future work while preserving recorded history. The Work page
provides the employee timer, pending reviews and unified timeline. The
Operations page provides permission-filtered People, Client Work/review and
Calendar detail plus CSV exports from those canonical read responses.

For Supabase Cloud without installing PostgreSQL locally, run
`bun run setup:supabase`. It asks for the exact project ref and
project-scoped management token (create one from the [Supabase account token
page](https://supabase.com/dashboard/account/tokens)). A scoped token needs
`database_pooling_config_read`, `database_read`, `database_write`, and
`database_migrations_write` access to that project; see the
[deployment runbook](docs/deployment-operations.md) for scope details and 403
troubleshooting. Setup resolves the
transaction-pooler host from that project's read-only configuration endpoint,
applies the canonical migrations, creates the restricted `nova_app` login if
absent,
writes the local runtime URL, and runs the same preflight. Bootstrap and
preflight verify that the database URL is bound to the selected Supabase
project before making writes or opening a connection. Setup does not reuse a
saved pooler hostname: Supabase pooler cluster indexes cannot be inferred from
region, so it re-resolves the selected project's host each time and rejects a
conflicting explicit `--pooler-host`. The management token must be allowed to
read that project's pooler configuration; if the lookup is denied, setup stops
before touching the database. It prepares the
database only: it does not deploy or start the API. For a local API check, run
`bun run dev` and open `http://localhost:3001`. For a hosted path, copy only
runtime values from the private `.env` into the selected host's server-side
settings, deploy the connected repository, and use its public URL after
`/api/health` and `/api/ready` pass. The management token is only an operator
bootstrap secret; never copy it into Netlify, Vercel, or a committed file.
Use a fresh random `NOVA_APP_PASSWORD` of at least 24 characters. Routine
bootstrap preserves an existing role password so it cannot silently break a
hosted API. For an intentional rotation, pass
`--rotate-app-role-password` to `bun run setup:supabase`, then update the
selected API host's `DATABASE_URL` to the newly generated local value before
serving traffic. Setup does not update hosted secrets.

To publish that verified Supabase database through Netlify or Vercel, connect
the repository and add the runtime variables to the host:
`DATABASE_URL`, `BETTER_AUTH_SECRET`, `BETTER_AUTH_URL`,
`NOVA_BOOTSTRAP_TOKEN`, `NOVA_SECRETS_ENCRYPTION_KEY`,
`NOVA_BACKGROUND_JOB_SECRET`, the non-secret `NOVA_BACKGROUND_SCHEDULER`, and
`NOVA_ALLOWED_ORIGINS` for a mapped custom domain. For Vercel, add
`CRON_SECRET` only when Vercel Cron is the selected scheduler; Vercel sends it
only to the production Cron invocation and the adapter converts that request
to NOVA's protected POST tick. Do not add
`SUPABASE_ACCESS_TOKEN`; it is used only by the one-time operator bootstrap.
All hosted runtimes ultimately call the same `POST /api/internal/background/tick`
endpoint. Set `NOVA_BACKGROUND_SCHEDULER` to exactly one of `cloudflare`,
`netlify`, `vercel`, `supabase`, or `vps` on every NOVA runtime sharing that
database. Each built-in adapter identifies itself; NOVA rejects a tick from a
different provider. Still disable unused provider schedules: NOVA cannot
detect duplicate schedules configured for the same provider. Netlify +
Supabase is the current hosted reference path. Its build plugin includes the
Netlify scheduled function only when `NOVA_BACKGROUND_SCHEDULER=netlify`; when
`supabase` is selected, it publishes the API without Netlify's schedule, so no
source edit is needed. Cloudflare and Vercel remain supported hosted adapters;
Vercel's build-time `vercel.ts` config registers Cron only when its production
selector is `vercel`. Supabase Cron/pg_net and VPS/Docker use the identical
protected endpoint. To switch away from Supabase Cron, run
`bun run supabase:scheduler:disable` from a trusted operator machine.
The Supabase adapter enables `pg_cron`/`pg_net` and uses Supabase's
`supabase_vault` extension (which exposes the `vault` schema) for its two
scheduler secrets; direct PostgreSQL deployments use the local worker instead.
The scheduler command reads the target project and tick secret from the private
`.env`, asks for the deployed HTTPS origin if it is missing/localhost, and
prompts for the management token with hidden input if setup has already removed
it from the file. Confirm the displayed project ref before entering a token;
the token is used only for that operator command and is not saved.

The guided assistant and current scripts do not yet move a running installation
between hosting providers or copy a populated database. That requires a local
deployment manager with provider-management adapters, a reviewed plan, and a
resumable cutover. See the [deployment manager plan](docs/deployment-orchestrator-plan.md)
for the current support boundary and implementation sequence.

## Updating an existing checkout

The operator-run updater is in preview. `bun run nova:update --check` reads
the stable release channel and checkout state; `--plan` stages a durable
candidate worktree and inspects a selected database; running `bun run
nova:update` guides through candidate checks, backup attestation, migrations,
and an optional non-force push to a customer GitHub branch. Before a push, it
checks schema and restricted `nova_app` access against the selected database.
The candidate is separate from the running app, and a push does not confirm
that a hosting provider has deployed it. This updater has not yet shipped in a
stable NOVA release, so existing hosted customers need maintainers to publish
the updater baseline and a later stable version before using it. See
[`docs/update-manager.md`](docs/update-manager.md) for prerequisites and the
current supported boundary.

The local Compose defaults bind both services to loopback only. Keep these
defaults for local installs; do not expose the API or PostgreSQL on a public
interface. For WSL-only Docker, use the interactive-shell instructions above
so Windows localhost forwarding remains available without widening the bind.

Useful checks:

```powershell
curl http://localhost:3001/api/health
bun run deployment:doctor -- --api-origin https://your-nova-domain.example
bun run deployment:preflight
docker compose --env-file .env -f docker/compose.yaml run --rm migrate bun run --cwd server db:test
```

The deployment doctor is read-only. It checks the operator's selected database
and, when `--api-origin` is provided, probes the deployed liveness and
readiness endpoints without sending credentials. It reports the matching
supported repair path; database target changes, role-password rotation,
migrations, host-secret edits, and scheduler changes remain explicit operator
actions. For QA, load only that target's settings, for example
`bun --env-file=.env.qa-supabase run deployment:doctor -- --api-origin https://your-qa-domain.example`.

Keep the local volume when restarting. For a schema change, run the migration
service before recreating the API:

```powershell
docker compose --env-file .env -f docker/compose.yaml run --rm migrate
docker compose --env-file .env -f docker/compose.yaml up -d api maintenance
```

## Supabase Cloud

Provision the exact project-scoped PostgreSQL connection from the Supabase
Connect panel. `MIGRATOR_DATABASE_URL` uses the migration owner only;
`DATABASE_URL` uses the non-owner, non-`BYPASSRLS` `nova_app.<project-ref>` role
through the transaction pooler with `sslmode=require&uselibpqcompat=true`.
Run the canonical migrations once, then run the same API locally with
`BETTER_AUTH_URL=http://localhost:3001` to verify the hosted database without
Netlify or Vercel. On a disposable empty database, `bun run test:database`
executes the rollback-only PostgreSQL fixtures; do not run that fixture suite
against a populated customer database unless its disposable-test precondition
has been verified. Never use the Supabase `postgres` owner or
`service_role` connection for normal NOVA API requests.

## Cloudflare, Netlify, Vercel, and VPS

Netlify + Supabase Cloud is the current hosted reference path
(`netlify/functions/nova.mts`). Cloudflare (`cloudflare/worker.ts`) and Vercel
(`api/[...path].ts`) are supported alternative adapters that use the same API
and PostgreSQL schema. Each keeps domain logic in the shared API. A VPS can
run the same API and static client behind a reverse proxy with direct
PostgreSQL. See
[`docs/foundation-design.md`](docs/foundation-design.md) for the portability,
RLS, role, email-adapter, and module-boundary rules.
See [`docs/deployment-operations.md`](docs/deployment-operations.md) for
backup/restore, upgrades, secret rotation, readiness and scheduled maintenance.
See [`docs/deployment-orchestrator-plan.md`](docs/deployment-orchestrator-plan.md)
for the planned orchestration of runtime, database, scheduler, and domain moves.

NOVA is open source. Checkout, trials, subscriptions, license activation and
mandatory call-home services are not required. A hosted operator may provide
optional managed infrastructure, but the repository remains self-contained:
an operator configures deployment secrets, runs migrations, verifies health,
and hands the customer the guided one-time setup flow.

## Email adapters

The Super Admin can configure one or more encrypted connections and activate a
tested sender: Console (local development), SMTP/Nodemailer, Gmail OAuth2 with
a customer-owned Google OAuth client, or Resend. Credentials are encrypted
with `NOVA_SECRETS_ENCRYPTION_KEY`; provider identity is not NOVA identity and
can be changed later without changing users, roles, or domain data. The guided
setup requires the public origin first and shows the exact Gmail callback URI;
Node/Netlify/Vercel/VPS deployments support SMTP/Nodemailer, Gmail API OAuth2
and Resend. Cloudflare supports Gmail API OAuth2 and Resend over HTTPS but not
SMTP/Nodemailer. Email can
also be explicitly deactivated: sign-in, in-app notifications and authenticated
password changes continue, while invitations, verification and password resets
use a permission-controlled, one-time secure system handoff that an authorised
administrator reveals once. No administrator is given a password.

## Custom domains and generated links

Connect the custom domain and HTTPS at Netlify, Vercel, or the VPS reverse
proxy first. Set `NOVA_ALLOWED_ORIGINS` in the API environment to the exact
origins mapped to this deployment, alongside `BETTER_AUTH_URL` as the fallback.
A Super Admin selects the approved origin during first-run setup (and can
change it later in Settings → Public links and custom domain). NOVA uses that selection for new invitations, auth
verification/reset links, Gmail OAuth callbacks, notification email links and
browser redirects. The active email connection must be deactivated before the
origin can be cleared; after clearing, outbound links are blocked until one is
selected again. The setting is per organisation, audited, and cannot add a host outside the deployment allowlist. Supabase Cloud remains the
database adapter; it does not host the public web origin.

For a VPS reverse proxy, set `NOVA_TRUST_PROXY_HEADERS=true` only when the
proxy strips client-supplied forwarded headers and sets the external host and
HTTPS protocol itself. The same opt-in enables trusted client-IP headers for
Better Auth's shared rate limiter; leave it false when NOVA is directly
exposed.
