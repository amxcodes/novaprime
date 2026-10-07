# NOVA foundation design

This is the technical design for the first vertical slice. Product rules remain in
`NOVA PRD.md`; this file does not duplicate or replace them.

## Architecture

NOVA is a modular monolith:

```text
Same-origin static web client
        |
NOVA API commands
        |
PostgreSQL constraints and transactional operations
```

The database is canonical. The API performs authentication, resolves the actor
and organisation, authorizes every mutation against current state, runs a
transaction, and returns domain-shaped results. The client never owns a business
rule or sends authoritative role, organisation, timezone, or timestamp claims.

For every authenticated database transaction, the API sets verified,
transaction-local `nova.user_id` and `nova.organisation_id` context. In the
foundation, `nova.user_id` is the authenticated person's NOVA identifier after
the authentication adapter resolves its provider identity. RLS policies in the
migration consume that context only to confine row access to the organisation.
They do not grant an action: the API still evaluates permission, scope,
operational capability, target state and policy at write time. The migration
role is separate from the non-owner application role so normal requests cannot
accidentally bypass RLS.

Database functions are reserved for integrity guards and operations that need
database-level atomicity. The People & Identity and Availability configuration
commands use one API transaction; attendance, timer, review, timeline and
lifecycle commands use the same boundary where their state transitions require
database-level locking or canonical closure.

Availability transitions use a small shared SQL helper to take transaction
advisory locks keyed by person and business date. The key matches the
leave-overlap trigger, so leave/WFH approval and attendance mode changes share
one concurrency boundary without introducing another table or service.

Administrative task cancellation and assignment reassignment use the canonical
`nova.close_assignment_work_sessions` function. Direct user pause/stop writes
remain separate because they are explicit session commands, not lifecycle
closures.

The initial production target is GitHub -> Cloudflare Worker with Supabase Cloud
PostgreSQL. `cloudflare/worker.ts` exposes the shared API handler and Cron
Trigger; Netlify (`netlify/functions/nova.mts`) and Vercel
(`api/[...path].ts`, with the deployment-selected Cron in `vercel.ts`) use the same
handler. None of these adapters contains
domain logic. The application core uses web-standard `Request`/`Response` objects and
the standard PostgreSQL `pg` driver, so it does not rely on Bun, Netlify, Vercel,
or Supabase runtime APIs.

For the primary serverless deployment, `DATABASE_URL` uses the Supabase Cloud
Transaction pooler for the non-owner `nova_app.<project-ref>` role. The API and
authentication pools are bounded and configurable; NOVA uses explicit
transactions and no named prepared statements, which keeps its request-local
RLS context compatible with transaction pooling. The current `pg`
URL must use `sslmode=require&uselibpqcompat=true`, or a separately configured
Supabase CA certificate with `verify-full`.

The first real workflow client is dependency-free static HTML/CSS/JavaScript in
web/, published by the selected adapter on the same origin as the API; this keeps
Better Auth session cookies simple. Cloudflare assets, netlify.toml and vercel.ts
route the same static pages and shared API handler for their compatible
deployment. It covers founder setup, sign-in/password recovery, invitation
acceptance, email delivery configuration, issuing an invitation, and the first
Super Admin console for organisation structure, roles, people onboarding,
freezing, audit review, and Availability configuration. It is not a second
authorization layer: every
administrative read and write still goes through the API command boundary.

### Local verification paths

No hosted edge is required to develop or verify the core system:

1. Local API + Supabase Cloud PostgreSQL: configure the local DATABASE_URL to
   the exact Supabase transaction pooler, set BETTER_AUTH_URL to
   http://localhost:3001, and run the root dev:local script. The browser,
   Better Auth, PostgreSQL transactions, and RLS then run from the laptop
   against the Cloud database without Netlify or Vercel.
2. Local API + direct PostgreSQL: set MIGRATOR_DATABASE_URL and DATABASE_URL
   to the local migration and non-owner application roles, run the canonical
   migrations, and run the same dev:local script. Docker Compose provides
   this direct-PostgreSQL path when Docker is available; any PostgreSQL 17
   server can be used instead.
   On Windows, Docker Desktop is the supported local path. If using Docker
   Engine only inside WSL, start the stack from an interactive WSL shell and
   keep that distro running while using the Windows browser. WSL localhost
   forwarding is available while the distro is running; do not widen the API
   bind to 0.0.0.0 to work around an idle/stopped WSL distro. See the local
   setup instructions in README for the lifecycle caveat.
3. Cloudflare, Netlify and Vercel are deployment adapters tested after the local
   workflow passes. They do not define the domain, database, authentication, or
   RLS contract. Cloudflare Cron, Netlify/Vercel scheduled functions, Supabase
   Cron/pg_net and the VPS maintenance loop call the same protected
   `/api/internal/background/tick` endpoint. Each call identifies its
   scheduler; the runtime's non-secret `NOVA_BACKGROUND_SCHEDULER` selection
   rejects a different built-in adapter. Operators must still leave exactly
   one production trigger active per database because NOVA cannot inspect a
   provider's scheduler inventory or detect duplicate schedules with the same
   identity.

Supabase Cloud is the easy deployment path, not a different backend.
`MIGRATOR_DATABASE_URL` belongs to the schema-owning migration account;
`DATABASE_URL` belongs to the non-owner, non-`BYPASSRLS` `nova_app` role. A
Supabase deployment must provision that application role and grant it the same
schema access before running the canonical migration; it must not use a
`postgres` owner/admin or `service_role` connection for normal NOVA API traffic.
The same migration/API/RLS contract is required for every deployment. The API
and Better Auth pools are bounded but no longer single-connection bottlenecks;
`NOVA_DB_POOL_MAX` (1–50, default 10) and `NOVA_AUTH_POOL_MAX` (1–25, default 5)
can be tuned to the provider's connection budget. The three Better Auth
policies share one process-local auth pool on Node hosts, so the default
per-instance ceiling is ten NOVA plus five auth connections, multiplied by
concurrent function instances. Request-scoped Hyperdrive connections continue
to use the existing per-request database adapter.

### Open-source deployment and first-run handoff

The deployment bootstrap token is an operator/deployment secret, not a
license. NOVA is open source: checkout, trials, subscriptions, license
activation and an always-online billing call are not required. The current
repository implements the safe first-run path: `bun run setup` generates
local-only secrets when `.env` is absent, starts Docker Compose, waits for
health, runs the canonical migration/preflight and prints the guided setup
handoff, including the initial attendance policy. External mode keeps
Supabase/VPS credentials operator-owned and runs the same migration/preflight
sequence.
Optional hosted support or managed provisioning must remain outside the NOVA
domain model and must not be required for a self-hosted deployment.

Direct PostgreSQL + NOVA services on a VPS is supported, and the same path is
available locally for development and database verification.
The included Docker Compose configuration starts PostgreSQL, applies the same
migrations once, then starts the same API handler through Node's HTTP API with
the static client enabled on the same origin. Both ports bind only to the VPS
loopback interface; a reverse proxy can publish that single origin. Its API
service uses the same `BETTER_AUTH_SECRET`,
`BETTER_AUTH_URL`, and `NOVA_BOOTSTRAP_TOKEN` configuration as the hosted
adapters. For a later database change, run
`docker compose --env-file .env -f docker/compose.yaml run --rm migrate` before
recreating the API. The PostgreSQL-native RLS check runs with
`docker compose --env-file .env -f docker/compose.yaml run --rm migrate bun run --cwd server db:test`.

## Module ownership and dependencies

| Module | Owns | Depends on now | Enables later |
| --- | --- | --- | --- |
| People & Identity | organisation, people, office, organisation department, custom role, permission grant, operational policy, audit | PostgreSQL | every module |
| Availability | calendars, shifts, attendance, leave, holidays, WFH | active person, office, role policy, audit | work eligibility and timeline |
| Work Context | clients, client workstreams, organisation workstreams, groups, tasks, assignments | people, permissions, audit | work time and reviews |
| Work Time | sessions, timeline projection, adjustments | availability, assignment, role policy, audit | payroll source facts |
| Reviews | submissions, reviewer assignment, review cycles | assignments, permissions, audit | task visibility and reporting |
| People Lifecycle | onboarding, freeze, offboarding, handover | people, work sessions, audit | lifecycle-safe operations |
| Payroll (later) | payruns and calculations | effective-dated source facts from all earlier modules | none |

## First-slice canonical entities

| Entity | Purpose | Parent/scope | Historical behaviour |
| --- | --- | --- | --- |
| Organisation | tenant boundary | root | retained |
| Office | timezone and future calendar anchor | organisation | archived, never silently reinterpreted |
| Organisation Department | person membership context | organisation | memberships are effective-dated |
| Person | organisation-owned human record | organisation | retained after exit |
| Person identity | infrastructure-auth subject mapping | person | provider boundary; no provider ID is a domain ID |
| Employment term | employment/designation history | person | effective-dated |
| Person office/department/role assignment | operational history | person | effective-dated, non-overlapping |
| Role | organisation-configured set of authority/policy | organisation | archived, protected Super Admin immutable |
| Permission definition | product-owned action catalogue | NOVA | added as modules introduce actions |
| Role permission grant | action plus explicit Phase 1 scope | role | audited through commands |
| Role operational policy | role-level operating eligibility | role | explicit booleans, not a policy language |
| Audit event | append-only explanation of sensitive change | organisation | immutable |

## Role model

Only `super_admin` is a protected system role. Every other role is created and
named by an actor with the explicit `roles.create` authority (initially the
protected Super Admin). A role combines explicit permission grants with an
explicit operational policy. Permissions authorize an actor to make a command;
operational policy describes whether a person in that role may operate in a given
way. They are intentionally not interchangeable.

The initial policy fields are the frozen PRD capabilities needed by future
availability, work, and payroll-source workflows: work enabled, assignment
eligibility, attendance required, WFH allowed, work without attendance, payroll
applicable, attendance contributes to payroll, and overtime applicable.

Phase 1 grants support organisation, own-record, office, and Organisation
Department scopes with real foreign keys. Client, Client Workstream, Group, and
assigned-work scopes are added with their owning modules as additive migrations;
they are not represented by an unsafe generic `scope_id` column. Delegated
role managers may grant only permissions they already hold at organisation
scope; the protected Super Admin is the explicit exception.

## First commands

| Command | Required authority | Atomic result |
| --- | --- | --- |
| bootstrap organisation | authenticated initial actor, only where no organisation exists | organisation, protected role, first person, assignments, audit |
| create custom role | `roles.create` at organisation scope | role, policy, grants, audit |
| update custom role | `roles.edit` at organisation scope | changed policy/grants, audit |
| invite person | Super Admin or future explicit People authority | invited person, invitation, audit |
| create office / Organisation Department | Super Admin or explicit organisation-settings authority | configuration record, audit |
| complete onboarding | Super Admin or future explicit People + Role authority | employment, office/department/role assignments, lifecycle transition, audit |
| later office/department/role transfer | Super Admin or future explicit People authority | closes prior assignment and opens the next effective-dated record, audit |
| freeze person | Super Admin or future explicit People authority | closes current active state through the lifecycle command, audit |

Authentication is deliberately kept at the API edge. The current implementation
is Better Auth embedded in NOVA, backed by PostgreSQL in the separate
`nova_auth` schema; it maps its stable user identifier to
`nova.person_identities`. NOVA keeps
roles, permissions, invitations, and domain authorization. That makes a GitHub
fork deployable with its own database and environment values, without requiring
a third-party identity-provider account, while still allowing a future adapter
to accept an external provider.

The initial organisation command is the only controlled bootstrap exception to
normal RLS access: a verified Better Auth session and a deployment-only setup
token invoke a one-time, migration-owned PostgreSQL function. It creates the
organisation, protected Super Admin, role grants, identity mapping, active
status, role assignment, and audit event atomically. It does not make Better
Auth roles or organisations part of NOVA's domain model.

`POST /api/roles` is the first normal authenticated command. It resolves the
verified Better Auth subject to the NOVA person through a narrowly scoped
database resolver, establishes transaction-local RLS context, requires the
explicit `roles.create` organisation grant, then atomically writes the custom
role, every selected permission grant, every operational-policy boolean and an
audit event. It never accepts the organisation or actor from the client.

`POST /api/people/invitations` is the first People Lifecycle command. It
requires `people.invite` at organisation scope, writes the invited person,
invitation hash, lifecycle state and audit event atomically, then sends through
the selected portable email connection. If no connection is active, and an
explicit public origin has already been selected, the same command stages an
encrypted, one-time system handoff for an authorised administrator to reveal
once; it does not create a temporary password. The raw invitation token is
never stored. `POST /api/invitations/accept` is the only employee account-creation
path; it creates the Better Auth password account, ties it to the invitation,
and triggers verification. Better Auth's verification callback moves the person
from Invited to Onboarding. Normal commands require a verified Active or Notice
actor. Public-origin configuration permits the newly bootstrapped, unverified
Super Admin only with the still-held setup token; email configuration remains
available to that active Super Admin after an explicit origin is selected so
the first sender can be configured before verification.

Better Auth protects its own authentication endpoints with trusted-origin and
CSRF checks. NOVA applies an equivalent same-origin check to its separate
cookie-authenticated state-changing command endpoints: a browser request with a
session cookie must carry a trusted Origin/Referer, cross-site Fetch Metadata is
rejected, and credential-free operator/API requests remain usable.
Privileged asynchronous callbacks such as Gmail OAuth also re-evaluate the
initiator's current lifecycle and Super Admin authority inside the final
transaction before changing encrypted provider credentials.

Organisation structure now has focused POST commands for offices and
Organisation Departments. Office input includes an IANA timezone and a location
anchor; the database retains the location as an additive nullable field so an
older deployment can migrate safely, while NOVA create command requires it.
The Onboarding completion command requires people.edit, people.activate and
roles.assign at organisation scope. In one transaction it validates that the
person is currently Onboarding, the office/department/non-protected role and
optional manager belong to the organisation, writes the required employment and
effective-dated assignments, then moves the person to Active and audits it.
It never makes a protected Super Admin role delegable.

The Availability configuration foundation is additive and PostgreSQL-native. A
fixed shift stores local start/end times, optional break, grace minutes, and
overtime eligibility. A working calendar stores weekly rules (with an ordinal
slot available for future Saturday patterns), and an effective-dated assignment
connects one calendar to an office. Office holidays are date-specific,
organisation-scoped, and append-only for now. The API validates that all
calendar, shift, office, and holiday references belong to the same organisation,
and the migration adds RLS policies for every new table. Attendance will resolve
these records using the office timezone at the authoritative server boundary;
the browser never decides the business date. The first attendance command
slice now stores one `attendance_days` state per person/business date. The API
resolves the current date from the assigned office timezone, rejects holidays
and configured non-working days, honors the role's WFH policy, and uses the
database unique key plus row locks for check-in/out and mode-change safety.
Attendance remains separate from leave and productive work. Leave requests now
store a lifecycle status plus explicit full- or half-day rows in
`leave_request_days`; overlap locking is PostgreSQL-native, and approving a
request refuses to silently rewrite an existing attendance row. The Today
surface can submit leave or WFH requests, while any role granted the
corresponding review permission can approve or reject them. WFH eligibility is
resolved at command time in deterministic order: person, current department,
current office, then role policy. An approved WFH request is a separate,
audited date-range gate for WFH attendance; it does not become a second
attendance ledger. Office attendance additionally requires server-side
verification of the effective office's configured latitude/longitude radius
and reported location accuracy. The office timezone and geofence are resolved
from the person's effective office assignment, so people in different offices
can collaborate in one organisation without sharing a timezone or geofence.
When a holiday or effective calendar change affects existing attendance, the
shared reconciliation command closes only open attendance, preserves the row,
and creates an actionable Historical Exception for an authorised administrator.
Approved leave and approved WFH are mutually exclusive per person/business
date; each approval command checks the other source before committing. A
bounded `POST /api/attendance/recover` command handles missed/device-failure
corrections with an immutable before/after record in
`nova.attendance_corrections`. Location evidence expires after the default
90-day dispute window and is removed only by the explicit PostgreSQL purge
function; no continuous location stream is stored.

The collaboration and recovery foundation is now additive through migrations
0045. Clients, client departments, effective-dated client memberships,
client/organisation workstreams, groups, tasks, assignments and the first
work-session timer slice are organisation-safe, RLS-protected records.
Targetable role scopes include client, client-workstream, group and
assigned-work; delegated role managers still cannot grant permissions they do
not hold at organisation scope. Work-session overlap, lifecycle closure and
office-local business boundaries are enforced at the PostgreSQL/API boundary.

Migration 0046 adds the effective-dated organisation attendance policy. The
policy records whether the timeline interprets attendance as hour-based or
scheduled, plus the required duration used by hour-based organisations. WFH
remains a policy/approval-controlled mode on the same attendance row; it is not
an organisation attendance mode. Freeze and offboarding close open attendance
through the same canonical lifecycle boundary as productive work sessions.

Migration 0047 adds the assignment-scoped canonical work-session closure used
by task cancellation and reassignment, so those lifecycle callers do not write
session state independently.

Migration 0048 adds the explicit blocked-review state and open-cycle reviewer
update boundary; completed review history remains immutable.
The task aggregate projection now records an organisation no-review submission
as assignment `approved` with `resolution_source = policy` and projects an
all-no-review task to the existing `done` state; review-required work still
requires an actual reviewer decision.
Migration 0049 makes the shared RLS actor context require an active/notice
person, closing the post-session-check lifecycle race for normal API statements.
Migration 0050 keeps a null open-cycle reviewer limited to the explicit blocked
review state even for direct application-role writes. Migration 0051 adds
reviewer-unavailable replacement, atomic self-assignment, two-sided handover
requests and explicit policy-vs-review resolution provenance.

Migration 0052 adds the email-independent authentication handoff queue: the
existing Better Auth invitation, verification and password-reset flows can
stage encrypted, short-lived links for an authorised administrator when the
configured delivery adapter is unavailable, without adding a second identity
system or exposing passwords.
Migration 0053 restricts the RLS actor helper to the configured application
role, and migrations 0054-0055 make protected Super Admin checks use the
actor's office-local business date and re-check active/notice lifecycle status
at the transaction boundary. During first-run setup only, the
unverified founder may use the still-held setup token to reveal their own
verification handoff when no email adapter exists.

Email configuration is deployment-level, not a Supabase service. A protected
Super Admin can create and test a Console, SMTP/Nodemailer, Gmail OAuth2, or
Resend connection through `/api/email-connections`, then activate one tested
connection. Provider credentials are encrypted with
`NOVA_SECRETS_ENCRYPTION_KEY` before entering PostgreSQL. Gmail OAuth2 uses a
customer-owned Google OAuth client, an expiring PKCE/state authorization
attempt, and a refresh token; it never becomes NOVA login or domain identity.

## Email delivery setup

Set `NOVA_SECRETS_ENCRYPTION_KEY` in the API deployment before creating an SMTP,
Gmail OAuth2, or Resend connection. It is a 32-byte base64url key and must stay
the same while NOVA needs to decrypt existing provider credentials. It is not a
Supabase management token and is never exposed to the browser.

The first owner setup is deliberately controlled and ordered so no link can be
minted for the wrong host:

1. `POST /api/setup/register` with the deployment bootstrap token creates the
   founding Better Auth account; public Better Auth sign-up is disabled.
2. The current session calls `POST /api/organisation/bootstrap` with that token.
3. The setup screen immediately selects an exact operator-approved public
   origin. The unverified, active Super Admin can do this only with the same
   bootstrap token; this is the narrow bridge that avoids a verification
   circular dependency.
4. Only after the origin is explicitly selected may the Super Admin create,
   test, and activate the first email connection at `/api/email-connections`.
5. Send the founder's verification email through Better Auth, then use normal
   verified administration thereafter. If email is unavailable, the secure
   system handoff remains available because the origin is already known.

For SMTP, the encrypted connection payload contains host, port, TLS choice,
username, and password. For Resend it contains only the API key. Gmail OAuth2
starts with a customer-owned Google Cloud web OAuth client ID and secret; the
Super Admin calls `POST /api/email-connections/{id}/gmail/connect`, opens the
returned Google authorization URL, and Google redirects to
`/api/email-connections/gmail/callback`. NOVA stores the resulting refresh token
encrypted, then returns a browser navigation to the same-origin Email Delivery
screen (or the JSON result to an API caller). The Super Admin tests and
activates the connection there. The exact redirect URI must be registered in
that customer-owned Google OAuth client. The authorization request asks for
offline access, uses state plus PKCE, and hints the configured sender account;
the sender must still pass a real delivery test because Google may reject an
unapproved account or sender alias.

The Gmail SMTP adapter requests `https://mail.google.com/`, the scope
Nodemailer documents for Gmail SMTP OAuth. This is deliberately not scattered
through NOVA domain logic; the customer-owned Google consent screen and any
Google verification requirements remain deployment configuration. Deployments
that need an HTTPS-only runtime use Resend instead.

The notification outbox passes its deterministic message identifier to the
provider adapter. Resend uses that identifier as its documented idempotency
key, so a retried HTTP request does not send the same notification twice.
SMTP and Gmail SMTP remain at-least-once transports because SMTP has no
portable idempotency contract; their leases, bounded retries and dead-letter
state make that limitation explicit rather than pretending delivery is
exactly-once.

Only one tested connection can be active. Create a replacement, test it, then
activate it to switch senders. A protected Super Admin may also deactivate the
active connection. Existing credentials remain encrypted and are never returned
by the list endpoint. Deactivation leaves sign-in, in-app notifications and
authenticated password changes available; invitation, verification and reset
links use the secure system-handoff queue.

The static setup screen submits the bootstrap token only as an explicit,
one-time HTTPS request header and clears its form. Likewise, a connection
credential exists only in the Super Admin's submitted form and is never
persisted, logged or re-rendered by the client. This is compatible with the
PRD rule that NOVA never exposes stored credentials to a client.

The static authentication flow uses the standard Better Auth routes for
sign-in, request-password-reset and reset-password. Reset links return to
/reset-password; the reset token is removed from the visible URL before the
form renders and the page sets a no-referrer policy. Better Auth is configured
to revoke previous sessions after a successful password reset. Authenticated
users can use Better Auth's change-password route without email. When email is
unavailable, `auth.manual_recovery` permits an authorised administrator to list
handoff metadata and reveal a single encrypted invitation, verification or
password-reset URL once; reveal and staging are audited and expired/revoked
handoffs cannot be replayed through the NOVA admin surface.

## Deferred deliberately

- Payroll payrun/calculation tables and execution remain deferred.
- No broader work-session reconciliation, review, reporting, or payroll workflow
  UI beyond the current bounded slices: People & Identity, Availability
  configuration, Today attendance, Client Work, leave/WFH review, and the
  unified Work timeline.
- No generic repository, service, policy-language, or workflow-engine layer.
- No arbitrary provider URL/code configuration or automatic mail-provider failover.
- No compensation formula or compensation-term schema: the PRD gates that
  decision before the Payroll input contract is frozen.
