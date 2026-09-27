# NOVA QA and completion plan

Date: 2026-09-27

The PRD remains the product-rule source of truth. This document tracks
implementation evidence and the remaining release gates; a source file or unit
test alone does not count as an end-to-end workflow.

## Current result

Deployment-assistant follow-up on 2026-09-27: the UI now gives a six-part
“You do / Then / Confirm” map and a simple source → runtime ↔ database diagram,
while collapsing the repeated service cards and full action/effect table behind
“See where each part is configured.” The selected stage remains the primary
view, with a short explanation of what the provider choice changes. A fresh
local in-app-browser check selected Cloudflare + Supabase and Supabase Cron and
visually confirmed the action location, deploy config, disabled native trigger,
and post-readiness job creation instructions. It did not connect to a provider
or apply any account setting. The guide explains code/API,
PostgreSQL, runtime secrets, domain/links, built-in authentication/optional
email, and the scheduler as separate responsibilities. Scheduler selection
names the exact provider action: Wrangler deploy command + Cloudflare Cron,
Netlify build-time function selection + publish, Vercel Production selector +
deploy, guarded Supabase post-readiness command, or the Compose worker. A real
`app.js` rendered-flow smoke checks all eight valid host/scheduler combinations,
the action location for each, and that the Supabase job-write command is absent
until health, readiness, and the Supabase selector all match. `bun run test`
passed (118 tests / 512 assertions); API, Cloudflare, and operator TypeScript
checks, JavaScript syntax checks, and the rendered-flow smoke passed. This is
configuration/UI and local browser evidence, not a live hosted-provider
deployment. Full authenticated browser workflows remain separately gated.

The Netlify + Supabase Cron pairing no longer asks customers to remove a
schedule export and push a code change. A committed local Netlify Build Plugin
selects the production function directory from `NOVA_BACKGROUND_SCHEDULER`:
`netlify` includes the scheduled adapter; `supabase` includes only the API.
Production fails closed if the selector is absent or invalid. Deploy previews
and branch builds never bundle a production schedule. The selector must be
available to both Netlify Builds and Functions. Plugin/config behavior and the
customer-facing pairing are covered locally; no live Netlify build has run.

Fresh isolated runs on 2026-09-27 passed against PostgreSQL 17 in WSL. The
default run applied all 74 migrations through
`0074_predefined_task_billing_rules.sql`, passed all 53 rollback/RLS fixtures,
604 authenticated lifecycle assertions, specialized pending/approved/rejected/
cancelled WFH, attendance/leave/geofence smoke, and application-role preflight
(`ready`). A separate 100-employee run passed the same database/security and
specialized gates with 2,414 lifecycle assertions. Both runs exercised the
0072-to-0074 upgrade rehearsal, which verified migration 0074 restores active
per-definition rules and reset-to-default revisions from migration 0073 audit
evidence without rewriting existing task/session snapshots. Each run removed
only its own verified database and Docker resources.
The lifecycle also verifies that archived clients, client/organisation
workstreams and groups are excluded from new-work context; group/task creation
and billing-policy reads/writes under archived clients fail closed without
partial records or revision changes. Parent rows are locked during child
creation/configuration to prevent races with archiving.

The lifecycle now also creates and reads back an Employee role from the
editable starter draft through the ordinary authenticated role API, asserting
that its permission grants and operational policy persist exactly. It rejects
an HR starter payload whose department-scoped grants have no explicit target
and confirms the failed request leaves no role behind. This proves the starter
data/API contract, not the browser's Apply-profile interaction or target
selection UX.

The 2026-09-27 fresh 100-employee profile passed the same migrations, fixtures,
specialized smoke and preflight, with 2,414 lifecycle assertions. It includes
a synthetic Gmail OAuth lifecycle covering configured-origin redirect,
PKCE/token binding, encrypted credentials, expiry/replay rejection, rejection
of a grant missing the Gmail send scope and credential preservation on failed
reconnect. The HTTPS-runtime contract verified that Gmail
API and Resend are advertised, saved Gmail metadata remains visible, Gmail
setup uses the same configured-origin send-only OAuth flow, and SMTP is rejected
before persistence. A mocked Gmail delivery verifies OAuth refresh, MIME
composition, HTTPS API authorization, response validation and secret-safe
errors; no real Google account or message was used. The latest burst measured
p95 at 3,052.4 ms for work-context reads, 527.2 ms for task
creation/self-assignment, 677.5 ms for timer start, 318.2 ms for timer stop,
and 283.6 ms for assignment reads. It verified 100 server-classified tasks with rule provenance, 100
assignments, 100 closed timers and zero open timers. This is a one-shot burst,
not a sustained multi-office capacity/soak test.

A prior isolated comparison at database/auth pool sizes 20/10 measured p95
3,462.7 ms for work-context, 824.3 ms for task
creation/self-assignment, 1,041.5 ms for timer start, 428.3 ms for timer stop
and 501.6 ms for assignment reads. This single paired sample suggests some
queueing relief but does not establish a stable SLA or justify raising
defaults; sizes remain configurable and must be budgeted across every API and
maintenance replica against the target PostgreSQL/provider connection cap.

The task-classification rule is exercised end to end: client workstreams fail
closed until an authorized role sets a default; task and catalog authors cannot
provide a class; `tasks.create.billable` remains a separate action permission;
and authorized policy managers can configure per-definition rules scoped to
each workstream. Stale policy edits conflict, policy-edit/task-create races
produce a coherent class/source/revision, and policy changes never rewrite
existing tasks or sessions. Corrections use their own selected definition's
rule or the workstream default, never a correction-only class or the source
task's historical class. Organization workstream tasks remain automatically
non-billable.

Docker Compose now passes `NOVA_DB_POOL_MAX` to API and maintenance containers
and `NOVA_AUTH_POOL_MAX` to the API. The isolated QA runner supports validated
`NOVA_QA_DB_POOL_MAX` and `NOVA_QA_AUTH_POOL_MAX` overrides so pool comparisons
do not require editing `.env` or changing production defaults.
Source/state/
scope/workstream/nesting checks and correction metadata reads pass. An approved
task cannot be cancelled through the ordinary task-cancellation API. The run
removed only its own generated database and label-matched Docker resources.
Two role edits based on the same revision race: one complete role snapshot is
saved, the other receives `ROLE_VERSION_CONFLICT`, and no mixed grants/policy
state is persisted. The role editor now sends the revision it read; a stale
administrator must reopen the latest version before reapplying changes.
Migration 0067 makes `person_business_date` use a statement-stable instant;
fixture 0069 checks that shared instant across four office timezones. The WFH
smoke submits reviewer rejection and employee cancellation
concurrently: exactly one succeeds, the other receives the expected conflict,
and exactly one terminal decision is persisted. Separate sequential checks
prove cancellation blocks a later review and approved/promoted attendance
blocks a later cancellation. A further simultaneous approval-versus-cancellation
case runs with live provisional attendance and a linked work timer. On the
latest isolated run approval won, cancellation returned the expected conflict,
exactly one decision event was written, attendance was promoted, and the timer
continued until the smoke explicitly stopped it and checked out.

During this pass the first run caught a test-harness assumption: a concurrent
review race can legitimately approve the task, after which cleanup must not
cancel it. The harness now expects cancellation only when the winning state is
still cancellable and verifies that an approved winner remains protected. The
clean rerun passed; product authorization was not weakened.

The clean default PostgreSQL gate passed on 2026-09-27 with all 74 migrations,
53 rollback/RLS fixtures, 604 authenticated lifecycle assertions, specialized
WFH/attendance/leave/geofence smoke and app-role preflight. The 100-employee
profile also passed the full gate on 2026-09-27 with 2,414 lifecycle assertions, including
the synthetic Gmail OAuth security lifecycle. It exercised
100 concurrent task creates and verified classification provenance, 100
assignments, 100 closed timers and zero open timers. Latest repeat burst p95:
work-context 3,052.4 ms; task creation/self-assignment 527.2 ms; timer start
677.5 ms; timer stop 318.2 ms; assignment reads 283.6 ms. This is a bounded one-shot
burst, not a sustained multi-office load or long-duration soak. Each successful
QA run removed only its own generated database and label-verified resources.
The current unit suite passes with 118 tests and 512 assertions, including
Supabase pooler discovery/project-scoped host selection, the canonical
per-definition billing-rule route, the legacy-route retirement contract, and
optional-read failure versus empty-state behavior. The latest additions cover
the provider-specific deployment handoff for every supported host/scheduler
pair, reject unsupported pairs, and show repository changes, exact provider
actions, and where to verify them instead of implying that a browser choice
provisions anything. Vercel's build-time config omits native Cron when Supabase
Cron is selected; Netlify's local build plugin selects an API-only directory
when Supabase Cron is selected. A Cloudflare Cron
regression also proves that a non-2xx tick response fails the scheduled
invocation instead of producing log-only success. The role-notice
test covers the actual verification next step instead of an unhelpful refresh
prompt. On the disposable Supabase project, direct
`nova_app` pooler login, 74-migration preflight, health/readiness and the
database-backed Better Auth throttle passed; the full domain mutation smoke
was not run because disposable founder credentials are absent.

The 2026-09-26 read-only recheck used the token from root `.env` only with the
explicit disposable ref `ytfuwtlioxggccbarmdz` from `.env.qa-supabase`; the
exact project lookup returned HTTP 200 and `ACTIVE_HEALTHY`. The QA file's
direct database username includes the same project ref, and its `nova_app`
preflight verified all 74 migrations and returned `ready`; the scheduler enum
was process-local for the check, and no Cron was created or invoked. The independent
catalog audit found 54 RLS-enabled NOVA tables, zero without policies, zero
PUBLIC-executable NOVA security definers, and the expected three public-origin
functions, permission, policy, constraint and actor trigger. The background
closure functions and office snapshot are present. A read-only bootstrap check
found one organisation and five Better Auth users, so this project is already
populated and founder bootstrap is unavailable. No cloud rows or schema were
changed. The QA file has no disposable founder login, management token or
background-job secret; the full authenticated cloud mutation smoke and live
scheduler remain unverified. Keep the explicit ref guard and inject required
secrets process-locally; do not run a default-`.env` cloud command for QA,
because its saved ref still names the primary project. The lookup confirms
access to this exact QA project, not that the token itself is exclusively
scoped to it. A later read-only repeat from this Windows shell was refused by
the network sandbox before reaching Supabase. The approved elevated retry ran
the fixed read-only boundary audit against only that disposable ref and returned
migration 0074 plus all four expected boundary/schema flags; no cloud write was
attempted.

### Earlier QA history

The dated run records below explain prior defects and fixes. Their older
migration, fixture and assertion totals are superseded by the latest passing
result above.

The previous `ASSIGNMENT_NOT_FOUND` after accepted handover is fixed. On
2026-09-24 the end-to-end local QA command passed using PostgreSQL 17 in WSL
Docker: migrations 0001–0062, all 44 rollback/RLS fixtures, the 314-assertion
authenticated lifecycle, the specialized WFH/attendance/geofence/leave smoke,
and application-role preflight. The lifecycle reaches submit by the new
assignee, verifies timer closure, freeze/session denial, unavailable reviewer
replacement and safe offboarding, revalidates handover-accept permission at
write time without mutating a pending request after denial, and races handover
against submission, competing review decisions, old-assignee reuse denial, and
handover withdrawal/decline. It also verifies an A→B→A return handover creates
three immutable assignment records and that concurrent handovers to one
recipient produce one accepted assignment plus a stable conflict for the loser.
In the observed handover-vs-submit race, submission won
and handover acceptance returned the expected
`ASSIGNMENT_NOT_HANDOVERABLE` conflict. A selected
`vps` provider tick also returned `200` inside the isolated lifecycle.
The lifecycle also completes a changes-requested/resubmit/approval path,
checks reviewer/handover request expiry and replay with the API clock set a day
behind PostgreSQL, preserves six-digit microseconds in timeline corrections
while the API clock is two days behind, and verifies an expired manual reset
handoff is neither listed nor revealed. An expired email-verification link
leaves the identity unverified and verification can be resent successfully.
Expiry and handoff TTL creation use the database clock.
The review-cycle decisions and their in-app notification keys are verified in
PostgreSQL. Two simultaneous selected-`vps` background ticks both returned
`200` and emitted a single reviewer-unavailable notice for the same assignment.

The latest run first exposed a test-fixture timezone mismatch: a synthetic
reviewer had a role effective on the Asia/Kolkata date but no office
assignment, so the date function correctly fell back to UTC. The fixture now
assigns the reviewer to the same office as its effective role. A fresh run
passed; this was not an application-rule change.

The QA launcher now creates a unique Compose project and uses a private
`postgres-qa` service with no host port mapping. A first attempt exposed the
previous test service's collision on host port 5432 before PostgreSQL started.
Its never-started container, empty volume and network were individually
verified against the generated project labels and removed. The subsequent full
run passed and removed only its own database and label-verified volume; it did
not use the normal `nova` service or volume.

Database test fixtures `0062_timezone_boundary_microseconds.sql`,
`0063_notification_lease_token_recovery.sql` and
`0064_assignment_handover_history.sql` all passed; they are under
`database/tests/`, not migrations. The first run exposed a test-fixture
mistake: the notification fixture queried a deliberately RLS-hidden outbox
table as `nova_app`. The fixture now inspects persisted queue state only as the
migration-test role, explicitly asserts that `nova_app` cannot read the queue,
and keeps claim/finish operations under the app role. The subsequent full run
passed; no product authorization was weakened.

The first normal Windows launch was blocked before Compose because WSL denied
the repository path. With approved WSL execution, the runner reached the local
Docker engine. Extending the lifecycle exposed a separate
test-only query mistake (`task_assignments.created_at` does not exist); that
failed run preserved its generated database. The query was corrected to use
the schema's `assigned_at, id` ordering. A subsequent randomized
`changes_requested` review winner exposed missing cleanup for that synthetic
race task; the harness now cancels both race tasks before later offboarding
checks. After each failed run, its exact preserved database was verified to be
owned by `nova_migrator` with zero active connections and only that database
was dropped. The first resubmission-notification assertion also counted the
assignment-time reviewer notice; read-only inspection confirmed the persisted
cycle notifications were correct. The assertion now distinguishes submission
keys, and the complete suite passed.
The shared `nova` database and volume, two pre-existing QA-named databases,
and unrelated orphan containers were left untouched. The failed verification-
expiry run's exact generated database was checked for owner and connections,
dropped, and its container/network/volume were then removed only after each
resource's project labels matched that run. No Supabase project was accessed.

The superseded failed `nova-qa-a263…` project was also rechecked against its
Compose-file, project and volume labels; its generated database had zero active
sessions. After the clean 0066/391-assertion rerun passed, only that project's
container, network and volume were removed. Two older QA-labeled volumes remain
untouched because they predated this verification pass.

The first run after adding migration 0062 passed the database fixtures, all 303
lifecycle assertions and the specialized smoke, then failed only because
preflight/setup still expected migration 0061. That exact database was verified
as `nova_migrator`-owned with zero connections and removed with only its
label-matched Compose resources. Setup, bootstrap scripts, the deployment
assistant and preflight now expect 0062; the following clean-from-zero run
passed every stage and returned `ready`.

The latest preflight returned `ready`: 74 migrations / latest 0074, migration
role checked, the rate-limit table present, and `nova_app` neither owning NOVA
objects nor able to assume object-owner/privileged roles. `/api/ready` fails
closed when the Better Auth rate-limit table is absent. The shared `nova`
database and volume were not used or changed by this run.

Host-local checks passed: `bun run test` (103 tests, 315 assertions), including
Vercel Cron authentication/translation, Netlify scheduler selection/configuration
and canonical forwarding, plus Cloudflare Worker API forwarding and Cron
selection gating. Wrangler 4.141.0 also passed a no-upload deployment dry-run,
actual local `workerd` startup/health check, and the mocked Gmail HTTPS/MIME
runtime smoke; the latter is now wired into GitHub Actions but that workflow
has not yet run. Also passed: `bun run typecheck`,
`bun run typecheck:cloudflare`, server build, `node --check web/app.js`, and
strict TypeScript checks for the QA and smoke scripts. Scheduler-identity and adapter tests prove that the protected tick rejects a
valid secret from an unselected adapter and fails closed without a selector.
The provider header is now required, and the VPS worker uses the same protected
endpoint instead of running domain work directly. Unit tests reject
external-origin escape paths when generating
public/notification links and verify notification links are rebased to NOVA's
configured origin. `bun run qa:postgres` is a repeatable one-command entry
point: it uses Docker CLI where available and WSL Docker on Windows when the
native CLI is absent, then drops only its generated database after a fully
successful run. No credentials from real employees or the populated primary
Supabase project were used.

A separate customer-style Docker Compose test also passed on direct PostgreSQL
in WSL with a fresh unique project, isolated volume, and loopback-only alternate
ports. It applied all 67 migrations through
`0067_consistent_office_business_clock.sql`; `nova_app` was non-superuser and
non-BYPASSRLS; API-container `/api/health` and `/api/ready`, one protected `vps`
tick and six public UI routes returned 200. Windows loopback did not reach the
API routes with WSL-only Docker in this run. The generated containers, network
and volume were removed after checking their exact Compose project identity.

In a later local browser run, the admin created a manual invitation, opened its
one-time handoff, accepted it in the same browser while the admin cookie
remained, completed verification and onboarding, and confirmed the employee's
office, department, role, manager and audit event. A custom role was created,
edited, revoked and re-opened to verify persisted permissions; a starter role
draft also loaded. These are narrow browser proofs, not full Work/HR journeys
or accessibility/responsive readiness.

The live local browser rendered and exercised the deployment path selector for
Cloudflare + Supabase, Netlify + Supabase, Vercel + Supabase and direct
PostgreSQL/VPS, including each eligible scheduler choice and Supabase Cron
alternative. Setup rendered public-origin and attendance-mode controls;
sign-in and forgot-password navigation worked; the reset route rendered and
removed a synthetic token from the visible URL. An unauthenticated direct visit
to `?view=work` returned the public landing screen. Work/Today/Admin views exist,
but no authenticated Work/HR browser journey was exercised. A synthetic setup
form submitted through the temporary WSL bridge returned a generic error
because that bridge did not preserve the public Host/Origin pair; founder
registration returned 200 when the pair was preserved. Its direct follow-up
omitted the browser session cookie and returned 401, so that earlier attempt
was inconclusive. A later isolated Compose browser run with WSL kept active
completed founder setup, public-origin capture, email-free verification, and
email-free password reset with new-password sign-in and old-password rejection.
The test-only database and volume were removed after the later run. This does
not claim a hosted provider install.

## What is implemented and what is not

**Task-classification rule update (2026-09-25):** migration 0073 consolidated
policy history, and migration 0074 restores the configurable per-definition
rules as part of the canonical model. NOVA classifies all work server-side:
organisation tasks are automatically `non_billable`; client workstreams have a
required default for one-off/inherited tasks and optional per-definition rules
scoped independently to each workstream. Task creators and catalog authors
never choose a class. Only a custom role with `workstreams.billing_policy.manage`
for the target scope may edit the workstream default or a definition rule;
catalog permissions alone cannot. Missing default fails closed.
`tasks.create.billable` remains an independent action permission. Revisions,
reason, auditing and future-only effect prevent stale or silent
reclassification; existing task/session snapshots remain unchanged. Migration
0074 restores the latest active rule and reset-to-inherit revision from 0073
audit evidence.

Corrections are separate linked tasks, not billing adjustments. They use the
same current classifier as any task, never inherit the source class, and retain
their own review/assignment/timer/audit history. Local SQL/API coverage verifies
missing-policy no-partial-write, class-injection rejection/override, policy
role denial, billable-action denial when a correction link is supplied, stale policy
conflict, policy-edit/task-create serialization, future-only policy change,
task/session provenance, correction source visibility/completion/workstream/
nesting checks, a non-enumerating 404 for missing or inaccessible sources,
multiple corrections, and exact retry deduplication. Historical amendments to
immutable task/session class snapshots are outside the accepted V1 task and
correction scope; correction tasks must never be used to change history. Any
future snapshot-amendment capability needs its own explicit product decision,
authorization and audit design.

| Capability | Current status |
| --- | --- |
| Custom roles | Scoped roles, grant checks, permission revoke/regrant and employee assignment are exercised. Employee, HR, Supervisor, Admin and Client Coordinator starter profiles prefill editable drafts; scopes are checked against the server catalogue and targets are never inferred. A local browser verified role create/edit/revoke/reopen, but not the starter selector interaction. The lifecycle smoke now creates/reads back the Employee starter through the normal role API and confirms a targetless HR starter is rejected without a partial role. Full permission/assignment browser coverage remains. |
| Invitations and password recovery | Local API/database smoke covers invitation/verification/onboarding, email mismatch and replay denial, an expired invitation token, expired email-verification token without identity verification and successful resend, one-time reset and replay denial, an expired reset token that leaves the current credential usable, session revocation, manual handoff without configured email, and expired handoff exclusion/reveal denial. Browser also verified email-free founder verification and password-reset handoffs, new-password sign-in and rejection of the old password. Live delivery/provider failures, credential rotation, audit/log secrecy and origin-change behavior still need verification. |
| Task classification and corrective work | Implemented on PostgreSQL/API/UI through migrations 0071–0074. Organization workstream tasks auto-classify non-billable; each client workstream has a required default and optional per-definition rule. Neither task creators nor reusable-definition authors choose a class. Only the separate role-grantable `workstreams.billing_policy.manage` permission changes those policies; `tasks.create.billable` independently authorizes work NOVA classified as billable. Policy is revisioned/audited and future-only; tasks and sessions retain immutable snapshots. Corrections are separate linked tasks and use their selected definition rule or workstream default; they never copy/change the source class or edit the original. No invoice/rate/payroll behavior is added. Migration 0074 restores legacy rule state from migration-0073 audit history; local PostgreSQL/API tests pass; hosted migration/provider proof remains separate. |
| Workstream collaboration | Scoped target discovery, employee create + atomic self-assignment, concurrent idempotent task create/replay returning one task and assignment, changed-payload key reuse conflict, reviewer request/acceptance, live revocation/regrant of the handover recipient's acceptance permission with no mutation on denial, two-sided handover, A→B→A return handover with three preserved assignment rows, concurrent same-recipient handover with one accepted assignment and one stable 409, post-handover submit, old-assignee denial after handover, timer closure, unavailable reviewer replacement, freeze and offboarding pass. Expanded smoke verifies withdrawal/decline and expiry/replay, request expiry despite a deliberately slow API clock, changes-requested/resubmit/final approval, per-cycle notices, submit-vs-handover serialization, exactly one concurrent review decision, and that cancelled pending review cannot be decided. The smoke also verifies that archived clients/workstreams/groups are excluded from new-work context and cannot receive new groups/tasks. This is not a sustained 50–100-person stress result. These guards do not implement archive/rename commands; their V1 effects on existing assignments/history still need a canonical product decision. |
| Attendance / WFH / leave / geofence | Migration 0064 keeps provisional WFH evidence outside authoritative attendance until approval; linked timers are allowed only for the matching open pending request and attendance-required roles. Local PostgreSQL smoke passed approval/promotion, rejection and cancellation while a timer is open, office-check-in denial while pending, exact timer/evidence closure, task-history preservation, and leave conflict. A rollback fixture calls the real maintenance closure over the America/New_York spring-DST boundary and verifies repeat-tick idempotency; lifecycle smoke freezes a person with a linked provisional timer and proves zero attendance credit. Attendance recovery preserves exact database microseconds under API clock skew. A new cross-timezone authorization regression passed: actor-role effectiveness uses the reviewer's current business date, while scoped office/department membership is checked on the target employee's own office-local date; pending WFH and leave requests remained visible and reviewable across UTC midnight. Repeated-wall-time policy, overnight sessions, browser permission-denial UX and spoof recovery remain unproven. |
| Background jobs | One canonical tick and protected endpoint remain. The source-identity guard rejects missing/mismatched providers, and the VPS worker calls the same endpoint. Two overlapping selected-`vps` ticks returned `200`; reviewer reconciliation and its notice happened once. No live provider schedule is verified. |
| Deployment assistant | Fresh local browser walkthrough verified all seven stages, all five runtime shapes, applicable scheduler options, and host-specific Supabase-Cron switch guidance for Cloudflare, Netlify and Vercel. The no-database probe correctly displayed API health as ready and database/runtime readiness as not ready; changing scheduler selection invalidated the prior probe. Handoff remains gated. It does not install providers, write secrets, verify migration-owner role attributes/full ledger, or inspect live scheduler configuration. |
| UI | Work-page creation remains API-authorized and its role/scope data path passes. The browser verified manual invitation → one-time handoff → verification → onboarding while an admin session remained in the same browser, plus role create/edit/reopen and a starter draft. The authenticated Admin UI also has browser evidence for billing-policy configuration, task creation/classification, eligible assignment with a separate reviewer, and due-date editing. A fresh isolated Compose run verified synthetic founder setup and public-origin capture, then email-free verification handoff reveal/consumption and sign-in as verified. Forgot-password returned a neutral response; a Super Admin revealed the manual reset handoff, set a new password, signed in with it and was rejected with the old password. The reset page removed the token from the address bar. Employee-originated task/work submission, reviewer decisions/handover, correction creation and broader Work/HR journeys remain. The UI is still text-heavy; visual-system, accessibility and responsive checks remain. WSL must stay active during browser QA. |
| Portability | PostgreSQL 17 schema, RLS and runtime behavior pass in Docker-in-WSL; the disposable Supabase project also passed exact pooler login, 74-migration preflight, health/readiness and Better Auth throttling through the non-owner role. Full authenticated Cloud lifecycle, live Cloudflare/Netlify/Vercel, an actual VPS and native Windows PostgreSQL remain unproven. |

## Newly specified behavior and dependency plan

The canonical semantics are in PRD §§16 (task billing/corrections), 26 and
42.1 (WFH). These are product rules
and evidence gaps, not permission to build a second task or attendance system.
The reusable task catalog, audited optimistic due-date editing, the first
complete pending-WFH vertical slice and editable role-starter drafts are
implemented as described above. Task classification uses one workstream
default plus optional per-definition rules; corrections remain separate linked
work and use their own definition rule/default. Broader
deployment/UI proof remains a separate gate.

| Feature | Safe integration into the existing system | Required proof before completion |
| --- | --- | --- |
| Pending WFH while work continues | Implemented through migration 0064 and the existing attendance/work-session, availability, lifecycle and background-tick paths. Provisional evidence is separate and non-creditable; required timers link to the exact open request; approval promotes it, while rejection/cancellation closes only its timer/evidence and keeps task history. Office check-in is blocked until the employee cancels the pending request. Boundary close uses the captured office timezone. | Proven locally: approval, rejection, cancellation, office-check-in conflict, leave conflict, linked timer closure at the same microsecond, freeze cleanup, DST boundary and repeated-tick idempotency. Concurrent rejection-versus-cancel has one winner, one conflict and one decision event. Concurrent approval-versus-cancel with live provisional attendance and a running linked timer also passed (approval won on the recorded run; cancellation conflicted; promoted attendance remained valid and the timer continued until explicit cleanup). Missed-tick recovery against the long-running deployment worker remains. |
| Predefined task list and automatic classification | Implemented: catalog entries/proposals store reusable content only; task/catalog APIs reject class input. Organization workstream tasks are non-billable; each client workstream has a default plus optional per-definition rules. Employees and reusable-task authors never classify work. The separately role-grantable `workstreams.billing_policy.manage` permission controls the workstream default and per-definition rules; `tasks.create.billable` independently authorizes an action already classified as billable. Changes require reason/revision, are audited, future-only, and cannot alter existing task/session snapshots. Corrections are separate linked work items using their own selected definition rule/default; they do not copy/change the source class or reopen/mutate the source. No invoice/rate/payroll behavior is implied. | PASS locally: task/catalog/API/DB class-injection rejection; legacy endpoint returns 410 and directs to canonical rule route; tenant/scope RLS; workstream/default/per-definition revision and reason; rule reset-to-inherit; policy/task-create serialization; employee and role/action denial; correction source visibility/completion/same-stream/nesting/multiple/retry, source immutability and billable-action authorization; separate 0072→0074 migration restoration from audit evidence. Authenticated local browser verified client/workstream default setup, a content-only predefined definition, per-definition rule, and one-off/predefined task class/provenance. It exposed and then verified fixes for both ineligible self-assignment and ineligible people being offered as task assignees; the UI now blocks/offers only according to current eligibility while server enforcement remains. The existing QA container received only the changed static asset and compiled read handler because its current auth/bootstrap environment differs from root `.env`; clean image rebuild/deployment, hosted provider migration/upgrade, eligible employee/reviewer correction journeys and sustained load remain release gates. |
| Due dates | Keep PostgreSQL `DATE`; due/overdue evaluation uses each assignee's office-local business date. Migration 0066 adds a `due_date_revision`, a scoped `tasks.edit` command requiring both the expected date and revision, terminal-state protection and an audit record. Edits expire old in-app due notices, cancel unsent/leased email and notify current assignees through the normal in-app/opt-in-email adapter. The tick locks candidate tasks, keys reminders by revision and skips a row held by an edit; the worker rechecks its lease immediately before SMTP. Past dates remain valid backlog input. | Locally tested: edit-vs-scheduler lock overlap; queued and leased reminder invalidation; stale/no-op/invalid edits; role-controlled API access; audit/notice; repeated schedule tick. Authenticated browser saved a due date on a synthetic unassigned task; the task list and audit event reflected the write, and the UI correctly reported zero assignees to notify. Remaining: several assignees in offices on opposite sides of UTC midnight; DST/overnight boundaries; handover/approval/cancellation timing; live-provider email behavior. A message already in flight with SMTP cannot be recalled. |
| Role changes | Grant and operational-policy edits apply at the next domain authorization check; the login session stays valid. The API audit records before/after role state. Role saves require the revision read by the editor; a stale save returns `ROLE_VERSION_CONFLICT` without applying any fields, and a successful update atomically writes role, grants, policy and audit. | Proven locally: revoke `tasks.start`, deny a new timer, preserve session, let the owner stop the existing timer, regrant and start again; race two complete edits at the same revision and prove exactly one wins with no mixed state. Also test reviewer/handover submit-time revocation and authenticated browser recovery after a stale-edit conflict. |

Implement each as a vertical slice through one migration, canonical permission
catalogue, transaction/lock rule, audit event, API contract, UI path and
focused race test. Reuse task, review, attendance and authorization boundaries;
do not introduce a generic workflow engine. Keep attendance credit separate
from real work history, correction purpose separate from billing class, and
task billing classification separate from payroll/invoice execution.

## Remaining work, in dependency order

### 1. Preserve the verified QA baseline in CI

The repeatable QA profile passes from Windows through WSL Docker using
`bun run qa:postgres`. It uses a unique Compose project and a QA-only private
PostgreSQL service that does not publish port 5432; on success it removes only
the run-scoped container/network and the volume after verifying its Compose
labels. `.github/workflows/verify.yml` now configures fast
unit/type/build checks and a clean-from-zero PostgreSQL 17 gate covering
migrations, 53 rollback/RLS fixtures, authenticated lifecycle, specialized
smoke and role preflight. The workflow has not yet run on GitHub; verify its
first hosted run before treating CI as an established release gate. Do not
count migrations alone as lifecycle proof.
On failure, the harness reports the generated project, stops its `postgres-qa`
service, and retains its container and run-scoped volume for diagnosis. Failed
QA services do not auto-restart. After a fix, remove the exact database only
after checking its owner and that there are no active sessions. Clean leftover
Compose resources only after checking their generated project/volume labels.
Never use `down -v`, delete a shared volume, or remove the `nova` database. Do
not silently clean pre-existing QA-named data.

### 2. Complete the employee/role behavior matrix

Use synthetic identities and verify both the API response and resulting rows:

1. Create custom role; inspect effective permission/scope/policy summary; grant,
   revoke and regrant; reject privilege escalation; verify existing users do
   not gain rights when a role definition or future preset changes.
2. Invite an employee into a specific organisation, department, office and
   role; set password, verify, activate, sign in, and confirm the first
   workspace matches effective access. Try stale invite, duplicate invite,
   expired token, altered email, frozen/departed person and disabled email.
3. Create a client-workstream task as an editor with scoped `tasks.create` and
   `tasks.view`; ensure creator self-assignment is atomic, reviewer is eligible
   and client review is retained. Test absent/out-of-scope grants, a deleted or
   archived workstream, duplicate retries and simultaneous create/assign.
4. Exercise submit, review, decline/resubmit, unavailable reviewer replacement,
   two-sided handover, withdrawal/decline/expiry, A→B→A return handover with
   preserved assignment history, concurrent handovers to one recipient,
   handover-vs-submit race, freeze with live timer, transfer and offboarding.
   Verify old sessions and assignments cannot be reused, audit history remains,
   and retries have stable conflict/idempotency outcomes. Repeat transfer under
   varied role scopes before claiming that matrix complete.

The 2026-09-23 isolated lifecycle now covers scoped role create/read/revoke/
regrant, escalation denial, duplicate invitations/onboarding, manual invitation
and reset handoffs, atomic client-workstream create/self-assignment, out-of-scope
denial, reviewer acceptance, two-sided handover and old-assignment denial,
email mismatch and replay denial, expired invitation and password-reset tokens,
handover withdrawal/decline/expiry and replay, handover-vs-submit and review-
decision races, pending-review cancellation, a complete changes-requested/
resubmit/final-approval cycle with both review records and cycle-specific
in-app notices, expired manual reset-handoff denial, freeze with a live timer,
reviewer replacement and handover-first offboarding. Still not proven:
assignment transfer under varied role scopes, and authenticated browser
verification of the newly added role-starter selector. Archiving is a
scope/contract gap, not
just a missing test: archive columns and an archive-related permission
description exist, but there is no application command to produce that state.
Do not invent archive behavior in a test fixture; either explicitly defer the
capability from V1 or define its authorization, active-assignment, history and
unarchive rules before implementing and testing it.

The time-focused integration smoke also writes a timeline correction using
six-digit fractional seconds while the API clock is deliberately two days
slow, then verifies the stored interval and audit input. Attendance recovery
reuses exact microsecond timestamps while the API clock is one day slow and
verifies the response, stored row and correction audit. These tests use
database time and do not change the operating-system or PostgreSQL clock.

Role starter profiles are convenience only: the implemented selector fills an
unsaved role form with an editable snapshot of grants, scopes and operational
policies. Target IDs stay blank until the Super Admin chooses them; unsupported
permissions/scopes are omitted and disclosed rather than widened. The normal
role command and grant-delegation check perform the save. Profiles are not
attached to saved roles, so changing a profile cannot mutate existing users'
access. The profile resolver is unit-tested; the authenticated browser flow is
still an explicit UI verification gate.

### 3. Test authentication, email and notification recovery as one journey

Keep sign-in/session identity, domain authorization, in-app notifications and
outbound email as separate concerns. Use a deterministic local mail sink first,
then opt-in provider sandbox accounts. Cover:

- Email absent, globally off, adapter disabled, bad credentials, timeout,
  provider throttle, rotated/replaced credentials and one failing recipient.
- Invitation, verification and password reset: expiry boundary, one-time use,
  replay, concurrent reset, session revocation, configured-origin links, and
  origin changed while old links/queued notices exist.
- Secure manual handoff when delivery is unavailable: reveal once, audit actor
  and reason, short expiry, no URL/token in logs, safe retry and revocation.
- In-app notifications remain available and domain operations remain correct
  if email is off or failing. Outbound delivery is optional and bounded;
  notification retries/leases recover from worker crashes without duplicate
  state transitions.
- Validate each adapter against one shared health/test/send contract (SMTP /
  Nodemailer, Gmail OAuth, and any configured provider); do not claim live
  provider compatibility from the shared interface alone.

### 4. Prove time, attendance and cross-module invariants

Use fixed timestamps and PostgreSQL transactions, never host-clock changes.
With at least two offices in distinct timezones, test office-local midnight,
overnight shifts, DST skipped/repeated times, two office boundaries at different
UTC instants, and office/timezone transfer while an attendance or work timer is
open. Include exact timestamps and PostgreSQL microsecond edges; browser
milliseconds must not lose or reorder database events.

Race attendance-mode changes against leave/WFH approval, geofence check-in
against denied/low-accuracy/stale coordinates, and shift closure against
manual checkout. Assert single transitions, stable conflict responses, audit
provenance, and that browser GPS is treated as a signal rather than
unspoofable presence proof. For timers, cover handover, freeze, absence,
business-day closure and restart/retry without double time.

### 5. Verify one scheduler per deployment and the portable tick

Keep domain maintenance in `runBackgroundTick()` and use deployment-specific
triggers only through the protected endpoint. Set the same supported
`NOVA_BACKGROUND_SCHEDULER` value on all runtimes connected to one database;
each built-in trigger identifies itself and mismatched providers fail closed.
The Supabase install/disable commands own only NOVA's named Cron job and Vault
secrets. Cloudflare has an explicit no-Cron Wrangler config, Netlify selects an
API-only function directory, and Vercel emits an empty Cron list when Supabase
Cron is selected. For each released runtime, still configure exactly
one live trigger and capture its run evidence. The selector cannot detect two
duplicate schedules using the same provider identity. Test late/missed
invocation, retries, secret rotation, database/network failure, shutdown during
work, and recovery.
The isolated lifecycle runs two ticks concurrently and asserts reviewer state
reconciliation and notification idempotency. Still exercise overlapping
boundary closures and a slow/failing notification batch to prove it cannot undo
committed attendance/timer closure.
Fixtures 0062 and 0063 cover repeatable office-boundary closure and notification
lease recovery/stale-token rejection. The lifecycle verifies two overlapping
selected-`vps` ticks on an isolated database, but does not cover late/missed
invocations, live provider schedules or provider run history;
the Supabase catalog/temporary-Cron evidence and endpoint 200 are not substitutes
for a live deployment check on each selected host.

Provider-emulator boundary: Cloudflare documents local `wrangler dev` with a
Hyperdrive `localConnectionString` and a local `/cdn-cgi/local/scheduled`
trigger, so an isolated Cloudflare Worker + direct-PostgreSQL smoke can
exercise both API and scheduled adapter without a Cloudflare account
([Hyperdrive local development](https://developers.cloudflare.com/hyperdrive/configuration/local-development/),
[scheduled handler](https://developers.cloudflare.com/workers/runtime-apis/handlers/scheduled/)).
Resolved on 2026-09-26 with Wrangler 4.141.0. `wrangler deploy --dry-run`
successfully bundled the configured Worker and read all 10 static assets
(3,205.72 KiB uncompressed / 549.89 KiB gzip) without uploading it. A local
`wrangler dev` session with a deliberately unreachable loopback database URL
returned 200 for `/` and `/api/health`, proving actual Worker startup and shared
API module loading without a database query. A separate local-only
`cloudflare/email-runtime-smoke.ts` harness passed all five checks inside
workerd: HTTPS-only token refresh, Gmail API authorization, Nodemailer/Node
stream MIME composition, stable Message-ID and provider response ID. Google
calls were mocked; no external request, real email, database connection or Cron
invocation occurred. The regression check is now in GitHub Actions with Wrangler
version 4.141.0 pinned, but that hosted workflow has not yet run. These are local
Worker tests, not a live Cloudflare deployment or Hyperdrive-to-Supabase test.
Cloudflare type checking and the customer browser's scheduler choice alone
would not have been Worker runtime proof. Netlify's own docs say Netlify Dev can invoke a scheduled handler once
but does not run its cadence; deployed schedule behavior must be proven on a
published site ([Netlify Scheduled Functions](https://docs.netlify.com/build/functions/scheduled-functions/)).

Database-backed Cloudflare local test on 2026-09-26: Wrangler 4.141.0 ran the
Worker in local Workerd using a request-scoped PostgreSQL `Client` and the
disposable PostgreSQL 17 database; migrations 0001–0074 completed. `/api/health`
and `/api/ready` returned 200; an unauthenticated internal tick returned 401;
the protected tick returned 200 with zero-work counts. Wrangler Local Explorer
invoked the Worker's scheduled handler, and captured Workerd logs recorded
`[NOVA Cloudflare] background tick completed with HTTP 200`. This closes the
local Worker/database/scheduled-handler emulator gate. It is not evidence for
a remote Hyperdrive binding, a deployed Cloudflare account, or production Cron
cadence: local development connects directly to PostgreSQL and does not exercise
Hyperdrive's managed pooling/cache. The Worker continues to reject a non-2xx
tick so the provider can record a failed invocation. No Cloudflare account,
remote binding, Supabase project, or live scheduler was used in this test.

A 100-employee burst through this request-scoped local-direct mode then hit the
disposable PostgreSQL server's default `max_connections` (`too many clients`).
Cloudflare documents that local Hyperdrive connection strings bypass pooling;
the separate bounded Node-pool 100-employee burst passed, but neither run proves
the real Cloudflare-to-Supabase pool behavior. The hosted Hyperdrive origin
connection limit must be set within the selected database's connection budget,
and a 100-employee burst through a real Hyperdrive binding remains a release
gate. The operator guide now calls out that limit instead of presenting local
direct mode as a production pool emulator.

### 6. Turn the setup checklist into a truthful customer handoff

Keep runtime host, database and scheduler as separate but constrained choices.
For the selected combination, guide the operator through: repository deploy,
where runtime secrets belong, canonical database migration, role/RLS preflight,
public origin and allowed origins, exactly one scheduler, health/readiness/tick
verification, first Super Admin setup, and backup/recovery. Show which steps
are automated versus confirmed by the operator; timestamp the read-only API and
schema checks and rerun them after configuration changes. Never collect provider
credentials in browser storage or show green readiness based only on checkboxes.
The assistant remains an instruction checklist for provider-side actions; it
does not connect provider accounts or apply settings. Its checkboxes are
operator attestations. Actual provider installation, provider run history,
migration-owner preflight in the customer flow, and automated evidence
freshness are not claimed.

### 7. Make the existing UI usable before the design-system phase

Browser evidence is partial and comes from separate isolated runs. The
2026-09-26 public-only pass used a loopback server with no database, auth secret
or provider credentials: setup rendered; sign-in → forgot-password → sign-in
navigation worked; invalid reset and incomplete-invitation links showed safe
states; and the Cloudflare + Supabase assistant correctly kept Continue disabled
when only API health—not database/runtime readiness—was available. It submitted
no forms. Earlier local PostgreSQL browser runs additionally covered synthetic
founder setup and public-origin capture, email-disabled verification handoff,
invitation → handoff → verification → onboarding, role create/edit/revoke/reopen,
admin-side billing-policy and task/classification setup, eligible task
assignment with a distinct reviewer, and due-date editing. The deployment
assistant's provider paths and scheduler choices were exercised as a local
checklist, not as hosted installations. These runs do not prove employee-driven
task submission, reviewer decisions/handover, correction creation, or browser
WFH/leave/attendance workflows. See the verification matrix for the asset
source and WSL networking caveats.

A second 2026-09-26 browser pass used a fresh local PostgreSQL-backed Compose
deployment. It selected Cloudflare + Supabase, Netlify + Supabase, Vercel +
Supabase, Docker/VPS/PostgreSQL and local Docker, then verified each path's
allowed scheduler choices and provider-switch guidance without marking real
deployment steps complete. The read-only deployment probe correctly showed
API/database readiness and disclosed what it did not verify. The first-run
attendance selector was exercised both ways: scheduled mode hides the
hour-duration input, switching back restores its value, and an empty founder
form is blocked by native required-field validation. No founder credentials
were entered and no account was created in this pass. This is local UI/checklist
proof, not a hosted deployment or live-scheduler test.

A fresh Compose image was built for a uniquely named browser-QA project; its
migration container exited successfully and initial Windows requests to the
API health route and app shell returned 200. The host-published WSL port then
stopped accepting requests while the distribution was idle, so that attempt
made no browser-flow claim and its project-labeled resources were removed. A
later isolated rerun kept WSL active and completed setup, email-free
verification and password-reset browser journeys. The in-app browser and
Windows loopback worked together; pre-existing WSL projects were left
untouched.

The deployment guide was tightened after the customer setup question exposed a
real ambiguity: the prior screen saved a scheduler choice locally but did not
apply it to the hosting provider. The guide now names repository
files/configuration, action location, effective deployment, secret store, and
provider verification for Cloudflare, Netlify, Vercel, Supabase Cron, VPS and
local Docker. It explicitly says GitHub import/deploy does not provision
Supabase, copy secrets, map DNS or install a Supabase Cron job. The ordered UI
now distinguishes host-native schedules (activated by the configured
production deploy) from Supabase Cron (created after API readiness), and labels
an early auto-published import as an unready bootstrap build. The latest UI
change replaces dense top-level wiring prose with a four-part “Who does what”
map and hides domain/login/email detail behind an expandable note. It keeps the
exact provider actions: Cloudflare + Supabase shows the no-native-Cron Wrangler
command before deploy and reveals `bun run supabase:scheduler` only after
matching readiness, naming the trusted operator computer and resulting
`pg_cron`/`pg_net` job. The latest screen replaces the compressed four-part
summary with a six-row “Your action → what happens next” map for code/API,
PostgreSQL, runtime access, domain/links, login/email, and background work. The
rendered-flow smoke now drives all eight valid host/scheduler pairings and
checks that each names the customer action separately from the provider effect;
it also confirms the Supabase command remains readiness-gated. This is a UI
contract check, not evidence of a live provider write. To reduce repetition,
the six-row map now points to the scheduler card instead of repeating its
provider-specific command/effect; the card is the one place that explains where
the trigger lives, what activates it, and where to verify it. The smoke asserts
that all pairings retain those details and that no Supabase Cron write is shown
before readiness. A rebuilt uniquely tagged VPS/Compose API image was checked
to contain the revised browser assets, then its temporary image tag was removed.
Cloudflare guidance now
allows up to 15 minutes for trigger changes to propagate before checking its
run history. The current unit suite passes (118 tests, 512 assertions), along with API,
operator/deployment and Cloudflare typechecks, server build, and browser-script
syntax. Vercel now uses documented build-time `vercel.ts` configuration: its
Production deploy registers Cron only for the `vercel` selector and publishes
no Vercel Cron for `supabase`; local unit and rendered-flow checks cover both
outcomes. This removes the Vercel repository-edit step, but is not a live
Vercel deployment. Netlify's committed local build plugin now chooses one
functions directory from the production selector and omits the scheduled
entrypoint for Supabase Cron; plugin contract tests pass, but a live Netlify
build remains unverified.
Fresh isolated PostgreSQL QA passed migrations 0001–0074, all 53 rollback/RLS
fixtures, the 604-assertion lifecycle, WFH/attendance/leave/geofence smoke,
application-role preflight and the 0072→0074 upgrade. A separate repeated
100-employee burst passed 2,414 assertions with 100 tasks, assignments and
closed timers and zero open timers. The exact disposable Supabase project's
read-only audit and application-role preflight returned migration 0074 and
`ready`; no cloud write or schedule was made. Review found root `.env` still
points at the primary project while `.env.qa-supabase` names the disposable
project. A fresh safe presence check found that the QA file has no management
token, public HTTPS origin or tick secret, while root `.env` still has no public
origin and names the primary project. Therefore a hosted Cron cannot be
provisioned or safely pointed at a live API yet. Supabase migration/bootstrap
and scheduler install/removal now require
the operator to type the exact displayed project ref (or pass an exact
confirmation only for non-interactive execution); the confirmation is not
persisted to `.env`. No provider account was changed.
Remote Cloudflare Hyperdrive/Cron and all live hosting-provider deployments
remain unverified. The screen labels progress as a customer checklist, not
remote proof.

The scheduler choices now name in plain language where the work runs; the
expanded instructions retain exact provider files and technical mechanisms.
The scheduler panel also gives a short “lives in / turns on when / confirm it
worked in” summary. Cloudflare Cron is activated by the Worker's production
deploy; Supabase Cron is a separate database write from a trusted operator
checkout after readiness; VPS uses its Compose worker. The old generic sentence
that mentioned Compose for hosted schedulers was removed. A rendered local
browser check confirmed that Cloudflare Cron points to the Cloudflare Worker
and Supabase Cron points to the Supabase project, with the provider-specific
configuration shown below each.

The latest isolated current-build browser run passed setup, saved the synthetic
workspace's public origin, requested and revealed its email-free verification
handoff, consumed the local verification link, and showed `Verified` with no
pending handoff. Forgot-password returned the expected account-enumeration-safe
message and staged a reset handoff. The reset handoff was revealed, the NOVA
reset form accepted a new synthetic password, and that password signed in.
However, navigating to the raw Better Auth reset URL did not visibly land on
the reset form in that browser session; the screen was opened using the
NOVA `/reset-password?token=…` route. The API lifecycle harness separately
asserts the raw link's redirect target, but this browser observation remains a
customer-click investigation, not a confirmed product defect. No real
credentials or external provider account were used.

Complete the missing authenticated employee/reviewer journeys, role-starter
selector journey, onboarding-only HR/workstream-only access, and browser
attendance/WFH/leave/freeze/offboard coverage. Broader workflow screens still
need reduced text density: clear next action, short reason, optional technical
details, explicit provider location, and distinct success/blocked/stale/retry
states. Check keyboard-only
operation, focus/error announcements, responsive layouts, timezone labels and
effective role-access summaries. Add templates only with editable preview and
no hidden privilege bundle. Broad visual polish follows workflow and
accessibility QA. The WSL-only Docker engine must remain alive during browser
QA; see the exact local boundary in the verification matrix.

The new `/api/me/permission-grants` read and fail-closed browser helper gate
write forms by the actor's effective permission and exact scope; owner transfer
is shown only for the database-confirmed Super Admin. A restricted-role mock
browser pass verified that Admin/Invite navigation and the invitation, role,
organization, availability, work, catalog and billing-rule forms are absent
without their action grants. Settings retains self-service password change and
verification while hiding public-origin, email-connection and handoff actions
from a restricted actor; the same mock confirms those controls remain for a
Super Admin. The browser caught `.form-grid` overriding the native `hidden`
attribute; the stylesheet now enforces hidden form state globally. A deep link
to Admin or Invite shows permission states without write forms. 403 reads
remain access errors rather than false empty states.
Core Admin reads are parallel but individually wrapped with `readOrError`, so
one 403 does not reject the aggregate `Promise.all` or erase the console. Real
onboarding-only HR and workstream-only role journeys remain to be proven. API
authorization remains authoritative. Optional leave/WFH/exception,
work-context, task and task-catalog reads preserve their failure state and show
access/retry notices instead of false empty states. Work also surfaces failures
for review and collaboration queues, attendance status, correction-task sources,
reusable definitions and per-assignment reviewer/handover candidates; it withholds
correction links and candidate forms when source reads fail. Operations reports
unavailable counts and withholds CSV exports when their reads fail. Unit tests
cover success, permission-denied and retryable-failure behavior. The capability
gates also passed the restricted-role mock-browser check; authenticated
onboarding-only HR and workstream-only journeys remain. Because
`app.js` now imports a separate Admin read-state module, Vercel's explicit static
rewrite list includes that module and the adapter contract test guards the
mapping; Netlify, Cloudflare and direct PostgreSQL hosts serve it from the shared
`web/` directory.

### 8. Run release portability, load and recovery rehearsals

Use a layered matrix rather than every host × DB × scheduler combination on
every change:

| Gate | Minimum coverage |
| --- | --- |
| Every code change | Unit/domain tests, typecheck/build, adapter compile/config checks |
| Database CI | Fresh PostgreSQL 17, migrations from zero, RLS/constraints/rollback, complete seeded lifecycle |
| Release candidate | Supabase Cloud runtime smoke plus direct PostgreSQL smoke; live trigger on each released runtime |
| Scheduled stress | 50–100 synthetic employees in multiple offices; timer/task/reviewer/leave races; throughput, latency and invariant checks |
| Recovery | Upgrade from prior supported schema, backup/restore, interrupted tick, credential/scheduler-secret rotation, email/manual recovery |
| Platform-specific | Separate native-Windows PostgreSQL and actual VPS run; Docker-in-WSL does not substitute |

Record runtime, PostgreSQL version/provider, selected scheduler, migration
ledger, application-role attributes, test seed and outcomes without secrets or
real employee data. Do not call the broad design-system phase release-ready
until the functional browser paths and critical portability/recovery gates are
green; load and platform-specific evidence remain explicit if scheduled
separately.

## Remaining release gates

The fresh elevated WSL rerun passed the direct-PostgreSQL gate on 2026-09-26:
  all 74 migrations, 53 rollback/RLS fixtures, 604 authenticated lifecycle
assertions, specialized WFH/attendance/leave/geofence smoke, app-role preflight,
and the 0072-to-0074 upgrade rehearsal. Its uniquely generated database and
Compose resources were removed; the default-sandbox attempt had failed before
Docker startup because WSL returned `E_ACCESSDENIED`. A separate customer-style
Compose deployment then applied all 74 migrations, served health/readiness and
the UI, enforced invalid-secret (401) and unselected-provider (409) tick guards,
and completed a selected local VPS tick (200). The first candidate PostgreSQL
host port belonged to an existing WSL container despite appearing free to
Windows; retrying on a port verified free in Docker succeeded without touching
that stack. Remaining gates are
onboarding-only HR/workstream-only Admin UI browser journeys, authenticated
Supabase Cloud domain-lifecycle smoke on the exact disposable project, actual
provider deployments and trigger runs for
the supported hosted targets, sustained multi-office 50–100 employee load,
native Windows PostgreSQL and VPS installation/recovery, mail-provider fault
tests, and authenticated browser/accessibility/responsive coverage. These need
isolated accounts/credentials and must not be simulated by claiming a local
compile or checklist checkbox as live evidence.
