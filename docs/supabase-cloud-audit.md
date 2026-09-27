# NOVA Supabase Cloud audit

Date: 2026-09-22

Historical snapshot: this audit records the 2026-09-22 migration-0061 state.
The current disposable-project evidence through migration 0074, including
application-role login and read-only readiness checks, is recorded in
`docs/verification-matrix.md`. This historical project reference is not the
target for current QA commands.

Scope: only the user-designated `nova` project (`hrlvietbqvkdovulzcie`). No
credentials, API keys, database passwords, or user data are recorded here.

The repository's current canonical migration is
`0061_better_auth_rate_limits.sql`. On 2026-09-22, the guided Supabase
bootstrap completed successfully against the designated project and applied
the canonical migrations through 0061. A fresh read-only catalog audit was not
performed afterward because the bootstrap intentionally removed the management
token from the local `.env`; this document therefore records application
success but does not invent catalog counts for 0060/0061. The
public-origin catalog check reports 49 RLS-enabled NOVA tables, zero RLS tables
without policies, zero PUBLIC-executable NOVA security-definer functions, and
the non-superuser/non-`BYPASSRLS` `nova_app` role with explicit non-owner
grants, including the three narrow public-origin function grants.

The repository now explicitly enables Better Auth's database-backed rate
limiter. Migration `0061_better_auth_rate_limits.sql` adds its portable
`nova_auth."rateLimit"` table. The management API accepted the migration;
role/RLS/catalog verification remains a separate read-only check.

The post-bootstrap non-owner runtime check confirmed `nova_app` is not a
superuser, does not have `BYPASSRLS`, cannot read the migration ledger (the
expected owner-only boundary), and can resolve both `nova.people` and
`nova_auth."rateLimit"`. A local API smoke against the same project returned
health 200, readiness 200, one protected background tick 200, and the live
Better Auth invalid-login sequence `401, 401, 401, 429`.

## Read-only findings before migration

- Project status: `ACTIVE_HEALTHY` in `ap-northeast-1` on PostgreSQL 17.6.
- The designated project is the only Supabase project in scope.

## Compatibility decision

The canonical NOVA migration now relies only on PostgreSQL 17's built-in UUID
generation and a lowercase-email constraint. It creates `btree_gist` inside the
NOVA schema for effective-dated exclusion constraints. This removes reliance on
Supabase's `extensions` search path while retaining the same direct PostgreSQL
schema definition.

## Applied bootstrap

`bun run supabase:bootstrap` uses the official Supabase migration endpoint for
the project ref explicitly supplied through `NOVA_SUPABASE_PROJECT_REF`. It
creates the non-owner `nova_app` database login role, applies the canonical
People & Identity migration, writes NOVA's migration ledger, and runs the
rollback-only PostgreSQL RLS test through the database query endpoint. The
management token is a local/CI deployment secret only; it must never be placed
in Netlify, Vercel, or the NOVA API environment.

Applied successfully on 2026-09-18 and extended on 2026-09-20 to the
designated `nova` project only. The empty-project run applied migrations
through `0041_office_business_date_authorization.sql` and completed every
rollback-only PostgreSQL test. Migrations `0042_notification_enqueue_function.sql`
through `0045_tasks_create_client_scope.sql` were subsequently applied and
ledger-verified on the populated disposable project.

After the authenticated smoke created the labelled `NOVA Runtime Smoke`
organisation, a subsequent bootstrap rerun confirmed the migration ledger and
correctly skipped the empty-database fixture tests rather than attempting to
bootstrap a second organisation.

The designated development project now intentionally contains that labelled
smoke organisation, founder, smoke role and Console adapter. Treat it as
disposable development data; do not use this populated project as the empty
database fixture target for future migration tests.

On 2026-09-21 the corrected `0046_attendance_policy_and_lifecycle.sql`
migration was applied through the same project-scoped management API. A
read-only post-check reported 46 ledger entries, the explicit attendance-policy
bootstrap function present, RLS enabled on
`nova.organisation_attendance_policies`, and `nova_app.rolbypassrls = false`.
Migration `0047_assignment_session_closure.sql` was then applied to the same
project; a read-only catalog check confirmed 47 ledger entries, the canonical
assignment closure function, its `nova_app` execute grant, and
`nova_app.rolbypassrls = false`.
Migration `0048_review_blocking_and_reviewer_change.sql` was then applied to
the same project; at that stage the ledger contained 48 entries and the review
cycle reviewer column accepts a temporary null only for an explicitly blocked
open review.
The read-only catalog check also confirmed the blocked-review constraint, zero
RLS-enabled NOVA tables without a policy, zero insecure `SECURITY DEFINER`
functions, and `nova_app.rolbypassrls = false`.
Migration `0049_operational_actor_rls_gate.sql` was then applied; the current
ledger contains 49 entries, `nova_app` can execute the shared actor-context
function, all 47 NOVA tables remain RLS-enabled with policies, and no insecure
security-definer function was found.
Migration `0050_review_cycle_integrity.sql` was then applied; the current
ledger contains 50 entries and the blocked-review cycle trigger is present.
Migration `0051_workstream_requests_and_resolution.sql` was then applied to
the same designated project. The current ledger contains 51 entries; the
reviewer-request and handover tables are present, both are RLS-protected, the
policy-resolution and `REVIEWER_UNAVAILABLE` constraints are present, and the
canonical timer-closure functions remain executable by `nova_app`.
The follow-up catalog query reports 47 NOVA tables with RLS enabled and no
RLS-enabled NOVA table without at least one policy.
Migration `0052_auth_system_handoffs.sql` was then applied to the same
designated project. The current ledger contains 52 entries; `nova.auth_handoffs`
and its organisation-scoped RLS policy are present, the encrypted one-time
staging function and `auth.manual_recovery` permission are present, and the
application role remains non-superuser and non-`BYPASSRLS`.
Migrations `0053_restrict_actor_context_function.sql` and
`0054_super_admin_business_date.sql` were then applied. The current ledger
contains 54 entries; the RLS actor helper is no longer executable by `PUBLIC`
but remains executable by `nova_app`, and protected Super Admin effective-date
checks use the office-local business date. Migration
`0055_super_admin_operational_status.sql` then made the same protected-role
resolver require an active or notice lifecycle status inside the transaction.
The current ledger contains 55 entries.
Read-only post-checks confirmed:

- 48 NOVA tables, all with RLS enabled;
- four Better Auth infrastructure tables in the separate `nova_auth` schema;
- `nova_app` is non-`BYPASSRLS`;
- the `nova` schema is owned by the migration/admin role, not `nova_app`;
- the empty-project rollback-only test left zero organisations and no
  `nova_rls_test` role before the runtime smoke;
- `nova_app` can execute the one-time bootstrap function, while `PUBLIC` cannot;
- `nova_app` can execute the authenticated-actor resolver, while `PUBLIC` cannot;
- the Supabase transaction pooler accepted an encrypted, read-only Node runtime
  connection as `nova_app` using its project-qualified shared-pooler username;
- the rollback-only tests left no test roles or fixtures before the runtime
  smoke;
- `nova_app` remains non-`BYPASSRLS`;
- the ledger contains 55 canonical migrations through
  `0055_super_admin_operational_status.sql`, including encrypted email delivery,
  invitation verification, Better Auth lifecycle gates, availability/leave,
  approved WFH requests, office geofence evidence, collaboration context,
  bounded attendance recovery, location-evidence retention support, and the
  durable in-app notification/optional email-staging slice, the
  database-enforced permission-to-scope catalogue, and the leased
  provider-neutral notification worker boundary, and explicit portable
  maintenance access for evidence retention, and the database-enforced
  productive work-session model, office-local business-date resolution, and
  effective-dated client departments/memberships with overlap protection, and
  immutable task review-cycle history, plus PostgreSQL-enforced,
  auditable past-only timeline adjustments that cannot overlap timer-backed
  work or another adjustment, and explicit permission-gated notification
  delivery inspection/replay functions, and strict reviewer-exception
  provenance constraints, the employee-own timeline view scope, the
  idempotent due/overdue notification scheduler, and the office-business-date
  protected-role resolver repair.

The specialised authenticated smoke most recently passed with a newly created,
labelled disposable Super Admin fixture: separate WFH/leave review, WFH
attendance, geofence rejection/acceptance, checkout and leave/WFH conflict
enforcement. The resulting notification audit included
`attendance.location_rejected` and `availability.calendar_changed`; the
fixture rows remain disposable development data in this project.

The final boundary read confirms `nova_app` is neither superuser nor
RLS-bypassing, and RLS is enabled on `attendance_days`, `leave_requests`,
`notifications` and `wfh_requests`.

The application-role deployment preflight was also run through the exact
project transaction pooler after migration 0051 and returned `status: ready`.
The migration ledger was intentionally checked through the project-scoped
management query above because no migration-owner URL is stored in this
workspace environment.

Migration `0043_work_session_boundary_join.sql` fixed the original office-local
join. Migration `0059_boundary_closure_and_office_snapshots.sql` now closes
attendance and work at the first office-local boundary, snapshots the session
office for transfer/timezone safety, and records automatic attendance closure
audits. The portable background tick completes the same sequence on every
deployment shape.

Migrations `0044_collaboration_scope_catalogue.sql` and
`0045_tasks_create_client_scope.sql` keep custom-role collaboration scopes
aligned with the API target resolver, including client-scoped task creation.

The follow-up read-only catalog/preflight audit on 2026-09-20 found no NOVA
table without a primary key, no RLS-disabled NOVA table, no RLS-enabled NOVA
table without a policy, no unsafe security-definer function without a fixed
`search_path`, and no multiple permissive-policy collision. The only public
application-schema table is the owner-only `public.nova_schema_migrations`
ledger; `nova_app` has no privileges on it. The exact non-owner transaction
pooler preflight passed with application role `nova_app` and schema status
`ready`.

The earlier 2026-09-20 note that migration `0046_attendance_policy_and_lifecycle.sql`
was pending is superseded by the 2026-09-21 application and post-check above.
The populated project uses the disposable authenticated smoke runbook for
attendance-policy and lifecycle verification; the repository's rollback-only
SQL fixtures remain intentionally isolated from this populated database. The
0047 post-check also confirmed `nova.close_assignment_work_sessions` exists,
`nova_app` can execute it, and `nova_app` remains non-`BYPASSRLS`.
