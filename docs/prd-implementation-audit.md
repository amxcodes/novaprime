# NOVA PRD implementation audit

This is a source-of-truth audit of the current repository against `NOVA PRD.md`.
It records gaps that affect a real daily deployment or a customer installing
NOVA; it does not replace the PRD.

## Current verified state (PRD v2.02; evidence snapshot 2026-09-26)

The canonical background tick, office-local attendance/work closure, portable
PostgreSQL security model, provider-neutral email boundary, deployment adapters,
and Better Auth rate-limit table remain in place. Host-local checks pass: 116
unit tests/493 assertions, API and Cloudflare typechecks, server build, browser
script syntax, and the strict QA/smoke-script typecheck. The rendered deployment
assistant test verifies provider wiring and readiness-gated Supabase Cron
activation. Adapter tests use a
local Bun harness; they do not prove a deployed Cloudflare runtime or hosted
Cron Trigger. Wrangler 4.141.0 dry-run and local `workerd` runtime smoke now
pass (including the database-backed protected tick/scheduled handler and Gmail
API MIME composition); this is not a deployed Cloudflare or real Hyperdrive
test. A 100-employee local request-scoped burst exceeded PostgreSQL's default
connection limit because Wrangler local bypasses Hyperdrive pooling; that real
provider pool load remains unverified. Supabase setup now reads the exact transaction-pooler host from
the Management API instead of guessing `aws-0` from region; explicit project
selection overrides the saved default.

The latest clean PostgreSQL 17 WSL run applied migrations 0001–0074, passed all
53 rollback/RLS fixtures, the 604-assertion default lifecycle and specialized
WFH/attendance/leave/geofence smoke, and returned `ready` from application-role
preflight. The 100-synthetic-employee burst passed with 2,414 lifecycle
assertions and 100 tasks, assignments, and closed timers (zero open timers).
It includes synthetic Gmail OAuth checks for PKCE, origin binding,
one-time/expired state and encrypted credential preservation. The latest burst
measured p95 at 2,808.3 ms for work-context reads, 497.0 ms for task
creation/self-assignment, 665.1 ms for timer start, 301.8 ms for timer stop,
and 286.7 ms for assignment reads. HTTPS email-runtime and mocked provider
checks also pass; this remains a one-shot burst, not a sustained capacity or
soak result. The runner removed its exact generated database and label-matched
Docker resources; the shared `nova` database and volume were not used.

Billing remains an automatic backend classification, not a task-creator or
catalog-author choice. Organisation tasks are non-billable. Every client
workstream has a required default plus optional per-definition rules scoped to
that workstream. Only a role with `workstreams.billing_policy.manage` can
change those rules; catalog permissions alone cannot. `tasks.create.billable`
remains a separate permission for creating work NOVA has already classified
as billable. A missing default fails closed, and policy changes are audited,
revision-checked and future-only. Migration 0073 recorded old per-definition
state in audit history; migration 0074 restores the latest active rules and
reset-to-inherit revisions. The 0072-to-0074 upgrade rehearsal verified this
restoration. Current smoke covers caller class-input rejection, canonical
routes, policy defaults/rules, reset-to-inherit, future-only snapshots,
policy/task-create serialization, and coherent provenance.

A correction is a separate linked work item for repairing completed work; it is
not a billing class, adjustment, or edit/reopen of its source. It uses its own
selected definition's rule or the workstream default—not correction purpose or
source history—and retains independent assignment/review/timer/audit history.
The local gate covers source visibility/completion, same-workstream scope,
no-nesting, multiple corrections, exact retry, immutable source history, and
independent billable-action authorization. Approved tasks cannot be cancelled
through the ordinary task API; no historical reclassification is implied by a
correction.

Migration 0066 adds a role-scoped due-date edit that compares the date and
monotonic revision, rejects stale and terminal-task edits, audits changes,
expires old due notices, cancels queued/leased email, and notifies current
assignees using the existing in-app/opt-in-email path. The notification tick
skips tasks locked by an edit and reminder idempotency includes the revision;
the mail worker checks the current lease immediately before sending. A
PostgreSQL rollback fixture and authenticated lifecycle cover the stale-message
and edit-vs-scheduler paths. The authenticated Admin browser also saved a due
date on a synthetic task and showed the corresponding audit record; assigned-
employee notification and broader date-boundary browser paths remain untested.

A fresh customer-style Docker Compose deployment against isolated direct
PostgreSQL applied migrations 0001–0074. Health/readiness, the home page and
shared `app.js` asset returned 200; `nova_app` was non-superuser,
non-BYPASSRLS, non-createdb and non-createrole. Invalid and unselected-provider
tick requests returned 401/409; the selected local `vps` tick returned 200.
The disposable container, network, volume and synthetic founder were removed.
The browser exercised Cloudflare+Supabase, Netlify+Supabase, Vercel+Supabase,
and direct PostgreSQL/VPS choices with their scheduler options. Setup, sign-in,
forgot-password and reset-password screens rendered; earlier authenticated
browser runs covered manual invitation/verification/onboarding, role
create/edit/reopen, billing-policy/task creation, eligible assignment with a
separate reviewer, and due-date editing. This run additionally completed
synthetic founder setup, public-origin capture, verification request and
one-time verification handoff reveal and consumption; subsequent sign-in showed
the founder as verified. With email still unconfigured, Forgot password returned
the neutral response, an authorized Super Admin revealed the reset handoff, the
reset page removed the token from the address bar, and the new password signed
in while the old password was rejected. Employee-originated task/timer/
submission, reviewer decision/handover, correction creation and broader Work/HR
journeys remain untested.

The designated disposable Supabase project has migrations 0001–0074 verified.
In this pass the exact transaction-pooler host was read from the Management API;
a read-only login confirmed `nova_app` is neither superuser nor BYPASSRLS;
deployment preflight returned `ready`; health/readiness returned 200; an
invalid tick secret returned 401 without executing the job; and four failed
sign-ins for a random `.invalid` identity returned `401, 401, 401, 429` through
the database-backed limiter. Full authenticated Cloud domain lifecycle and a
live scheduler were not run. No live Cloudflare, Netlify, Vercel or VPS
deployment, native-Windows PostgreSQL run or sustained multi-office/50–100-
person load test is claimed; the 100-employee run was a single bounded burst.

The secret-free browser deployment assistant at `/?view=deploy` remains an
operator checklist, with read-only same-origin health/schema probes, not a
provider installer or end-to-end readiness engine. Local browser testing
verified host/scheduler selection but did not mutate provider state. The
employee Work API discovers creation targets through effective scoped
permissions, and the Work/Today/Admin views are present in the browser source.
The authenticated browser evidence covers setup, manual invitation, secure
handoff, verification/onboarding, role editing, task/billing administration
and due-date editing; it does not cover full employee-originated Work/HR
journeys. Existing setup/deployment/auth screens are functional but
text-heavy; visual-system, accessibility and responsive QA remain. The
strengthened deployment preflight and `/api/ready` returned ready in the
isolated PostgreSQL run.

PRD v2.02 defines the permission-controlled task catalog and automatic billing
classification. Migrations 0063 and 0069–0074 implement `billable` and
`non_billable`, a client-workstream default, and optional per-definition rules.
Catalog definitions remain content-only; `workstreams.billing_policy.manage`
controls policy, while `tasks.create.billable` separately authorizes work NOVA
has already classified as billable. Migration 0073 records prior per-definition
state; 0074 restores it in the canonical rules table. A correction describes
separate work and uses its own definition rule/default; it cannot change or
copy the source task's old class. Migrations 0068–0074 implement catalog
definitions/proposals, immutable class provenance, policy revisions,
fail-closed setup, rule-state restoration, and independent correction linkage.
Migration 0064 implements
pending-WFH provisional attendance; approval, rejection, cancellation,
freeze/offboard and office-local boundary paths now pass local PostgreSQL/API
smokes. A concurrent rejection-versus-cancel race produced one winner, one
expected conflict and one final decision audit event; sequential approval/cancel
and cancel/review loser paths also pass. A new simultaneous approval-versus-
cancel test with a separate synthetic worker, live provisional attendance and a
running assigned-task timer passed; approval won, cancellation conflicted, one
decision event persisted, and promoted attendance plus the active timer were
verified before explicit cleanup. Proposals/review and billing provenance are
implemented and locally verified; post-creation reclassification is not part
of the ordinary application flow.

The role editor now offers Employee, HR, Supervisor, Admin and Client
Coordinator profiles as client-side draft conveniences. The resolver checks
each permission/scope against the current API catalogue, never invents target
IDs or widens unsupported scopes, and discloses omitted entries. Applying a
profile does not persist a template; saving continues through the current
role-create authorization and grant-delegation checks. The Admin starter
excludes payroll, manual recovery, public-origin and billable/catalog authority.
Unit tests cover draft contents and safe omission; one local browser session
loaded a starter draft, but the complete role-permission browser matrix remains
outstanding.

## Findings

### Resolved in v1.72 — Public-origin-first customer onboarding

The guided first-run screen now asks for the exact public NOVA origin before
email configuration. A narrow bootstrap-token path lets only the unverified
founding Super Admin save that operator-approved origin, removing the previous
verification circular dependency. Email connection create/test/activate,
Gmail OAuth, invitations, authentication links and notification email now fail
closed with `PUBLIC_ORIGIN_NOT_CONFIGURED` until the explicit origin exists.
Clearing an origin requires deactivating the active email connection first;
it remains a recoverable administrative action, but outbound links stay
blocked until it is selected again. The same contract is used by Supabase
Cloud, Cloudflare/Netlify/Vercel adapters and direct PostgreSQL/VPS. This is
application-layer hardening over the existing public-origin schema; no new
database migration is required.

### Resolved in v1.71 — Operational and email-delivery hardening

Migration `0060_operational_hardening.sql` remains the canonical operational
hardening migration; repository readiness now additionally requires
`0061_better_auth_rate_limits.sql`. The email adapter audit also verified the current provider
contracts against Nodemailer, Google OAuth and Resend: SMTP requires TLS,
Gmail authorization uses offline access plus state/PKCE and a bounded token
exchange, Resend validates its response id and uses its documented
idempotency-key for deterministic notification retries, and the Cloudflare
Worker capability guard prevents accidental SMTP/Gmail selection on its
HTTPS-only runtime. No new database migration is needed for these adapter
changes; the designated Supabase project remains application-role ready.

### Resolved in v1.69 — Canonical background boundary and portable scheduler

Migration `0059_boundary_closure_and_office_snapshots.sql` adds office-local
attendance closure, session office snapshots, first-boundary work closure and
automatic closure audit reasons. `server/src/maintenance-worker.ts` exposes
one idempotent tick and `POST /api/internal/background/tick` protects it with
`NOVA_BACKGROUND_JOB_SECRET`; Docker, Cloudflare Cron, Supabase Cron/pg_net and
direct VPS timers all invoke that same path. Email provider timeouts and
provider-failure secure handoffs are shared by Better Auth and invitations.

### Resolved in v1.68 — Guided Supabase Cloud bootstrap path

`bun run setup:supabase` now provides the shortest managed-deployment path
without requiring PostgreSQL or Docker on the operator laptop. It accepts the
exact project ref and project-scoped Supabase management token (from existing
environment values, command arguments, or prompts), resolves the project's
transaction-pooler host, writes only the required local runtime values, runs
the canonical Supabase migration/bootstrap runner, and executes the same
application-role preflight used by direct PostgreSQL. It does not put the
management token into Netlify, Vercel, or the NOVA runtime contract. Docker
and direct PostgreSQL external mode remain unchanged. The exact designated
project was exercised successfully after this change; the live catalog still
reports migration 0058 latest, 49 RLS-enabled tables with zero policy gaps,
zero PUBLIC-executable NOVA security definers, and a restricted `nova_app`.

### Resolved in v1.67 — Canonical public origin and custom-domain boundary

Migrations `0056_public_origin_settings.sql`,
`0057_public_origin_constraint_fix.sql` and
`0058_public_origin_actor_integrity.sql` add an RLS-protected,
organisation-scoped public-origin setting and the dedicated
`organisation.public_origin.manage` permission. The setting can only select an
exact origin from the deployment's `NOVA_ALLOWED_ORIGINS` allowlist; the
environment fallback remains `BETTER_AUTH_URL`. One shared resolver now covers
invitation, Better Auth verification/reset, secure handoff, Gmail OAuth,
notification email and browser redirect links. Netlify, Vercel, Supabase
Cloud, direct PostgreSQL and VPS paths use the same contract. Live catalog
verification for the designated project reports migration 0058 latest, 49 RLS
tables, zero RLS tables without policies, zero PUBLIC-executable NOVA security
definers, three narrow public-origin functions, one origin permission, one
runtime-settings policy and one same-organisation audit-actor trigger. The
`nova_app` role remains non-superuser and
non-`BYPASSRLS`, with only the three explicit function grants.

### Resolved in v1.66 — Authentication handoffs, actor boundary and bootstrap closure

Migration `0052_auth_system_handoffs.sql` keeps the existing Better Auth
credential/session boundary and adds only the missing delivery fallback. When
no email connection is active, the same invitation, verification and
password-reset flows stage an encrypted, short-lived handoff for an authorised
administrator; the handoff is revealed once, audited and never exposes a
password. Authenticated users can change their own password through Better
Auth without email. A protected Super Admin can explicitly deactivate the
active sender, while normal sign-in, in-app notifications and domain commands
remain available. The application role receives only the narrow staging
function plus RLS-scoped handoff access. The migration is applied to the
designated Supabase project. The read-only catalog verification reports 52
ledger entries, 48 RLS-enabled NOVA tables, zero RLS tables without policies,
a non-superuser/non-`BYPASSRLS` `nova_app`, and the handoff table,
organisation policy, staging function and `auth.manual_recovery` permission
present. Migration `0053_restrict_actor_context_function.sql` removes public
execution of the RLS actor helper and grants it only through the configured
application-role provisioning path. Migration
`0054_super_admin_business_date.sql` makes deployment-level Super Admin checks
use the same office-local business date as the normal permission engine. The
`0055_super_admin_operational_status.sql` follow-up makes that resolver also
re-check active/notice lifecycle status inside the transaction, closing the
freeze/offboarding race for in-flight protected operations. The
unverified founder bootstrap path can reveal only its own verification
handoff with the still-held setup token, closing the no-email first-run loop
without opening general unverified access.

### Resolved in v1.62 — Atomic self-work, reviewer requests and handover

Migration `0051_workstream_requests_and_resolution.sql` adds portable
reviewer-request and two-sided handover records, one-pending constraints,
organisation validation triggers and RLS policies. Task creation can create a
self-assignment in the same transaction. Client assignments cannot opt out of
review; organisation no-review submissions resolve as `approved` with
`resolution_source = policy` and aggregate to the existing `Done` task state.
Reviewer eligibility is rechecked on submit, review-queue reads and request
acceptance. An unavailable reviewer is explicitly blocked as
`REVIEWER_UNAVAILABLE` and requires a replacement or exception. Attendance
checkout closes required-role timers, approved leave blocks new timers, and
leave approval rejects a current-day running timer. At the v1.62 checkpoint,
the exact designated Supabase project reported migration 0051 as latest with
47 RLS-enabled NOVA tables, zero RLS tables without policies, and `nova_app`
non-`BYPASSRLS`; v1.66 adds the migration-0052 through migration-0055
verification above.

### Resolved in v1.61 — Pending-review queue matches assignment reviewer authority

The pending-review read path now returns only assignments whose current
reviewer is the requesting actor. Organisation-scoped `tasks.review` still
controls the actor's capability, but it no longer exposes unrelated pending
reviews that the write path would reject.

### Resolved in v1.60 — Database-enforced blocked-review invariant

Migration `0050_review_cycle_integrity.sql` rejects a null reviewer on an open
review cycle unless its assignment is `awaiting_review` with the explicit
`NO_ELIGIBLE_REVIEWER` marker. The same rule is now enforced for direct
application-role writes, while decided-cycle immutability remains unchanged.

### Resolved in v1.59 — Transaction-time operational actor gate

Migration `0049_operational_actor_rls_gate.sql` tightens the shared
provider-neutral RLS context boundary: a normal request context is valid only
for an `active` or `notice` person. A request that passed its initial session
check cannot continue normal API reads/writes after a freeze or offboarding
transition commits. Maintenance and bootstrap security-definer functions keep
their explicit operator boundaries.

### Resolved in v1.58 — Task approval aggregate cannot approve review-free work

Submitting a non-review assignment no longer promotes a task to `Approved`
merely because no assignment is pending. The v1.62 policy provenance update
now marks that assignment `approved` with `resolution_source = policy` and
projects an all-no-review task to the existing `Done` state. Review-required
work still reaches `Approved` only after every active review-required
assignment is approved.

### Resolved in v1.57 — Explicit blocked-review state and open-cycle reviewer updates

Assignments can now be submitted as `Awaiting Review` when no eligible reviewer
is available. Migration `0048_review_blocking_and_reviewer_change.sql` records
the explicit `NO_ELIGIBLE_REVIEWER` marker and timestamp, permits the open
review cycle to carry a null reviewer until an authorised reviewer or audited
Super Admin exception is selected, and keeps blocked reviews out of the normal
review queue. Reviewer changes and exceptions update only the open cycle's
reviewer snapshot; decided cycles remain immutable. Completed or cancelled
assignments cannot have their reviewer rewritten.

At the v1.57 checkpoint, the exact Supabase project
`hrlvietbqvkdovulzcie` reported migration 0051 as latest (51 ledger entries);
the read-only catalog check confirmed the open reviewer column was nullable,
the blocked-review constraint existed, all 47 NOVA tables remained RLS-enabled
with policies, and `nova_app` remained non-bypass.

### Resolved in v1.56 — Canonical assignment session closure

Task cancellation and assignment reassignment now call
`nova.close_assignment_work_sessions(uuid, timestamptz, text)` instead of
writing session closure state inline. Migration `0047_assignment_session_closure.sql`
is applied to the exact Supabase project; the post-check confirmed 47 ledger
entries, the function exists, `nova_app` can execute it, and the role remains
`NOBYPASSRLS`. User pause/stop remains the explicit session command.

### Resolved in v1.55 — Cross-module availability race

Leave approval, WFH approval/cancellation, and attendance check-in, checkout or
mode change now acquire one PostgreSQL transaction advisory lock per
person/business date before checking or changing availability state. The key
format matches the existing leave-overlap trigger, so concurrent leave/WFH
approval cannot both observe the other as pending and commit an overlap, and a
WFH cancellation cannot race an attendance check-in into an unapproved state.

The same pass closes the protected-role lifecycle gap: ordinary configurable
roles cannot freeze or offboard a current protected `super_admin` holder.
Protected Super Admins can still administer another protected holder, while
owner transfer remains the explicit ownership-change command.

`people.view` is now evaluated per target row in the people read path, matching
its advertised organisation/office/department/own-record scope catalogue rather
than requiring an organisation-wide grant for every reader.

### Resolved in v1.54 — Privileged OAuth callback lifecycle recheck

Gmail OAuth state is one-use and PKCE-bound, but the browser callback arrives
after the initiating request. The callback now rechecks the initiator's current
operational status and protected Super Admin role inside the final RLS-scoped
transaction before replacing encrypted provider credentials. A pending flow
cannot therefore write email configuration after the initiator is frozen,
offboarded or loses the protected role.

The corrected `0046_attendance_policy_and_lifecycle.sql` migration was then
applied to the exact Supabase project `hrlvietbqvkdovulzcie` through the
project-scoped management API. A read-only post-check confirmed 46 ledger
entries, the explicit attendance-policy bootstrap overload, RLS on the new
policy table, and `nova_app` still without `BYPASSRLS`. Rollback-only fixture
tests remain a disposable-empty-database check and were correctly skipped on
the populated development project.

The same pass also rejects impossible calendar dates at the timeline query,
client-membership and task due-date boundaries; focused validation tests cover
leap-day and month-length cases instead of leaving PostgreSQL casts to produce
late or inconsistent errors.

### Resolved in v1.52 — Scheduled timeline projection and guided setup command

The unified timeline now returns the effective attendance policy for the
requested person's office-local business date. In scheduled mode, when a
working-day shift exists, it derives late arrival, early departure and
after-hours events using the configured grace period. Hour-based mode keeps
duration semantics and never invents schedule-relative events. The projection
shares the existing attendance/work event stream rather than creating a
second timeline. The Today and Work surfaces also expose actual duration and
the hour-based required-duration result.

The new `bun run setup` wrapper provides the open-source clone-to-ready path:
local Docker mode generates secrets only when `.env` is absent, starts Compose,
waits for health and runs migration/preflight; external mode runs the same
checks against operator-provisioned Supabase Cloud or direct PostgreSQL.

### Resolved in v1.53 — Authenticated command boundary and bounded runtime capacity

Better Auth already protects `/api/auth/*` with its trusted-origin/CSRF
middleware, but NOVA's domain commands are separate cookie-authenticated
routes. `server/src/request-security.ts` now applies the matching same-origin
boundary before state-changing commands: session-cookie requests require a
trusted Origin/Referer, cross-site Fetch Metadata is rejected, and credential-
free operator/API calls remain available. Focused tests cover same-origin,
cross-origin, missing-origin and safe-read cases.

The application and Better Auth PostgreSQL pools are now bounded and
deployment-configurable (`NOVA_DB_POOL_MAX`, default 10; `NOVA_AUTH_POOL_MAX`,
default 5) instead of serialising every user through a single connection.
This preserves the portable PostgreSQL design while giving the stated small
organisation target a usable concurrency baseline.

The role-update notification idempotency key now uses the immutable audit-event
identifier, so two later edits with the same role name and grant count cannot
silently collapse into one notification.

The PRD command examples were also aligned with the implemented canonical
routes: work-session pause/stop and assignment submit/review use their
assignment/session resources, and resume is explicitly a new start command.

### Resolved in v1.51 — Open-source deployment decision and guided first-run policy

The product decision is now explicit: NOVA is open source and does not require
checkout, trial, subscription, license activation or a mandatory call-home
service. Optional hosted support/provisioning is outside the core domain.

The first-run setup now captures an effective-dated organisation attendance
policy (`hour_based` or `scheduled`, plus required minutes) and exposes a
protected organisation-settings command for later changes. This prevents the
PRD's two attendance interpretations from remaining an undocumented shift
inference and preserves historical timeline meaning when the policy changes.

### Resolved in v1.51 — Guided self-service deployment packaging

Evidence: `scripts/setup.ts` and the `setup` package command now provide one
portable wrapper around the existing deployment path. With no `.env`, the local
Docker mode creates fresh local-only secrets without overwriting an existing
file, starts Compose, waits for `/api/health`, runs migration/preflight checks,
and prints the setup handoff. External mode runs the same migration/preflight
sequence against an already-provisioned Supabase Cloud or direct PostgreSQL
environment.

Why it matters: an open-source customer can clone the repository and reach a
safe first-run screen without guessing which local deployment steps are
operator-only.

Current handling: `bun run setup` is the guided local path; an operator still
owns external database credentials and hosted runtime environment variables.
The wrapper does not create provider identities, billing records or license
state.

The wrapper intentionally remains small: it does not overwrite `.env`, does not
print database passwords, and does not store or invent provider-specific
identity, billing or license state.

Risk: making setup depend on a hosted service would break the open-source and
direct-VPS promise. Keep optional hosted concerns outside the canonical schema.

### P1 — Effective-dated compensation source facts are intentionally gated

The PRD previously listed compensation terms as V1 source data, while the
current schema contains employment history and payroll policy flags but no
compensation-term model. v1.51 resolves this without inventing salary
components: compensation terms remain gated until the Payroll input contract
freezes currency, amount, period and applicability semantics.

This is a deliberate scope decision, not a hidden schema defect.

### P1 — Cross-module lifecycle and availability corrections

The audit found and fixed two real boundary issues:

- work-session start now requires an open attendance row for the target
  person's current office business date, not any stale open row from a prior
  date;
- freeze and offboarding close open attendance through the same canonical
  PostgreSQL lifecycle function used for productive work-session closure;
- an approved WFH request cannot be cancelled while it still has an active WFH
  attendance state, avoiding a silently invalid current-day record.
- an attendance mode change is rejected after leave is approved for that
  business date, so office attendance cannot be converted into a new WFH state
  on a leave day.
- scheduled attendance now treats an archived/missing shift as unconfigured,
  so a stale calendar rule cannot silently allow a schedule-based check-in.

### Resolved in v1.20 — Collaboration runtime foundation

Evidence: migration `0016_work_context_collaboration.sql` (plus the corrective
`0017_role_grant_constraint_fix.sql`) now creates clients, client and
organisation workstreams, groups, tasks and assignments, with PostgreSQL
organisation-context triggers, RLS and scoped role-grant targets. The API
exposes creation, assignment and reviewer commands in
`server/src/commands/work-context.ts`.

Why it matters: collaboration permissions now have a live, auditable domain
boundary instead of being unused catalogue entries.

Current handling: Phase 3/4/5 foundations now include client departments,
effective-dated client membership, review-cycle writes, work sessions and a
unified timeline read. Review queues, exception reviewers and correction
workflows remain additive and are not implied by the current task model.

### Resolved in v1.22 (first slice) — In-app notifications and optional email staging

Evidence: migrations `0021_notifications_inbox.sql`,
`0022_notification_preference_function.sql` and
`0023_notification_preference_function_acl.sql` add the durable inbox,
recipient-owned preferences and email outbox staging with RLS. The API exposes
the inbox, unread count, read/read-all and preference endpoints; the UI exposes
the notification page. Leave/WFH decisions and task assignment/reviewer
selection enqueue idempotent in-app events in the same transaction.
Configured email adapters currently cover transactional account delivery.

Why it matters: employees and reviewers should receive the event in the NOVA
inbox by default; email must remain optional and must not be required for the
workflow.

Delivery inspection/replay and idempotent due/overdue task scheduling are now
implemented. Onboarding and freeze/offboarding lifecycle fan-out now use the
same atomic helper for affected people and permitted administrators. Remaining
additive work is broader policy recipient fan-out. Email remains
opt-in and no domain command waits for provider delivery. The complete
integration map is in `docs/notification-module-plan.md`.

### Resolved in v1.23 — Permission scope consistency

Evidence: migration `0024_permission_scope_catalogue.sql` makes the allowed
scope set part of each permission definition, rejects unsupported role grants
at the PostgreSQL boundary, and exposes the same catalogue to the role editor.
The API validates the grant set before writing and the UI no longer offers
scope choices that the permission cannot use.

Why it matters: custom roles remain configurable without allowing a scope that
a command cannot interpret. Existing invalid grants fail the migration loudly
instead of being silently reinterpreted.

### Resolved in v1.23 — Audited offboarding command

Evidence: `POST /api/people/:id/offboard` now performs a permission- and
scope-checked, server-timestamped `offboarding` or `exited` transition. It
requires active task assignments to be reassigned or closed first, ends
future operational assignments, revokes Better Auth sessions and identities,
revokes open invitations, and records the transition in the immutable audit
log without deleting historical records. The Admin console exposes the same
handover-first lifecycle path.

### Resolved in v1.24 — Work-session timer foundation

Evidence: migration `0028_work_sessions.sql` adds PostgreSQL-enforced,
non-overlapping productive sessions with append-only pause/stop semantics,
business-date boundary closure and a canonical lifecycle closure function.
`server/src/commands/work-sessions.ts` adds permission-checked start, pause,
stop, resume-by-new-start and a 31-day personal session read API. Freeze and
offboarding call the same closure function, and the maintenance runner closes
sessions that cross an office-local business boundary.

Remaining additive work is the full Work UI; the bounded Client Work/Admin
slice is now available. The API also includes audited gap adjustments,
exception projection, review queues, reviewer exceptions and task
cancellation/reassignment workflows.

### Resolved in v1.25 — Office-local business-date consistency

Evidence: migration `0029_person_business_date.sql` adds a provider-neutral
PostgreSQL resolver based on the person's effective office timezone. Leave and
WFH permission windows and bounded attendance recovery now use that resolver;
they no longer use the database server's UTC date for a person working in a
different office timezone.

### Resolved in v1.43 — Authorization date consistency

Evidence: application permission predicates and migration
`0041_office_business_date_authorization.sql` now use
`nova.person_business_date` for actor/target effective-date checks, including
the protected Super Admin resolver used by the database security boundary.
The API no longer silently falls back to the PostgreSQL server date for these
authorization windows.

### Resolved in v1.27 — Client departments and memberships

Evidence: migrations `0030_client_departments_memberships.sql` through
`0033_client_membership_overlap.sql` add organisation-safe client department
and effective-dated, non-overlapping client membership records with PostgreSQL
RLS and cross-organisation trigger checks. `server/src/commands/client-access.ts`
adds permission-controlled department and membership creation endpoints.
Organisation Department remains the person's primary membership; client
membership is functional work context only.

### Resolved in v1.28 — Review-cycle write path

Evidence: migration `0034_review_cycles.sql` adds immutable, concurrent-safe
review-cycle records. `server/src/commands/reviews.ts` implements submission,
approve and changes-requested transitions with write-time scoped permission
checks, reviewer snapshots, aggregate task status updates, audit events and
in-app notifications.

`GET /api/reviews/pending` now provides the permission-scoped pending-review
queue, and the protected reviewer-exception endpoint completes the explicit
exception path. Remaining additive work is a broader review UI.

### Resolved in v1.29 — Unified timeline read projection

Evidence: `GET /api/work/timeline` composes office-local attendance and
productive work-session events into one chronological response. It uses the
same PostgreSQL source records for scheduled and hour-based attendance modes;
it does not duplicate or rewrite either source. Migration
`0035_timeline_adjustments.sql` and `POST /api/work/timeline-adjustments` now
add the separate audited, past-only correction source and project it back into
the same timeline while PostgreSQL rejects overlap with timer-backed work or
another correction.

The projection now includes untracked-gap and outside-attendance exception
records, and the write path rejects invalid/cancelled assignments and
attendance-required corrections without covering attendance. The same write
path accepts an authorised target person for `work.timeline_adjust_others`
with office/department/organisation scope checks; the full timeline UI is the
remaining additive slice.

### Resolved in v1.33 — Work lifecycle and notification operations

Evidence: `POST /api/tasks/:id/cancel` closes active assignments and running
sessions without deleting approved history; `POST
/api/task-assignments/:id/reassign` creates a new assignment while preserving
the old assignment's work/review history. `GET /api/notifications/delivery`
and `POST /api/notifications/delivery/:id/requeue` are permission-gated
operator surfaces backed by narrow PostgreSQL functions in migration
`0036_notification_delivery_operations.sql`.

Migration `0040_due_task_notifications.sql` and the maintenance runner add
due/overdue task reminders with deterministic idempotency keys. The function
does not require an email provider and only stages optional email when the
existing preference is explicitly enabled.

The Admin console now includes a bounded Client Work slice: visible clients,
workstreams, groups, tasks and assignment history can be inspected, and
authorised operators can create those records or assign/cancel work through
the existing permission-checked API commands. This is UI coverage over the
existing domain model, not a second work model.

### Resolved in v1.34 — Reviewer exception workflow

Evidence: `POST /api/task-assignments/:id/reviewer-exception` is restricted to
the protected Super Admin, requires a live non-self reviewer and a reason,
records the exception provenance, audits the failed-normal-review rationale,
and notifies the selected reviewer. Migrations `0037_reviewer_exceptions.sql`
and `0038_reviewer_exception_constraint_fix.sql` enforce complete,
same-organisation exception metadata at the PostgreSQL boundary.

### Resolved in v1.31 — Availability/payroll decision ledger

Evidence: the PRD now records the bounded V1 rules that are safe to implement
now (31-day attendance recovery, server-only lifecycle timestamps,
attendance-required work gating and 90-day location-evidence retention) and
explicitly classifies overtime, payroll periods/formulas and statutory payroll
as a later Payroll module. These are decisions, not accidental defaults in
the current code.

### Resolved in v1.26 — Super Admin ownership transfer

Evidence: `POST /api/organisation/owner-transfer` requires the current
protected Super Admin, an active/notice target, an explicit confirmation
phrase, and an atomic role-assignment transfer. The outgoing owner's sessions
are revoked, the action is immutable-audited, and the target receives an
in-app notification. A deployment-operator emergency recovery path remains a
separate self-hosted operations runbook decision; it is not a hidden database
owner bypass.

### Resolved in v1.20 — Cross-availability conflict rules

Evidence: WFH approval and leave approval now reject an overlap with an already
approved record. The PRD defines approved WFH as grandfathered for its dates
when a later policy change removes eligibility; new requests and pending
approvals recheck the effective policy.

Why it matters: two approved availability facts can no longer produce a
contradictory employee, manager or payroll view.

Current handling: the mutually-exclusive rule is enforced at both approval
boundaries and is documented in §41.1 and §42.1.

### Resolved in v1.20 — Attendance recovery path

Evidence: migration `0018_attendance_recovery.sql` adds an RLS-protected,
immutable correction trail and `POST /api/attendance/recover` adds a bounded
31-day command for missed check-ins, checkout/device failures and manual
corrections.

Why it matters: a legitimate employee can recover from a device or location
failure without arbitrary row editing or loss of the original state.

Current handling: the command requires `attendance.recover`, a reason, target
scope, server date window and writes before/after JSON plus an audit event.

### Resolved in v1.20 — Location evidence privacy and assurance

Evidence: §11 now defines no continuous tracking, authorised attendance/audit
access, a default 90-day retention window, and browser geolocation as a
spoofable decision signal. Migration `0019_location_evidence_retention.sql`
adds expiry metadata and a narrowly scoped PostgreSQL purge function.

Current handling: deployments must schedule the portable purge function and
may shorten the documented default retention window through policy.

Permission-window predicates across attendance, availability, people,
ownership, role and collaboration setup now use the provider-neutral
`nova.person_business_date` resolver instead of database-server `current_date`.

### Resolved in v1.46 — Supabase Cloud domain mutation smoke and notification fan-out

Evidence: the exact project `hrlvietbqvkdovulzcie` now passes a disposable,
authenticated WFH/leave/attendance sequence through the non-owner
transaction-pooler runtime. The sequence created an office geofence and
calendar, approved WFH with a separate reviewer, checked in as WFH, rejected
an out-of-radius office mode change, accepted an in-radius mode change,
checked out, approved leave for the next business date, and rejected a
conflicting WFH request with `LEAVE_WFH_CONFLICT`.

The run found and fixed three real boundary defects: the calendar
reconciliation query now orders by its selected cast expression; WFH and leave
review commands reject self-review with a domain error; and migration `0042`
adds a narrow request-context-checked `nova.enqueue_notification` function so
cross-recipient notification fan-out remains compatible with recipient-scoped
RLS and `ON CONFLICT` idempotency. The rollback-only notification test now
exercises that function twice for the same recipient/idempotency key.

The reusable smoke harness is `scripts/runtime-specialized-smoke.ts`; its
fixture data is intentionally disposable and must not be used as a clean
migration target. It supports the exact Supabase project through the
management API and direct PostgreSQL/VPS through separate non-owner API and
migration-owner fixture URLs; the latter still needs to be run on a host with
PostgreSQL available.

### Resolved in v1.48 — Notification integration boundary coverage

Evidence: leave/WFH cancellation, leave-attendance conflict/recovery,
rejected attendance location, effective WFH policy, role-permission changes,
and previous/new task reassignment recipients now enqueue stable in-app event
intents in the same transaction as the corresponding state change. The
provider-neutral worker and recipient-scoped RLS boundary remain unchanged.
The exact Supabase project then passed the authenticated specialized smoke
again with a disposable Super Admin fixture; the persisted event-key audit
included `attendance.location_rejected` and `availability.calendar_changed`.

### Verified 2026-09-20 — Exact-project PostgreSQL catalog and preflight audit

Evidence: the read-only catalog audit against the designated Supabase project
`hrlvietbqvkdovulzcie` found no NOVA table without a primary key, no NOVA table
with RLS disabled, no RLS-enabled NOVA table without a policy, no unsafe
security-definer function without a fixed `search_path`, and no multiple
permissive-policy collision. The only public-schema table is the owner-only
`public.nova_schema_migrations` ledger; the `nova_app` role has no table
privileges on it.

The provider-neutral deployment preflight passed through the exact
non-owner `nova_app` transaction-pooler connection and reported the expected
application role and schema readiness. The live role remains
`NOSUPERUSER`, `NOBYPASSRLS`, `NOCREATEROLE`, and `NOCREATEDB`; the ledger has
the canonical migrations through `0045_tasks_create_client_scope.sql` at the
time of that historical audit. Migrations 0046 and 0047 were subsequently
applied on 2026-09-21; current post-checks are recorded in the v1.54 and
v1.56 findings above.
This verifies the Supabase Cloud boundary without weakening the
direct-PostgreSQL/VPS contract.

### Resolved in v1.49 — Business-boundary maintenance closure

Evidence: the first direct Docker/PostgreSQL maintenance run exposed a
`missing FROM-clause entry for table "offices"` in the office-local work
session closure function. Migration `0043_work_session_boundary_join.sql`
replaces that function with the same domain semantics but a valid join order,
and `database/tests/0043_work_session_boundary_join.sql` proves a session
crossing the office-local business boundary is auto-closed with the canonical
reason. The portable maintenance worker now succeeds on direct PostgreSQL;
the same migration is applied and ledger-verified on the designated Supabase
project.

### Resolved in v1.50 — Scope, capability and deployment consistency audit

Evidence: migrations `0044_collaboration_scope_catalogue.sql` and
`0045_tasks_create_client_scope.sql` align the PostgreSQL permission catalogue
with the target contexts evaluated by the collaboration API, including client,
client-workstream, group and assigned-work targets. The work-context read
projection now propagates client/workstream targets consistently, and client-
scoped task creation resolves and authorises its parent client before writing.

The timeline read and correction commands now evaluate the same target-context
scopes instead of silently ignoring client/workstream/group grants. Their
assigned-work checks require the actor to share the task context with the
target assignment. Start/review commands no longer contain dead scope branches
that the canonical catalogue rejects. Assignment and reviewer writes enforce
the effective role policy `can_receive_assignments` and return explicit
conflict errors for non-assignable people.

Verification at that checkpoint: the clean isolated direct-PostgreSQL deployment
applied all 45 migrations and passed every rollback-only database test; local API health and
readiness returned 200; the portable maintenance worker completed; TypeScript,
server-build, browser syntax and smoke-script bundle checks passed. A later
pre-v1.66 Supabase Cloud verification recorded 51 ledger entries through 0051;
the current v1.66 catalog evidence is recorded in the section above.

### Resolved in v1.51 — Attendance policy, lifecycle closure and open-source setup

Migration `0046_attendance_policy_and_lifecycle.sql` adds an effective-dated
organisation attendance policy. Founder setup now records `hour_based` or
`scheduled` interpretation and the required duration; protected organisation
settings can schedule a later policy change without rewriting historical
timeline meaning. The current attendance read surface exposes that policy and
the Admin console can schedule future changes.

The same migration adds `nova.close_person_attendance`, so freeze and
offboarding close open attendance at the authoritative transition timestamp.
Work-session start now checks the target person's current business date rather
than accepting a stale open row from a prior date. Approved WFH cancellation is
blocked while an active WFH attendance state exists.

The deployment decision is now open-source and self-contained: no checkout,
trial, subscription, license activation or mandatory call-home service belongs
in the core. The guided clone-to-ready installer/preflight wrapper is
implemented; a customer-owned VPS uses the same runbook and exact
migration/preflight checks, with host networking and DNS supplied by the
operator.

### Resolved in v1.47 — Deployment runner and container hardening

Evidence: the migration runner now takes a connection-scoped PostgreSQL
advisory lock while it creates/reads the canonical ledger, applies migrations,
and grants the application role. The Docker API image runs as a non-root user
and its Compose service checks `/api/health` independently of `/api/ready`.

This closes the deployment race and runtime privilege gaps without changing
the NOVA domain model or portability boundary.

### Resolved in v1.45 — Supabase Cloud authenticated core smoke

Evidence: the exact project `hrlvietbqvkdovulzcie` was exercised through its
transaction pooler with the non-owner `nova_app` role. The smoke completed
founder registration, one-time organisation bootstrap, Better Auth email
verification, sign-in, readiness, organisation/role/people/availability/
work/notification reads, custom-role creation, Console email-adapter creation,
test, activation and read-back. The earlier `/api/people` runtime failure was
fixed by aligning the read projection with the canonical
`employment_starts_on`/`employment_ends_on` columns.

The Supabase bootstrap runner now detects an already-populated deployment and
skips empty-database fixture tests with an explicit message. A fresh empty
database still runs every rollback-only PostgreSQL test.

The fresh direct PostgreSQL Docker deployment then passed all 45 migrations,
the clean-database rollback test suite, readiness, maintenance-worker
execution, and the authenticated WFH/leave/attendance/geofence/collaboration
smoke using the non-owner `nova_app` path. A customer-owned VPS remains an
operator-specific acceptance check, not an unverified product assumption.

### Resolved in v1.43 — Customer-owned email sender

V1 explicitly requires a customer-owned Console, SMTP, Gmail OAuth2 or Resend
connection in every deployment shape. This preserves portability and avoids
silently coupling hosted deployments to NOVA-owned domain reputation, quotas or
deliverability. A shared hosted sender, if needed later, is a separate
commercial infrastructure adapter; the existing encrypted provider boundary
already supports replacing the active connection.

### Resolved in v1.44 — Work and Operations UI slices

Evidence: migrations `0008_availability_configuration.sql`,
`0009_attendance_state.sql`, `0010_leave_requests.sql`, the compatibility
repair `0011_fix_leave_overlap_trigger.sql`, `0012_wfh_policy_overrides.sql`,
`0013_historical_exceptions.sql`, `0014_wfh_approval_and_geofence.sql`,
`0015_office_geofence_permission.sql`, `0016_work_context_collaboration.sql`,
`0017_role_grant_constraint_fix.sql`, `0018_attendance_recovery.sql`, and
`0019_location_evidence_retention.sql`, `0020_location_evidence_expiry_fix.sql`,
`0021_notifications_inbox.sql`, `0022_notification_preference_function.sql`,
`0023_notification_preference_function_acl.sql`,
`0024_permission_scope_catalogue.sql`,
`0025_notification_worker_functions.sql`, and
`0026_notification_staging_function.sql`, `0027_maintenance_access.sql`,
`0028_work_sessions.sql`, `0029_person_business_date.sql`,
`0030_client_departments_memberships.sql`,
`0031_client_access_permission_scopes.sql`, `0032_client_access_trigger_fix.sql`,
`0033_client_membership_overlap.sql`, `0034_review_cycles.sql`, and
`0035_timeline_adjustments.sql`, `0036_notification_delivery_operations.sql`,
`0037_reviewer_exceptions.sql`, `0038_reviewer_exception_constraint_fix.sql`,
`0039_timeline_view_own_scope.sql`, `0040_due_task_notifications.sql`, and
`0041_office_business_date_authorization.sql` and
`0042_notification_enqueue_function.sql`,
`0043_work_session_boundary_join.sql`,
`0044_collaboration_scope_catalogue.sql`, and
`0045_tasks_create_client_scope.sql` now
define shifts, working calendars,
office
assignments, holidays, one
attendance state per person/business date, a per-business-day leave ledger,
effective-dated WFH overrides, approved WFH requests, office geofence
configuration/evidence, and an exception ledger.

Why it matters: the PRD requires a person to see today's rules, check in/out,
request WFH and request leave, with permission-driven recovery/review controls. The current
slice covers today's rules, check-in/out, deterministic WFH eligibility
(person → department → office → role), explicit office↔WFH mode changes,
approved WFH request/review, office geofence verification, leave
request/review, approved-leave attendance guards, explicit leave↔WFH conflict
rejection, holiday/calendar reconciliation, bounded attendance recovery, and
location-evidence retention/purge.

The Operations surface now renders the full permission-filtered People,
Client Work/review and Calendar detail slices and offers CSV exports generated
from those already-filtered responses. No new reporting tables or alternate
source of truth were introduced.
Leave type catalogues and richer per-day policy can follow the current bounded
text type and portion model.

### Resolved in v1.26 — Deployment readiness and maintenance runbook

Evidence: `/api/ready` now separates database readiness from process liveness;
`server/src/maintenance-worker.ts` is a portable scheduled job for notification
delivery, business-boundary work-session closure and location-evidence purge;
and `docs/deployment-operations.md` defines install, upgrade, backup/restore,
secret rotation and ownership handoff.

Remaining deployment-specific work is customer-owned VPS acceptance; the direct
PostgreSQL deployment shape is verified locally and a customer-owned
VPS can use the same runbook without a domain-model fork. NOVA's open-source
core has no licensing or mandatory billing dependency.

### Resolved in v1.47 — Controlled emergency deployment-owner recovery asset

Evidence: normal owner transfer remains the product workflow, and
`scripts/operator-owner-recovery.sql` now provides the separate,
deployment-operator break-glass path for a self-hosted installation where every
Super Admin is unavailable. It requires a pre-created verified Better Auth
identity, two distinct approver values, an incident/reason, migration-owner
execution, and writes `organisation.owner_recovered` with a nullable/system
actor before normal owner transfer is used.

This remains intentionally operator-only rather than a hidden product route;
it does not insert passwords or make the migration role available to normal
API traffic. Do not make a hidden database-owner login the product flow.

## Works as intended

- Better Auth owns credentials and sessions; NOVA owns lifecycle, role and
  permission decisions.
- The shared RLS actor-context check also rejects normal statements for frozen,
  offboarding or exited people after the lifecycle transition commits.
- Role administration is permission-controlled; delegated role managers cannot
  grant permissions they do not already hold at organisation scope.
- RLS is PostgreSQL-native defence in depth and is not the domain permission
  engine.
- Collaboration context is portable: clients, workstreams, groups, tasks and
  assignments use the same PostgreSQL/RLS/API model on Supabase Cloud or
  direct PostgreSQL.
- Approved leave and approved WFH are mutually exclusive per person/date;
  approved WFH is grandfathered when a later policy change removes eligibility.
- The same migrations/API contract runs against local PostgreSQL and the exact
  Supabase Cloud project.
- Employee onboarding remains invitation-first; HR does not create or share a
  normal employee password.

## Ordered follow-up

1. Repeat the authenticated smoke on a customer-owned VPS during deployment
   acceptance; the clean migration, backup/restore, upgrade, ownership-transfer
   and readiness runbooks are already verified locally.

No billing, subscription or licensing tables belong in the open-source core.

## Flow checklist

### Availability and daily operations

- [x] Server-resolved office business date and timezone.
- [x] Role-policy WFH fallback plus person/department/office overrides.
- [x] Permission-driven WFH request, approval, cancellation, overlap protection,
  and approved-date attendance gate.
- [x] Approved leave and approved WFH cannot overlap; policy changes preserve
  already-approved WFH dates and recheck pending/new requests.
- [x] One attendance state per person/business date with mode changes.
- [x] Effective-dated organisation attendance policy selected during founder
  setup (hour-based or scheduled, with required duration).
- [x] Per-office timezone and server-verified attendance geofence with stored
  check-in evidence; office-specific rules do not restrict organisation-wide
  collaboration.
- [x] Leave request, per-day full/half-day portions, review, cancellation.
- [x] Approved leave blocks new attendance without rewriting history.
- [x] Holiday/calendar transitions close affected open attendance and create
  Historical Exceptions.
- [x] Authorised administrator can inspect and resolve exceptions.
- [x] Leave approval after existing attendance creates a conflict and requires
  an explicit approve-preserve or reject-preserve recovery decision with note,
  permission re-check and audit.
- [x] Bounded `attendance.recover` command for missed/device-failure/manual
  corrections with before/after audit history.
- [x] Location evidence has a default 90-day expiry and portable purge function;
  no continuous tracking is introduced.

- [x] Authenticated Supabase mutation smoke covers separate WFH/leave review,
  geofence rejection/acceptance, attendance checkout and leave/WFH conflict.

### Collaboration foundation

- [x] Client and organisation workstreams, groups, tasks and assignments have
  organisation-safe PostgreSQL tables, RLS and API commands.
- [x] Client/client-workstream/group/assigned-work permission scopes are
  targetable from custom roles, with delegated role-grant protection.
- [x] Reviewer selection rejects self-review and records audit history.
- [x] Self-assignment is atomic with task creation; client work remains
  review-required while organisation no-review work records policy provenance.
- [x] Assignees can request/accept/decline/withdraw reviewer replacements with
  one-pending and expiry rules; unavailable reviewers are explicitly blocked.
- [x] Assignees can request two-sided handover; acceptance closes the old
  timer, preserves history and creates a fresh assignment for the target.
- [x] Review-required assignments can remain explicitly blocked when no
  eligible reviewer exists; open-cycle reviewer changes preserve immutable
  decided history.
- [x] Work-session start, pause/stop, resume-by-new-start, overlap protection,
  lifecycle closure and office-local business-boundary closure.
- [x] Client departments and effective-dated client membership are available
  through permission-controlled API commands with RLS boundaries.
- [x] Unified timeline read projection, gap/outside-attendance exceptions,
  review-cycle submission/decision write path and pending-review queue are
  available.
- [x] Unified timeline projects scheduled late/early/after-hours events only
  for scheduled attendance; hour-based mode remains duration-only.
- [x] Audited past-only self timeline adjustment with PostgreSQL overlap
  protection and unified-timeline projection.
- [x] Task/assignment cancellation and reassignment preserve historical work
  and close active sessions.
- [x] Attendance checkout closes required-role productive timers, approved leave
  blocks timer start, and leave approval rejects current-day running work.
- [x] Freeze/offboarding close open attendance through the canonical lifecycle
  boundary; stale prior-day attendance cannot satisfy today's work gate.
- [x] Protected Super Admin reviewer exception path with complete audit and
  PostgreSQL provenance constraints.
- [x] Authorised administrative timeline adjustment target path is available
  with scope checks.
- [x] First Work UI slice exposes assignments, sessions, review actions,
  timeline events, exceptions and permitted correction.
- [x] Client Work creation, task inspection and assignment UI (bounded slice).
- [x] Work UI exposes reviewer/handover request actions and incoming decisions.
- [x] Permission-filtered Operations overview for Team/People, Client Work,
  Review Queue, Calendar and basic counts.
- [x] Dedicated Team/People/Calendar detail and permission-filtered CSV
  exports are available over the canonical read APIs.

### Customer and deployment onboarding

- [x] Direct PostgreSQL/VPS and Supabase Cloud share migrations and API rules.
- [x] One-time deployment-token founder setup and invitation-first people flow.
- [x] Pluggable Console, SMTP/Nodemailer, Gmail OAuth2, and Resend delivery.
- [x] Authenticated Supabase Cloud core smoke through the transaction pooler,
  including Better Auth verification, custom role and email-adapter writes.
- [x] Authenticated Supabase WFH/leave/attendance mutation smoke, including
  separate review, geofence rejection/acceptance and leave/WFH conflict.
- [x] Guided clone-to-ready installer/preflight wrapper for open-source users;
  external mode preserves operator-owned Supabase/VPS environment setup.
- [x] Backup/restore, upgrade readiness, readiness diagnostics and normal
  Super Admin ownership transfer.
- [x] Connection-scoped migration lock, non-root Docker API runtime and
  container liveness healthcheck.
- [x] Provider-neutral deployment preflight verifies the application role,
  schema readiness and (when supplied) the migration ledger through the
  separate migration-owner connection.
- [x] Emergency deployment-owner recovery is a reviewed operator asset;
  open-source deployments have no entitlement gate.
