# NOVA notification module plan

Notifications are intentionally a separate module. The first vertical slice
now persists the inbox, preference defaults and optional email outbox staging;
the maintenance/notification worker sends mail only after a lease is claimed,
so approval commands never call a provider directly. Authentication and
account email remain the existing email-adapter boundary.

## Goal

Deliver reliable, configurable notifications for leave/WFH decisions,
assignment/reviewer events, invitations and security events without making the
NOVA domain depend on SMTP, Gmail, Resend, Supabase, Netlify or Vercel.

The in-app notification inbox is the default experience. Every supported NOVA
notification appears in the authenticated UI notification page/panel (with an
unread badge and a deep link to the relevant record). Email is a separate,
optional channel and is **off by default** for notification events. If an
organisation or person enables email for an event, the same provider-neutral
intent is handed to the configured email adapter; domain commands never call
Nodemailer, Gmail or Resend directly.

Invitation, verification and password-reset messages remain transactional
account email and are outside this preference default. They are required for
the authentication flow and use the existing email adapter when one is active.
When email is unavailable, NOVA stages an encrypted, short-lived system
handoff for an authorised administrator to reveal once; it never creates a
temporary password or bypasses Better Auth. Authenticated users can change
their own password without email. This fallback remains part of the NOVA auth
boundary, not a separate identity system.

The domain emits a small, stable notification intent inside the same database
transaction as the state change:

```text
domain command
  -> notification intent (provider-neutral event key + recipient subject)
  -> outbox row (idempotency key)
  -> worker claims/retries delivery
  -> selected channel adapter
```

## Database slice (implemented first slice)

Add only the tables needed for the first vertical slice:

- `nova.notifications`: the durable in-app inbox row (organisation,
  recipient person, event key, safe title/body, aggregate type/id, deep-link
  target, read timestamp, created/expiry timestamps and idempotency key);
- `nova.notification_outbox`: optional external-channel work only
  (organisation, event key, aggregate type/id, recipient person, channel,
  template key, locale, safe payload, idempotency key, status (`pending`,
  `processing`, `sent`, `failed`, `dead_letter`), attempt count,
  `available_at`, provider message id and timestamps);
- `nova.notification_preferences`: person, event key/channel, enabled and
  updated-at. In-app defaults to enabled; notification email defaults to
  disabled. Transactional account email is not represented by this table;
  quiet-hours are a future additive preference and are not silently assumed;
- provider response/audit metadata currently lives on the leased outbox row;
  no separate delivery table is introduced until a real retention/query need
  justifies it.

The idempotency key is deterministic, for example
`leave.reviewed:{leave_request_id}:{decision}`. A unique constraint makes
retries and duplicate command delivery safe. The in-app `notifications` row is
written in the same transaction as the domain transition. An email outbox row
is added in that transaction only when the effective email preference is
enabled; external delivery happens after commit.

The inbox row retains the rendered event key, title, short safe body,
actor/aggregate references, deep link and read state—not secrets or
unrestricted domain payloads. A notification is not an authorization grant:
opening its deep link performs the normal NOVA permission check again.

## Adapter boundary

```ts
interface NotificationChannelAdapter {
  send(message: ProviderNeutralNotification): Promise<DeliveryResult>;
}
```

Initial channel adapters can reuse the existing encrypted email connection
records where email is explicitly enabled:

- Console (development only);
- SMTP/Nodemailer (customer-owned VPS or hosted SMTP);
- Gmail OAuth2 (customer-owned Google Cloud OAuth client);
- Resend (optional hosted-friendly adapter);
- in-app inbox (the default, database-backed channel);
- later, webhook/push adapters using the same outbox contract.

Adapters are deployment configuration, not domain identity. A fresh direct
PostgreSQL install can use Console first, then SMTP/Nodemailer; Supabase Cloud
can use the same choices. No adapter may read Supabase JWT claims or call
Supabase-only APIs from domain code.

## Worker and failure policy

Use one small worker process or scheduled endpoint per deployment—no event bus.
The canonical entry point is `POST /api/internal/background/tick`, which first
closes attendance and work-session business boundaries, then claims rows with
`FOR UPDATE SKIP LOCKED`, uses a lease timeout, and applies bounded exponential
backoff. Transient provider failures retry; permanent validation/authentication
failures become `dead_letter` with an operator-safe reason. A replay command may
requeue a dead-letter row after configuration is corrected. Every send is
auditable without logging access tokens.

External delivery is at-least-once, not exactly-once. Stable message IDs and
provider idempotency (when available) mitigate duplicates, but SMTP and Gmail
API may deliver twice if the provider accepts a message and its response is
lost before NOVA records success. Inbox/domain changes remain transactional and
idempotent; duplicate account emails contain the same one-time link and cannot
grant additional access.

The worker works on a VPS/Docker loop, Cloudflare Cron, Supabase Cron/pg_net,
or any operator scheduler that can call the protected endpoint. The web request
never waits for provider delivery.

## UI and API integration

The authenticated shell should expose a notification bell/unread count and a
dedicated `/notifications` page. A compact modal/popover may show the latest
items, but the page is the durable source for search, read/unread state and
deep links. Do not make the inbox depend on WebSockets: start with a normal
request and short polling; realtime can be an optional deployment adapter.

The first UI/API contract is:

- `GET /api/notifications` — paginated inbox, newest first, optional unread or
  event-key filter;
- `GET /api/notifications/unread-count` — badge count;
- `POST /api/notifications/:id/read` — idempotently mark one item read;
- `POST /api/notifications/read-all` — mark visible items read;
- `GET /api/notification-preferences` and
  `PATCH /api/notification-preferences` — in-app defaults on, email defaults
  off, with server-owned event catalogue validation.
- `GET /api/notifications/delivery` — organisation-scoped delivery status for
  actors with `notifications.delivery.view`;
- `POST /api/notifications/delivery/:id/requeue` — explicit failed/dead-letter
  replay for actors with `notifications.manage`.

These endpoints read only the recipient's rows through RLS and do not expose
the outbox or provider credentials to the browser.

## Integration map

The notification module must be integrated at transaction boundaries, not by
scraping audit logs later. The current command map is:

| Source command/event | Default in-app recipient(s) | Optional email trigger |
| --- | --- | --- |
| Person invitation/resend | inviter/admin delivery status; invited person after account activation | transactional invitation email only, not a duplicate notification |
| Person onboarding/freeze/offboarding | affected person; permitted administrators where policy requires | opt-in lifecycle notice |
| Leave requested | configured leave reviewers | opt-in reviewer email |
| Leave approved/rejected/cancelled | requester | opt-in decision email |
| Leave/attendance conflict | reviewer and authorised recovery actor | opt-in escalation email |
| WFH requested | permitted WFH reviewers | opt-in reviewer email |
| WFH approved/rejected/cancelled | requester | opt-in decision email |
| Attendance issue/recovery/geofence failure | affected person; permitted attendance reviewer | opt-in issue email |
| Office/calendar/holiday/WFH policy change affecting a person | impacted people; authorised administrator when an exception is created | opt-in policy-change email |
| Organisation attendance policy change | active people affected from the effective date | opt-in policy-change email |
| Task assignment/reassignment | assignee | opt-in assignment email |
| Reviewer selected/review requested | reviewer and assignee as applicable | opt-in review email |
| Reviewer replacement request/decision/unavailable state | requested reviewer and assignee | opt-in review email |
| Assignment handover request/decision | requested target and prior assignee | opt-in assignment email |
| Task returned/approved/due | assignee, reviewer, permitted owner | opt-in work email |
| Role/permission change | affected person and authorised administrator | opt-in security/admin email |
| Security/session event | affected person | only if a separate security-email policy enables it |

The first slice wires leave/WFH requests, decisions and cancellations,
assignment/reviewer/request/handover events, inbox read-state, due/overdue task reminders,
onboarding and freeze/offboarding lifecycle fan-out end to end. Attendance
location rejection and leave-attendance conflict/recovery now also enqueue
recipient-safe in-app events transactionally. Scheduled policy-change fan-out
uses explicit recipient resolution and is never generated from page loads.

The current command integration also emits leave/WFH request notifications,
attendance-recovery notices, ownership-transfer notices, and task
submission/review outcomes. It additionally covers leave/WFH cancellation,
leave-attendance conflict/recovery, rejected attendance location, effective
WFH policy changes, office calendar and holiday changes, role-permission
changes, and both sides of task reassignment. Delivery inspection and replay
are now available through permission-protected endpoints; scheduled policy-change
fan-out remains governed by the same explicit event catalogue and recipient
rules.

Use stable event keys rather than audit-action strings as the public contract,
for example `leave.requested`, `leave.approved`, `leave.rejected`,
`wfh.requested`, `wfh.approved`, `task.assigned`, `task.review_requested` and
`attendance.recovery_required`. Each key owns its recipient resolver, safe
template and deep-link target. Audit actions may remain more detailed and are
not themselves a notification API.

Read-only screens, audit-log reads, email-connection tests, health checks and
provider configuration changes do not create user notifications by default;
they remain audit/operations concerns unless a later event decision explicitly
adds them.

### Repository integration touchpoints found in the scan

- `server/src/commands/leave.ts` — request, review, cancellation and
  attendance-conflict decisions;
- `server/src/commands/wfh-requests.ts` — request, approval/rejection and
  cancellation decisions;
- `server/src/commands/attendance.ts` and
  `server/src/commands/attendance-recovery.ts` — attendance location issue,
  mode and recovery events;
- `server/src/commands/work-context.ts` — task assignment and reviewer
  selection events;
- `server/src/commands/invite-person.ts`, `freeze-person.ts`,
  `offboard-person.ts`, `organisation-setup.ts` and `create-role.ts` —
  lifecycle, freeze, onboarding, role and permission changes;
- `server/src/commands/availability-setup.ts`, `wfh-policy.ts` and
  `historical-exceptions.ts` — policy/calendar changes and exceptions;
- `server/src/email-delivery.ts` and `email-connections.ts` — reusable email
  adapter boundary only; notification code must call an adapter, not a
  provider directly;
- `server/src/app.ts` and `web/app.js` — notification endpoints, shell page and
  preference UI; unread badge/modal remains an additive polish step;
- `database/migrations` and `database/tests` — notification inbox/outbox RLS,
  idempotency and PostgreSQL-only tests.

## Recipient and permission rules

Recipient resolution occurs in the NOVA domain layer from the affected
organisation/person/role context. It must not trust a client-supplied email
address. RLS protects outbox rows by organisation; only the worker/maintenance
database role may claim cross-recipient rows. A visible notification still does
not grant permission to open the underlying leave, WFH or work record.

Domain fan-out uses the narrow request-context-checked
`nova.enqueue_notification` PostgreSQL function. This preserves recipient-only
inbox reads and `ON CONFLICT` idempotency without granting the normal API role
owner-style table bypass.

An active person may read and manage their own inbox/read state and personal
channel preferences as a system-owned self-record surface; this must not depend
on an administrator remembering to grant a role permission. Organisation-wide
defaults, event suppression, replay and delivery inspection use separate
configurable permissions such as `notifications.manage` and
`notifications.delivery.view`. These permissions govern notification
administration, never the underlying domain action.

## Defaults and safety rules

- In-app notification creation is enabled by the event catalogue and cannot be
  disabled for a required domain event; users can mark items read, but cannot
  hide a security/audit-critical item from the inbox.
- Notification email is opt-in at the organisation/person preference layer and
  is off when no explicit preference exists.
- A disabled, untested or missing email provider never blocks the domain;
  optional email delivery also pauses safely when the organisation has no
  explicitly selected public origin, so a notification can never contain a
  link for the wrong deployment host.
  transaction or in-app inbox insertion.
- Future quiet-hour policy, when implemented, may affect optional email only;
  in-app items remain immediately available.
- Email templates contain a short summary and a signed/deep link, never raw
  passwords, invitation secrets, OAuth tokens, location coordinates or full
  sensitive payloads.

## Rollout order

1. Freeze the event catalogue, recipient rules and in-app default semantics.
2. Add migration, RLS, inbox/outbox idempotency constraints and a Console/no-op
   worker; expose the inbox endpoints and UI page/badge.
3. Enqueue one leave/WFH approval event end-to-end and test duplicate,
   recipient isolation and read/unread behaviour against PostgreSQL without
   Supabase.
4. Add optional email preferences and connect SMTP/Nodemailer, Gmail OAuth2
   and Resend through the existing encrypted adapter boundary.
5. Add broader lifecycle/policy fan-out and quiet-hours handling.

The inbox/preferences slice is implemented in migrations `0021_notifications_inbox.sql`,
`0022_notification_preference_function.sql` and
`0023_notification_preference_function_acl.sql`. The provider-neutral leased
worker boundary is implemented in `0025_notification_worker_functions.sql`
and `0026_notification_staging_function.sql`; `server/src/notification-worker.ts`
claims, sends through the existing adapter and records bounded retries or
dead-letter status. PostgreSQL tests in
`database/tests/0021_notifications_inbox.sql` and
`database/tests/0022_notification_preference_function.sql` plus the worker
lease test in `database/tests/0025_notification_worker_functions.sql` cover
the database boundary. Recipient/read-state APIs remain in
`server/src/commands/notifications.ts`. Optional email work is still off by
default; when enabled, the worker delivers it without making domain commands
wait for a provider. Migration `0036_notification_delivery_operations.sql`
adds the narrow database read/replay boundary used by the delivery endpoints;
it never exposes provider credentials or raw notification payloads.

Migration `0040_due_task_notifications.sql` adds the small scheduled due/overdue
reminder function used by `server/src/maintenance-worker.ts`. It is
idempotent, skips inactive/cancelled work, writes the in-app inbox first, and
stages email only when the existing per-person preference is explicitly on.

`server/src/maintenance-worker.ts` is the portable scheduled entry point for
the notification worker, office-local attendance/work closure, and expired
attendance-location evidence purging. Deployments all use the same tick:
Docker/VPS runs it directly, Cloudflare Cron invokes the protected endpoint,
and Supabase Cloud can use the Vault-backed `scripts/supabase-background-
scheduler.sql` adapter. No domain rule is duplicated per provider.
