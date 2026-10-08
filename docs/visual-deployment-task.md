# NOVA visual deployment guide

Status (2026-09-30): the secret-free `/?view=deploy` checklist opens with a
short source → runtime ↔ database map and a six-part “You do / Then / Confirm”
detail panel. The detail panel is collapsed by default so the selected setup
stage stays primary instead of repeating all service instructions above it.
It distinguishes code delivery, database migrations, runtime secrets,
domain/auth/email, and the single scheduler in plain operational terms. The
full action/effect table remains available on demand. A local in-app-browser
walkthrough exercised all eight supported host/scheduler pairings and
confirmed their displayed apply/verify instructions; this was against static
local assets, not a live API or provider account. Scheduler actions
name the actual provider setting or command, and the Supabase job-creation
command stays hidden until the API is healthy, ready, and reports the selected
Supabase scheduler. It is still a guided handoff, not a control plane: NOVA does
not sign in to or configure GitHub, Cloudflare, Netlify, Vercel, Supabase, or a
VPS for the customer.

The runtime stage now gives each deployment path a provider-specific variable
template that separates actual credentials, ordinary configuration, build-time
selectors, and operator/bootstrap-only values. For Netlify, only database and
application credentials are marked as secret values (Functions scope);
`NOVA_BACKGROUND_SCHEDULER` is explicitly a regular value for Builds and
Functions. The guide explains that a previously secret-marked selector must be
deleted and recreated as regular configuration, and keeps secret scanning on.
The checklist still does not write provider settings or collect secret values;
the operator applies this classified template in the chosen provider account.

The scheduler choice now keeps its short “where / what activates / where to
confirm” explanation visible and collapses the longer provider settings and
commands. Opening “Show the exact provider settings and steps” reveals them;
once the live readiness probe passes for Supabase Cron, the guarded creation
steps open automatically. This is a readability improvement, not automation:
the customer still applies changes in the named provider or from the trusted
operator checkout.

## What a choice means

The browser stores only the selected path, stage, scheduler choice and
completion markers in session storage. A selection only changes which
instructions are shown. It never edits repository files, signs in to a provider,
provisions an account, writes a secret, applies a migration, maps DNS, or enables
a scheduler. The customer performs the named provider action and returns to
NOVA to verify it. A checkbox is an operator attestation, not remote proof.

The selected path means: GitHub is the source; the chosen runtime host serves
the UI/API and stores runtime secrets; PostgreSQL stores canonical data; a
single chosen scheduler calls the same protected NOVA tick; DNS/HTTPS belongs
to the host/domain provider. Better Auth is part of NOVA, and email is
configured in NOVA after first-run. Migration-owner credentials and the
Supabase management token stay on the operator computer.

The customer flow is: choose the runtime host, public URL and one scheduler
recipe → prepare PostgreSQL and migrations → put runtime values in the API
host's private settings → publish/restart the configured production runtime
and pass health/readiness → create Supabase Cron if selected, otherwise verify
the host-native/VPS trigger → perform NOVA first-run setup → remove the
bootstrap secret. Cloudflare/Netlify/Vercel native schedules are part of the
production deployment; Supabase Cron is created after the API is ready. An
initial GitHub-import build may run before setup is complete; treat it as an
unconfigured bootstrap build, do not invite employees, and publish/restart
after database and runtime settings are complete. If that early build
registered a default native schedule, the final selected configuration must
replace/disable it before creating Supabase Cron. Supabase setup is
database-only; it does not start or deploy the API. The browser's scheduler
choice is only a recipe selector, not a remote provider write.

Both state-changing Supabase operator commands—`bun run setup:supabase` and
`bun run supabase:scheduler` (including `--disable`)—display their target
project ref and require the operator to type that exact ref before writing.
Non-interactive runs must set `NOVA_SUPABASE_PROJECT_REF_CONFIRM` to the exact
target. This prevents a stale private `.env` from silently applying migrations
or a scheduler change to another project.

The deployment screen starts with six compact action cards: code/API,
PostgreSQL, runtime/secrets, domain/links, authentication/email, and scheduler.
Each card separates the customer’s action, the automatic result, and the
confirmation point. The diagram makes the common path visible: GitHub source →
selected runtime host ↔ PostgreSQL, with one scheduler calling the same NOVA
background endpoint. It explicitly distinguishes a production push (code and
committed host config only) from database migrations, runtime secrets, DNS, and
a Supabase Cron write. The detailed “Your action → what happens next” matrix
stays collapsed by default. Exact provider commands, variables, and
verification screens remain in the relevant guided stage.

In the UI, the scheduler panel and visible scheduler card are phase-aware:
before deployment/readiness, a Supabase selection says to disable the host's
native schedule and deploy the matching API config, but does not reveal the
remote-write command. After the live health/readiness probe confirms the
selected runtime scheduler, the scheduler stage shows the actual Supabase
job-creation command, including project-ref confirmation. If the endpoint is
unreachable or reports the wrong scheduler, that command remains hidden. For
Cloudflare, Netlify, and Vercel the UI says exactly which provider setting or
production deploy applies the committed trigger configuration; for VPS/local
it says Compose starts the worker. The guide distinguishes “where you change
it,” “what switches it on,” and “where you confirm.”
The UI explicitly says that selecting a radio option changes only the
checklist. The “How this selection becomes real” summary states where the
customer changes it, what activates it, and where to confirm it. The action
list then shows the exact account/settings or repository file and the expected
provider change. A Supabase choice requires deploying the no-native-
Cron config first, then running `bun run supabase:scheduler` from a trusted
operator checkout after readiness; the browser selection never creates the
database job. Cloudflare, Netlify, and Vercel choices are applied by their
configured production deployment; VPS/local uses the Compose worker. Cloudflare
Cron changes can take up to 15 minutes to propagate, so the guide says when to
check provider run history rather than treating an immediate empty log as a
failed install.

## What changes where

| Concern | Where the customer applies it | What GitHub push does |
| --- | --- | --- |
| NOVA code and static UI | Connect the repository to Cloudflare Workers Builds, Netlify, or Vercel; on VPS/local, run the documented Docker deployment | Builds/deploys committed code on a connected hosted provider. Import/push may publish before setup is ready; it does not migrate the DB, add runtime secrets, or make NOVA ready. A VPS is not updated by a push unless its owner separately configures deployment automation. |
| PostgreSQL schema and restricted `nova_app` role | Run `bun run setup:supabase` from a trusted computer for Supabase Cloud, or the Docker/external PostgreSQL setup for self-hosting. For Cloudflare Hyperdrive, use Supabase's Direct connection endpoint with `nova_app`; for Netlify/Vercel use the generated transaction-pooler URL. | Nothing; app deploy does not run migrations. Keep migration-owner credentials and `SUPABASE_ACCESS_TOKEN` off the runtime host. |
| Runtime secrets and database connection | The selected API host's private server-side Variables/Secrets settings, or the private VPS `.env`; Cloudflare requires a Hyperdrive binding configured with the Direct endpoint and restricted `nova_app` credentials, not the generated transaction-pooler `DATABASE_URL`. NOVA fails closed if the Hyperdrive binding is missing; it will not silently fall back to a raw Worker `DATABASE_URL`. | Nothing unless the provider's build reads a committed, non-secret config file. Never commit secrets. |
| Public URL/domain | Map DNS and HTTPS in the host provider, set `BETTER_AUTH_URL` and `NOVA_ALLOWED_ORIGINS` in host settings, then confirm the exact origin during NOVA first-run setup | A push can redeploy a configured domain, but cannot buy/configure DNS or prove HTTPS. |
| Authentication | Better Auth runs inside NOVA's API; Supabase Auth is not needed. Its URLs/secrets live with the API runtime | Deploys the authentication code only. |
| Email | After founder setup, a permitted Super Admin configures and activates the email adapter inside NOVA. Provider credentials are encrypted in PostgreSQL; the encryption key stays in host secrets. | Deploys adapter code only. Runtime capabilities differ: Node supports SMTP/Nodemailer, Gmail API OAuth2 and Resend; Cloudflare supports Gmail API OAuth2 and Resend, not SMTP. |
| Background scheduler | Follow the selected scheduler steps below. Native schedules are activated by the configured production deploy; Supabase Cron is created by `bun run supabase:scheduler` from a trusted operator computer after API readiness. | Applies tracked native scheduler config only when the provider's connected build/deploy runs. It never creates the Supabase database job. The browser choice only displays the instructions; it does not apply provider settings. |

Better Auth, business authorization, RLS, migrations and the background runner
are NOVA/PostgreSQL behavior shared across deployment shapes. GitHub does not
provision provider resources. Provider-specific code/config is limited to the
API/static hosting adapter and the trigger that calls the same protected NOVA
tick endpoint.

## Provider handoff

| Path | Repository/deploy configuration | Customer action in provider |
| --- | --- | --- |
| Cloudflare + Supabase Cloud | `cloudflare/worker.ts` and one of the two Wrangler configs | In Workers Builds, connect GitHub and set the deploy command to `npx wrangler@4.141.0 deploy --config cloudflare/wrangler.toml` for Cloudflare Cron or `npx wrangler@4.141.0 deploy --config cloudflare/wrangler.supabase-cron.toml` for Supabase Cron. Create Hyperdrive from the Supabase Direct endpoint using the restricted `nova_app` credential from the operator's private `.env`; do not use the generated transaction-pooler URL. Add Worker runtime secrets/variables and map the domain. The next production build applies the saved deploy command/config. |
| Netlify + Supabase Cloud | `netlify.toml`, `netlify/plugins/nova-functions`, and scheduler-specific function entrypoints | Import the repository as a Netlify site with repository root as base directory. Set runtime values in Site configuration → Environment variables, make `NOVA_BACKGROUND_SCHEDULER` available to Builds and Functions, and connect the domain. The production build plugin selects the scheduled-function directory for `netlify` or API-only directory for `supabase`; preview and branch builds never include a production schedule. |
| Existing Vercel installations (legacy adapter) | `vercel.ts`, `web/vercel-config.ts` and `api/[...path].ts` | Existing customers can keep their Vercel project with repository root as Root Directory. Set `NOVA_BACKGROUND_SCHEDULER` in Project → Settings → Environment Variables → Production before deploying. The config registers Vercel Cron only for `vercel` and no Vercel job for `supabase`; previews must not share production scheduling/database credentials. Vercel is not a new-customer profile. |
| Docker/VPS/PostgreSQL | `docker/bootstrap.sh`, `docker/compose.yaml`, and `.env.example` | Clone the repository on the server and run the documented bootstrap. GitHub pushes do not update a VPS unless the operator separately configures a deployment pipeline. Keep `.env` private. |
| Local Docker | `docker/bootstrap.ps1`, `docker/bootstrap.sh`, and `docker/compose.yaml` | Run the Windows or WSL bootstrap. It creates local PostgreSQL/API/maintenance services and a private `.env`; no cloud account is required. |

Runtime public-origin values belong in the API host's settings; the operator
maps DNS/HTTPS there first, then the founder selects the exact approved origin
in NOVA's first-run setup. Email is configured later inside NOVA. Node runtimes
support SMTP/Nodemailer, Gmail API OAuth2 and Resend; Cloudflare's HTTPS runtime
supports Gmail API OAuth2 and Resend, not SMTP. The email encryption key stays
in the selected runtime secret store while encrypted provider credentials live
in PostgreSQL.

## Scheduler handoff

All triggers reach the same NOVA background runner. The selected provider must
also receive `NOVA_BACKGROUND_SCHEDULER`; its configuration file or database
job creates the external trigger. Cloudflare/Netlify/Vercel native schedules
are registered by the configured production deploy (step 4). For Supabase
Cron, the no-native-schedule configuration and selector must be deployed first;
run `bun run supabase:scheduler` only after the public API is ready (step 5),
then type the displayed project ref to confirm the target.
When switching an existing deployment, clicking a different radio does not
change the live provider: disable the old trigger, deploy the matching runtime
configuration, then enable/create and verify the new one.

| Selection | How it becomes active | Verification and limit |
| --- | --- | --- |
| Cloudflare Cron | In Workers Builds → Settings → Build, set Deploy command to `npx wrangler@4.141.0 deploy --config cloudflare/wrangler.toml`, save, then publish. That Wrangler config sets the selector and five-minute Cron Trigger. `keep_vars=true` preserves dashboard-managed public-origin variables between builds. | Check Settings → Triggers → Cron Triggers and Cron Events/Workers Logs. `/api/ready` reports the runtime selector but does not prove the trigger ran. Local Workerd with disposable PostgreSQL now passes the protected tick and scheduled-handler execution; no live Cloudflare account, remote Hyperdrive, or production Cron deployment is verified. |
| Netlify scheduled function | Set `NOVA_BACKGROUND_SCHEDULER=netlify` for Builds and Functions, and set the public origin and tick secret for Functions. Publish Production. The committed local build plugin selects `netlify/entrypoints/with-netlify-cron`, which wraps the same NOVA adapter and declares the five-minute schedule. | Check Functions for the Scheduled badge, invoke Run now, and inspect function logs plus the NOVA tick result. Netlify's local dev invocation does not run the schedule cadence; scheduled functions have a 30-second limit. |
| Vercel Cron | Set `NOVA_BACKGROUND_SCHEDULER=vercel`, the tick secret and separate `CRON_SECRET` in Vercel's Production environment, then deploy Production. `vercel.ts` registers the Cron only when the selector equals `vercel`. | Check Project → Settings → Cron Jobs and invocation logs, plus NOVA's tick result. Vercel Hobby cannot meet the five-minute cadence; use Supabase Cron on that plan. Vercel delivery is best effort. |
| Supabase Cron | Set `NOVA_BACKGROUND_SCHEDULER=supabase` in the API host before deploying. Cloudflare applies the no-Cron Wrangler config; Vercel's `vercel.ts` emits no Vercel Cron; Netlify's build plugin selects the API-only function directory. After the API is ready, run `bun run supabase:scheduler` from the trusted operator computer. It confirms the project ref, reads the tick secret from private setup values, and asks for the deployed HTTPS origin if needed. | The command creates NOVA's named `pg_cron`/`pg_net` request and stores URL/secret in Supabase Vault; it does not deploy NOVA code. Cron success only means the HTTP request was queued. Check `cron.job_run_details` and `net._http_response`; require an HTTP 2xx, `timed_out=false`, and no `error_msg`, then inspect the response/API logs for tick completion and notification errors. Never place the management token on GitHub or the runtime host; the prompt does not save it to `.env`. |
| VPS/local worker | The supported Compose setup sets `NOVA_BACKGROUND_SCHEDULER=vps` and starts one `maintenance` service. The user runs the documented bootstrap/upgrade; no third-party scheduler account is involved. | Check that exactly one maintenance service is running, inspect its logs, and confirm `/api/ready` reports `vps`; do not also enable a cloud scheduler for that database. |

`/api/health` and `/api/ready` are read-only probes. Readiness verifies core
schema/runtime configuration; it does not read the migration-owner ledger,
inspect provider account settings, or prove a live scheduled invocation.
Preview/staging deployments must use a separate database or have scheduling
disabled.

## Current validation boundary

- Unit tests cover every supported host/scheduler combination, the concrete
  repository/provider actions, phase ordering (prepare before deploy, Supabase
  job creation after readiness), and reject unsupported combinations. The
  rendered-flow smoke covers all eight valid pairings, the customer-action vs.
  provider-effect map, offline health failure, and command reveal only after a
  successful health/readiness/scheduler check.
- The local browser previously loaded the deployment route and its five
  deployment-shape choices. The updated all-pairing rendered-flow smoke
  exercises the real `app.js` with controlled readiness responses: it confirms
  the Supabase creation command is absent before readiness and after a network
  failure, and appears only when health, database readiness, and
  `scheduler=supabase` all pass. This is a UI contract test, not a live API or
  provider-account operation.
- No live Cloudflare, Netlify, Vercel, or customer VPS account was deployed in
  this pass. The local Workerd database-backed tick and scheduled-handler
  execution now pass, but this does not prove remote Hyperdrive, hosted deploy,
  or provider Cron operation. A 100-employee Workerd-local-direct stress run hit
  PostgreSQL's default connection ceiling because local Hyperdrive emulation
  skips pooling; the normal bounded Node-pool burst passes separately. The
  Hyperdrive origin pool must be budgeted against the managed database before
  a comparable hosted burst can be claimed.
- Selecting a path in the UI is deliberately not reported as a remote provider
  change. The provider-specific steps explain the actual repo/deploy command or
  operator command; responsive/accessibility review and hosted deployments are
  still open. The rendered smoke also checks that each valid host/scheduler
  pairing shows where database, runtime, domain/email, and scheduler changes
  are applied.

## Provider behavior references

The provider handoff is based on the providers' current documentation:

- [Cloudflare Workers Builds](https://developers.cloudflare.com/workers/ci-cd/builds/) deploys connected branches; its [build configuration](https://developers.cloudflare.com/workers/ci-cd/builds/configuration/) lets the operator choose a deploy command and runtime secrets/variables.
- [Cloudflare Cron Triggers](https://developers.cloudflare.com/workers/configuration/cron-triggers/) are driven by Wrangler configuration and can take up to 15 minutes to propagate after a trigger change; allow that interval before treating an empty invocation history as a failed deploy.
- [Netlify Scheduled Functions](https://docs.netlify.com/build/functions/scheduled-functions/) run on published deploys, support manual Run now checks, and have a 30-second execution limit.
- [Vercel Cron usage and pricing](https://vercel.com/docs/cron-jobs/usage-and-pricing) documents plan cadence; Hobby is once per day, so it cannot meet NOVA's five-minute maintenance cadence.
- [Supabase Cron](https://supabase.com/docs/guides/cron) stores jobs in PostgreSQL and supports HTTP jobs; NOVA's operator command creates the named job and vault-backed request secrets.
- [Cloudflare Hyperdrive with Supabase](https://developers.cloudflare.com/hyperdrive/examples/connect-to-postgres/postgres-database-providers/supabase/) uses the Supabase Direct connection; Hyperdrive supplies pooling, so do not pass it the transaction-pooler URL used by Node hosts.
- [Hyperdrive local development](https://developers.cloudflare.com/hyperdrive/configuration/local-development/) bypasses pooling when using `CLOUDFLARE_HYPERDRIVE_LOCAL_CONNECTION_STRING_*`; [pool tuning](https://developers.cloudflare.com/hyperdrive/configuration/tune-connection-pool/) is the production control for database-origin connections.
