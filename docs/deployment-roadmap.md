# NOVA customer deployment and update roadmap

- **Status:** decision record and implementation roadmap
- **Review basis (live check captured 2026-10-13):** Netlify published docs commit `26785bbefc1dd4ea6a4df45b6f73fd441bf47e99` as deploy `6acbd2ae3484ca00084163b4`, over application source `b51edc9`. The isolated Cloudflare candidate is Ready at version `c8ad983a-27ad-43ee-bd18-79088a17d5ca`, deployed from repository commit `58572f5a47bef0f664e04258f42a72fe73ade61c`; its application paths match Netlify's source. A signed-in Super Admin loaded My Day, Work, People, Organisation settings, and People and access through Hyperdrive to disposable Supabase data, without changing records or settings. The candidate has a public `workers.dev` URL, no customer domain or Cron, and leaves Supabase as scheduler owner. Stable tags `v0.1.3`–`v0.1.5` are published; a full-history `v0.1.3` clone finds `v0.1.5`. The QA reference `owfgvojdaxafayutbcuf` is confirmed by the dashboard, the QA database URL, and a successful read-only Management API query. The user-supplied active `ghl` token returned HTTP 200 for `SELECT 1` and for the updater's exact ledger reads; the project has 80 ledger rows through `0080_background_tick_single_flight.sql`. The token has broad project permissions and was used for this probe without being persisted; `.env.qa-supabase` still has no token. Root `.env` retains a different stale token and a database URL for another project. No database write was performed. The full `nova:update --plan`, migration apply, and recovery workflow remain open. Current-source local PostgreSQL tests include 200 employees; hosted first install, safe production promotion/rollback, and hosted 100/200-user capacity remain open. See the [performance checklist](performance-investigation-checklist.md).
- **Credential clarification (read-only recheck, 2026-10-13):** The user-supplied `ghl` token matches the active, unexpired dashboard token scoped to `novaa` / project `owfgvojdaxafayutbcuf`. The dashboard shows broad write permissions. A one-time request to Supabase's read-only query endpoint returned HTTP 200 for `SELECT 1`; the updater's exact schema and migration-ledger reads also returned HTTP 200, with 80 rows through `0080_background_tick_single_flight.sql`. This confirms the project reference, token acceptance, Database Read access, and current ledger visibility. It does not verify the full updater `--plan`, migration apply permissions, or recovery behavior. Root `.env` still contains a different old token and a database URL for project `hrlvvietbqvkdovulzcie`; `.env.qa-supabase` has the correct target database URL but no management token. The supplied credential was not saved locally. No database write was performed.
- **Historical matched hosted speed evidence (application source `9a97dc9`):** Ten serial database-backed `/api/ready` requests per host returned 200 after one excluded warm-up. Netlify p50 / largest observed total was 524.1 / 565.6 ms (`nova-app` 170.7 / 170.9 ms); Cloudflare was 319.2 / 402.4 ms (`nova-app` 43.5 / 125.0 ms). This small anonymous readiness sample did not isolate provider/database causes and is not an authenticated route distribution or capacity test. It is obsolete for comparing current hosting because it predates the current Netlify application source `b51edc9` and the Cloudflare candidate whose application paths now match that source. The 13 October samples are current but uneven and too small to establish a provider winner; see the [performance checklist](performance-investigation-checklist.md).
- **Repository delivery rule:** work on `main`; push only to `origin/main`.
- **Most recent verified deployment (2026-10-13):** Netlify deploy
  `6acbd2ae3484ca00084163b4` serves application source `b51edc9`. The later
  documentation-only readiness updates were pushed to `origin/main`, but
  their Netlify deployment has not been verified because the dashboard
  currently reports a connection error. The Cloudflare candidate version is
  `c8ad983a-27ad-43ee-bd18-79088a17d5ca`, from repository commit `58572f5`;
  candidate and Netlify application paths match. The QA project ref is
  confirmed by the dashboard, matching QA database URL, and successful
  read-only Management API probe with the user-supplied token. Its exact
  updater ledger queries returned 80 rows through migration 0080. The token
  has broad project permissions and was not persisted; `.env.qa-supabase`
  still has no token. The root `.env` token and database URL point elsewhere.
  No database write was performed. Full updater plan/apply and recovery remain
  unverified. See the
  [verification matrix](verification-matrix.md) and
  [performance checklist](performance-investigation-checklist.md).

This is the single customer-facing deployment decision and sequencing document.
The detailed operational requirements remain in the linked deployment-manager,
profile, and updater plans. Update this summary when those contracts change.

## The customer outcome

A small business can fork NOVA, choose one supported stack, deploy it without
hand-editing application code, and later take upstream releases while keeping
its own committed customizations and production data. If its hosting needs
change, it can move the API runtime while deliberately retaining or migrating
the database, scheduler, public origin, and secrets. The local operator tool
shows which steps are automatic, which require account access, and what remains
unverified. A Git push alone is never reported as a completed infrastructure
or database update.

## Decisions to keep stable

1. **Offer three deployment profiles only.** Keep the combinations tested and
   documented as cohesive profiles rather than a matrix of every provider
   permutation.
2. **Keep the self-hosted path first-class.** Docker, PostgreSQL, and Nginx
   remain a supported path for customers who operate their own always-on host.
3. **Keep the API portable.** The current Node/PostgreSQL service is shared by
   the hosted adapters. A Supabase Edge Functions port is not implied by using
   Supabase PostgreSQL and is not a supported runtime until auth, database,
   migrations, scheduler, and load behavior have parity tests.
4. **Separate the updater from deployment orchestration.** `nova:update`
   stages source and schema upgrades. `nova:deployment` inspects or changes
   infrastructure. Neither is an application feature or a browser admin
   screen.
5. **Treat infrastructure dimensions as separate resources.** A plan names
   source release, API runtime, PostgreSQL target, scheduler, secrets, public
   hostname/TLS, and deployment state. Changing one does not silently change
   another.
6. **Default to guided operation when provider APIs cannot prove state.** Do
   not infer success from a config file, accepted API request, Git push, or
   incomplete inventory. Keep mutations disabled until a specific transition
   has safe preconditions, read-after-write verification, recovery behavior,
   and a disposable live rehearsal.
7. **Keep NOVA repository delivery on `main` → `origin/main`.** Customer forks
   and their selected deployment branch are separate from this maintainer rule.

## The supported profiles

| Profile | API and web hosting | Database | Background schedule | Current boundary |
| --- | --- | --- | --- | --- |
| Netlify + Supabase | Netlify Functions | Supabase PostgreSQL | Supabase Cron | New installs use Supabase Cron; the legacy Netlify schedule remains selectable. Pinned offline production packaging checks cover both function bundles. Confirm the customer's plan supports the required Build and Functions variable scopes; Netlify's API documentation currently describes granular scopes as Pro and above. |
| Cloudflare + Supabase | Cloudflare Worker with Hyperdrive | Supabase PostgreSQL | Supabase Cron | The isolated public candidate is Ready at version `c8ad983a-27ad-43ee-bd18-79088a17d5ca`, deployed from commit `58572f5`; its application paths match Netlify source `b51edc9`. It uses restricted `nova_app` and cache-disabled Hyperdrive to disposable data. Signed-in My Day, Work, People, Organisation settings, and People and access pages loaded. It has no customer domain or Cloudflare Cron. This is not a clean first install or production runtime move. |
| Self-hosted Docker + PostgreSQL | Docker services behind customer-managed Nginx/TLS | PostgreSQL 17 in Compose by default | One Compose maintenance worker | Isolated first install through loopback Nginx, founder verification, workspace bootstrap, authenticated office creation/readback, health/readiness, and one worker tick passed. Nginx now preserves non-default ports in the forwarded host. Remote internet-facing host/TLS and automated Nginx orchestration are not implemented. |

Vercel and native Netlify/Cloudflare schedules remain compatibility adapters
for existing deployments, not additional new-customer profiles. Other
PostgreSQL services require an explicit compatibility and recovery rehearsal;
"PostgreSQL-compatible" alone is not a support claim. The detailed boundaries
are in [deployment profiles](deployment-profiles.md).

## What exists today

| Capability | Verified state in this checkout | What that means for a customer |
| --- | --- | --- |
| Shared API/runtime adapters | The same server API is adapted for Netlify, Cloudflare, Vercel, and VPS/Docker. | The code has portability seams; that does not mean every transition is automated. |
| Initial setup | Local Docker setup, Supabase bootstrap, direct PostgreSQL setup, migrations, and scheduler commands exist. | The deployment guide is secret-free. The operator creates/configures provider resources and enters secrets in the provider's private settings. |
| Netlify function packaging | The build plugin selects the API-only bundle for Supabase Cron and includes the scheduled tick only for the legacy Netlify Cron selection. Work reads are split into six grant-filtered areas, and this deployment independently loads My Day attendance, assignments, and timeline. The current Netlify deploy serves docs commit `26785bb` as deploy `6acbd2ae3484ca00084163b4`; its application source is `b51edc9`. Authenticated Super Admin pages were checked on the source-matched isolated Cloudflare candidate. | The 13 October readiness samples are anonymous and uneven. They do not provide authenticated route distributions, navigation-to-interactive timings, a browser request waterfall, or hosted capacity evidence. |
| Cloudflare Worker packaging | Cloudflare typecheck and Wrangler dry-run passed; candidate version `c8ad983a-27ad-43ee-bd18-79088a17d5ca` is Ready from repository commit `58572f5` and its application paths match Netlify source `b51edc9`. A signed-in Super Admin loaded Work, My Day, People, Organisation settings, and People and access through Hyperdrive. The candidate has no customer domain or Cron and remains on disposable Supabase data with Supabase scheduler ownership. | This proves a source-matched candidate runtime path and selected authenticated pages, not a clean first install, complete workflow or accessibility journey, production promotion/rollback, a deployment-manager apply, or hosted capacity. The candidate is public and must remain connected only to disposable data. |
| Database schema upgrades | Current `main` was rerun through Debian WSL2 Docker against a fresh PostgreSQL 17 database: all 80 migrations, restricted-role preflight, 2,433 lifecycle assertions, attendance/WFH/leave/geofence checks, full dump/restore, and the `0072→0080` updater rehearsal passed. The disposable Supabase project's migration `0080` remains separately checksum-verified, with lease-table RLS and restricted RPC access. A read-only live check found one active named Cron job; its five latest runs succeeded and matching `net._http_response` rows returned HTTP 200 without timeout on 13 October. | The WSL run uses local direct PostgreSQL and is not a hosted-load result. Scheduler evidence covers this selected Supabase project, not every possible external trigger. Supabase provisioning and populated-database transfers remain separate work. |
| Customer updater | `nova:update` discovers published stable releases and stages a pinned release in an isolated candidate. A full-history clone at `v0.1.3` found `v0.1.5` with `--check`. The source-only rehearsal preserved a committed customer change in the `v0.1.5` candidate and left the source checkout unchanged. The full local updater suite passes 73 tests and 290 assertions, including recovery, target binding, migration failure and push-consent behavior. | The database plan is not proven. The 403 came from a PAT whose bound projects were deleted; the QA project ref itself is correct. A separate target-scoped token exists in the signed-in account, but it has broad write permissions and is not configured in the QA environment. Local DNS prevented a fresh request, so use a narrowly scoped token and verify read-only planning before any writes. A push alone does not prove deployment readiness. First adoption by an older clone still requires a reviewed baseline merge. |
| Deployment manager | `nova:deployment` has local status/doctor, optional scoped read-only provider inventory, protected runtime identity, migration-ledger comparison, immutable plans, re-verification, and a plan-bound journal library. An explicit `--env-file` also selects the Docker Compose project inspected by local status. Interactive remote status/plan/verify prompts with masked input for missing credentials only when the corresponding target ID is configured; credentials stay in memory. JSON and non-interactive commands do not prompt. New plans offer only Netlify, Cloudflare, and self-hosted Docker; Vercel remains a legacy adapter. Cloudflare candidate inventory reads the selected Worker’s immutable ID, preview-URL setting, worker-specific Access policy, overlapping Access applications, and public overrides. Missing, broad, or incomplete protection blocks the candidate step. Its local contract suite passes 96 tests and 429 assertions. | Plans and diagnostics work; `apply`, operation resume/rollback, project provisioning, and provider mutations are not implemented. A verified access boundary does not enable candidate upload until a journaled executor and recovery rehearsal exist. |
| Provider inventory | Netlify site/deploy, selected Cloudflare Worker/Hyperdrive/domains/routes/DNS and candidate Access metadata, selected Supabase database jobs/migrations, and partial Vercel data can be inspected when correctly scoped credentials are selected. Cloudflare plans verify the Hyperdrive project and `nova_app` role without retaining connection fields. Remote plan and verify commands also probe unauthenticated `/api/ready` at the protected live origin and bind that result into the snapshot. | It covers selected resources, not an entire customer account or every trigger that could call the database. Inventory proves declared Hyperdrive configuration identity; the live disposable Worker connectivity was established separately through the candidate `/api/ready` check. Candidate Access inventory fails closed when any relevant app, policy, or higher-priority public destination cannot be verified; it stores no identity values. The public probe confirms only the currently routed service, not a future candidate. Missing permissions, unhealthy readiness, or incomplete scope must block a transition. |
| Release availability | Tags `v0.1.3`, `v0.1.4`, and `v0.1.5` point to `a957cd4`, `50b4b6e`, and `4a85727`; exact-tag verification passed and all three stable releases are published with source commits recorded. `0.1.4` requires `0.1.3` and adds no SQL migrations; `0.1.5` adds no SQL migrations. A full-history clone at `v0.1.3` discovers `v0.1.5`; a source-only rehearsal preserved a committed customer customization. | The actual database plan remains blocked by Management API 403, so migration and end-to-end update are not verified. The previous local token was bound to deleted projects; the correct project's token exists in the account but is not configured in `.env.qa-supabase`. The rehearsal does not cover the one-time baseline merge required by clones older than `v0.1.3`. |
| Cleanup | The isolated Select proof-of-concept files were removed in `321e997`. No other tracked artifact was proven unused in this review. | Keep migration history, tests, compatibility adapters, provider examples, and operational scripts; do not delete them merely to shrink the repository. |

## Customer workflows we must support

### 1. First install from a fork

1. The customer forks/clones NOVA and selects one of the three profiles.
2. The guide lists required repository files, external account steps, secret
   names, and verification commands for only that profile.
3. The operator provisions or selects PostgreSQL, runs the supported setup and
   migrations from a trusted local machine, then enters runtime credentials in
   the selected host's private settings.
4. The operator configures the canonical HTTPS origin and verifies health,
   readiness, sign-in, one representative write, and one background tick.
5. Only after the selected database and runtime are ready does the operator
   activate the one recommended scheduler and verify one successful tick.

GitHub integration builds committed code and configuration. It does not create
the database, apply a migration, copy secrets, set DNS/TLS, or create Cron.
Provider owner keys and database migration credentials stay on the operator's
machine and never enter the employee-facing app or browser assistant.

### 2. Update an existing customer fork

1. Maintainers publish an immutable stable baseline release whose package
   version and release manifest match its tag/commit.
2. Maintainers publish a strictly newer stable release with its matching
   migration manifest and upgrade notes. The updater must find both releases
   through the canonical GitHub Releases API; tags without Release records are
   insufficient.
3. An older customer clone performs one reviewed local merge of the updater
   baseline. The updater then stages the newer release against the customer's
   commits in an isolated worktree and stops for conflict review or unsupported
   Git states; it never resets, cleans, force-pushes, or switches a remote.
4. It binds the plan to the exact release SHA and selected database identity,
   validates the migration ledger/checksums, requires a recent restorable
   backup attestation, and applies only canonical pending migrations.
5. It verifies the restricted application role and schema. A source push to
   the customer's explicitly confirmed fork/branch is a separate choice.
6. The customer checks the host build and `/api/health` and `/api/ready`
   separately. When the protected identity endpoint is configured, exact commit
   identity can be checked too. A code rollback does not reverse a migration.

The release discovery gate is open: updater-bearing `v0.1.3` at `a957cd4` and
successors `v0.1.4` and `v0.1.5` are immutable, verified releases on `main`.
An earlier reviewed Netlify deploy served docs commit `67cc738` as deploy
`6acbb03be89cc000083d01f7` over application source `9a97dc9`. Verify #148
passed for the `v0.1.5` tagged source. A full-history `v0.1.3` customer clone
now finds `v0.1.5` with `bun run nova:update --check`. A source-only rehearsal
cloned `v0.1.3`, added a synthetic customer commit, and prepared a pinned
`v0.1.5` candidate with exactly those two parents; the note remained intact and
the source checkout stayed clean. The initial `--plan` stopped at HTTP 403 on
the legacy `database/query` ledger read using the obsolete root token, whose
project access had been removed. A later one-time probe with the user-supplied
active target token returned HTTP 200 for the updater's exact read-only schema
and ledger queries, confirming 80 rows through migration 0080. The token was
not saved locally. The full updater `--plan` still needs a customer-clone
rehearsal; apply needs Database Migrations Read-write and may need Database
Read-write for checksum repair. See [the endpoint permission
requirements](https://supabase.com/docs/reference/api/v1-read-only-query).
Then verify planning before candidate build, push, and hosted verification.
Older pre-updater clone
bootstrap, database target refusal, migration failure/retry, declined push,
and hosted failure/recovery still need end-to-end rehearsal. Do not describe
the updater as generally available until those remaining cases pass. Maintainer
release work is governed by
[update manager](update-manager.md) and its
[implementation plan](update-manager-plan.md).

### 3. Move API hosting while keeping the database

First transition to automate is **Netlify → Cloudflare while keeping the same
Supabase PostgreSQL project, canonical origin, and Supabase Cron**. Build and
verify a candidate Cloudflare Worker with Hyperdrive, required bindings,
matching database fingerprint, current migration head, protected runtime
identity, public TLS, and readiness before routing traffic. Keep Netlify
available as rollback until the Cloudflare route and next scheduled tick pass.

If the current install uses Netlify Cron, do not combine scheduler and runtime
changes into one cutover. First perform a separate, verified handover to
Supabase Cron: inspect the selected Netlify site's production schedule and
both Build and Functions scheduler-selector settings; deploy Netlify with its
native schedule omitted and selector set to Supabase; prove the old trigger is
absent; create exactly one Supabase job; and verify its first successful
`pg_net` response. Then prepare the Cloudflare runtime move with Cloudflare
Cron absent. The read-only planner models this sequence when those exact
source/target conditions are verified. Execution remains guided because the
manager has no provider write executor.

Changing only the API host must preserve `BETTER_AUTH_SECRET`,
`NOVA_SECRETS_ENCRYPTION_KEY`, the background-job secret, database identity,
session behavior, and public auth origin. If the public origin changes, update
auth/Cron configuration deliberately and re-test. A selected provider API
inventory cannot prove that unselected accounts or external triggers are
empty; the operator must review and confirm the complete NOVA footprint.

### 4. Move PostgreSQL or switch to self-hosted infrastructure

Creating a new empty schema, upgrading the current schema, and copying a
populated database are three separate operations. Database moves stay guided
until NOVA has a global write-maintenance gate, request/tick drain, tested
backup and restore, row-level and sequence comparison, RLS/auth/session and
encrypted-secret verification, cutover/rollback rehearsal, and precise source
retention. Preserve the auth/encryption keys or run a deliberate, tested
re-encryption flow. Never call a database change "just a connection string."

Self-hosted Docker remains available for new installs. Moving an already
populated hosted business into a customer's Docker/PostgreSQL/Nginx server uses
the database-move gates above; it is not the same as a fresh Compose install.
External-host automation needs an authenticated, restricted management path
before the CLI can change remote services or Nginx.

## Implementation order and exit gates

### Phase A — Make customer release updates real

- Confirm stable release/version policy, starting-version support, migration
  classes, and release notes contract.
- Use the updater-bearing `v0.1.3` tag at `a957cd4` as the baseline, then
  verify `v0.1.4` at `50b4b6e`, whose minimum supported starting version is
  `0.1.3`, and no-schema-change `v0.1.5` at `4a85727`.
  All three tags passed full verification and are published. A full-history
  customer clone now discovers `v0.1.5`; database planning remains unverified.
  The earlier Management API 403 used the obsolete root PAT. A target-scoped
  account token appears active in the dashboard, but it is not configured in
  QA and no CLI request used it; local DNS blocked the latest root-token
  attempt before HTTP. Verify its read-only project access before proceeding.
- Rehearse a later stable release against disposable Supabase and direct
  PostgreSQL targets, including fork commits/conflicts, wrong database,
  migration failure/retry, backup recovery, denied Git push, and host build
  failure. Then publish a strictly newer stable release.
- Keep customer guidance explicit about first-adoption merge, DB migration,
  optional push, host deployment, and readiness as separate states.

**Exit:** a fresh supported customer clone and a fork with committed
customizations can update from the published baseline to the later release
without losing files, applying an unknown migration, or claiming a failed host
deployment succeeded.

### Phase B — Finish trustworthy read-only topology plans

- Inventory exactly the resources that can call the selected NOVA database;
  require the operator's scheduler-scope attestation and treat it as an
  attestation, not proof that unseen accounts are empty.
- Complete the Netlify scheduler selector check for both build and function
  scopes; validate the exact NOVA schedule identity and detect duplicates.
- Keep Vercel schedule state partial unless a reliable active/disabled read is
  available. Keep VPS schedule state partial until externally inspected.
- Bind plans to checkout SHA/cleanliness, provider resource IDs, database
  fingerprint, migration head/checksums, active trigger IDs, origin, domain,
  and expiry; re-read these facts before any future write.
- Keep secrets out of saved state and diagnostics. Inventory names/types and
  presence only, except allowlisted non-secret selectors.

**Exit:** a stale, incomplete, cross-project, duplicate-trigger, mismatched
selector, missing-secret, missing-permission, or unverified-domain plan fails
closed with a direct next step; `apply` remains disabled.

### Phase C — Rehearse and automate one same-database runtime move

- Implement the separate Netlify Cron → Supabase Cron stage where needed.
- Add least-privilege Netlify/Cloudflare write adapters and journaled
  candidate deploy, readback, route promotion, and recovery for the exact
  Netlify → Cloudflare transition.
- Use Supabase Cron and retain the database; never provision or copy a DB in
  this flow. Candidate checks are non-mutating or run against isolated
  resources.
- Inject provider timeout, duplicate schedule, stale plan, wrong binding,
  wrong DB fingerprint, late build, TLS/DNS delay, auth-origin mismatch, crash
  between writes, and rollback failure before enabling this one `apply` path.

**Exit:** disposable-provider rehearsal proves exact candidate SHA, database
identity, migration state, runtime readiness, domain/TLS, exactly one
successful scheduler, recoverable failures, and verified rollback. Other
transitions remain guided.

### Phase D — Keep Docker fully supported; automate it only with evidence

- Test fresh Compose install and update on Windows/WSL, Linux, and macOS where
  claimed; preserve named data volumes and ensure only one maintenance worker
  is active.
- Provide verified Nginx/TLS and backup/restore runbooks before advertising a
  public VPS path as turnkey.
- Add remote-host automation only after a restricted host identity and
  credential model, health readback, interruption recovery, and disposable
  VPS rehearsal exist.

### Phase E — Database transfer (separately gated)

- Implement the global maintenance/write gate and drain semantics first.
- Rehearse restore and application-level equivalence on disposable PostgreSQL
  17 targets before one specific source/target pair can be automated.
- Keep target provisioning, data copy, schema upgrade, runtime switch,
  scheduler switch, DNS change, and source cleanup as separate reviewed
  journal stages. Never delete the source automatically after cutover.

## Capacity and commercial assumptions to validate

Use a 100-employee deployment as the initial qualification target, not as a
provider-free-tier guarantee. The current planning workload assumes 10 task
submissions per employee per workday and 22 workdays/month: about 22,000 task
submissions and 66,000–132,000 total API requests per month at 100 employees.
The doubled 200-employee case is about 44,000 task submissions and 132,000–
264,000 total API requests. A five-minute background cadence is 8,640 ticks in
a 30-day month at either size. These are estimates, not observed NOVA load.

Run representative load tests and measure p95 API/database latency, database
connection headroom, runtime CPU/duration, egress, and scheduled work before
promising capacity. Plan for paid provider tiers above the initial ~100-user
qualification point as the default operating expectation, while making tier
changes based on measured usage and provider quotas as well as employee count.
Do not claim the free tiers will support a 100-person company until a real
benchmark, current quota review, and the Netlify Build/Functions-scope
requirement support that claim. Check Netlify's current
[environment-variable API contract](https://open-api.netlify.com/) when setting
the minimum supported plan; the API describes granular scopes as Pro and above.

## Cleanup and repository policy

Keep only removals supported by evidence of being unused across imports,
builds, scripts, deployment entry points, migrations, docs, and tests. The
Select proof-of-concept removal is already complete. Do not remove migration
history, compatibility adapters used by existing installs, verification code,
deployment examples, or operator runbooks just to reduce file count. Do not
add a second abstraction when the existing deployment adapters or release
manifest can own the behavior. Every implementation phase must run its focused
suite plus the repository-required checks before it is called complete.

## Detailed references

- [Deployment profiles and operational contracts](deployment-profiles.md)
- [Deployment manager design, risks, provider capabilities, and full test matrix](deployment-orchestrator-plan.md)
- [Updater customer guide and current release availability](update-manager.md)
- [Updater implementation plan and edge-case matrix](update-manager-plan.md)
- [Runtime smoke-test matrix](runtime-smoke.md)
- [Verification matrix](verification-matrix.md)
