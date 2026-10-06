# NOVA UI, responsive design, and customization plan

> **Historical plan:** This document describes the pre-reset implementation and contains status claims that are no longer current. The user-design source is [`planbyaman.md`](planbyaman.md); the active NOVA-specific plan is [`nova-ui-replan.md`](nova-ui-replan.md). Use this file only for historical details until they are revalidated.

Planning baseline: 1 October 2026 · repository commit `9e83d1f`.

This is the implementation plan and current rollout record. It combines a source audit with product/workflow, frontend architecture, responsive/accessibility, and migration-to-UI reviews. Foundation and permission-aware slices are implemented, but the redesign is not complete; this document distinguishes observed behavior, shipped slices, and remaining work. No production database mutation was performed.

Implementation status: the first foundation slice persists per-person appearance/workspace settings, applies light/dark green themes and accessible accent tokens, and adds responsive customization controls. Workspace destination checks, grant-planned Admin/Work/Operations reads, permission-scoped Admin sections, target-aware Work/request action hints, side-effect-free review reads, purpose-limited geofence selection, self-review gating, leave cancellation visibility, and an accessible inbox unread badge are implemented. The first exact task-detail read and responsive full-page detail surface now link from Work assignment and Operations task rows; it filters by `tasks.view`, keeps reviewer access separate, limits assigned-work-only viewers to their own assignment summary, and exposes due-date correction only with its independent edit hint. Task review now has a required inline feedback form, actor-scoped in-memory draft recovery, and a server-side expected-cycle check that rejects stale decisions. Task assignment/cancellation and review decision notifications use Work; review requests open the actor-bound current-review queue, and legacy task links that point to My Day resolve through the same Work destination guard. Reviewer/handover request notifications still need their own destination resolver. The complete record/action capability catalogue, route-by-route visual redesign, module ownership migration, Fastly-hosted NOVA font, and authenticated visual browser/accessibility review remain rollout work described below.

The screen/component and ownership sequence is now made explicit in the companion [UI revamp execution blueprint](ui-revamp-execution-blueprint.md). It translates this plan into page compositions, component owners, responsive behavior, staged module integration, and visual acceptance gates.

Follow-on safety work now gives Admin, Work, Operations, My Day, and Inbox reads an abortable route/identity lifetime; a superseded read cannot render into the next page or identity. The shared form submit path preserves drafts after recoverable failures and clears the protected view on 401/403, refreshing grants after a 403. This is a partial P0 step: command completions are not cancelled, custom command handlers need the same 401/403 treatment, and remaining route loaders still need completion.

The Work detail read bypasses the capped task list and uses the effective, target-scoped `tasks.view` predicate in its database query. Missing and out-of-scope task IDs share the same `no-store` 404. Assignment emails and broad assignment rosters are not returned to assigned-work-only viewers. The current permission predicate still recognizes historical assignment rows; product semantics for former assignees after handover/cancellation need a separate decision. Reviewers without `tasks.view` remain on a narrow reviewer-bound path; no review detail read exists yet, and the database has no submitted artifact/attachment model. The task detail uses a full page at every width, preserving the plan's single-pane tablet/phone behavior. Browser/device review for authenticated Work roles remains pending.

The user-selected defaults are **white and green in light mode, black and green in dark mode**, with full, persisted customization. NovaDesign supplies the design and interaction discipline; Ponytail supplies implementation restraint. NOVA retains its identity, terminology, portable architecture, and domain rules. Visual quality, accessibility, workflow completion, and maintainability are requirements.

## 1. Decisions and scope

1. Build a coherent product workspace around My Day, Work, Reviews, People, Availability, Operations, and Settings. Every destination is capability-aware.
2. Make My Day the signed-in home. Put attendance, current work, and the single daily timeline together while keeping their underlying records distinct.
3. Use deliberate page recipes, consistent controls, legible density, clear hierarchy, and complete recovery states. Avoid framing every row and section as a card.
4. Deliver complete light and dark themes together. Green is the default accent; customizable palettes use validated foreground/background pairs.
5. Treat phone, tablet, desktop, zoom, keyboard, and touch as first-class input/layout conditions. Reorganize work when space changes; preserve capability and context.
6. Make customization a real product capability: appearance, density, reading/layout preferences, navigation, home modules, collection views, and permitted organization defaults. Save, sync, conflict handling, migration, and reset are part of completion.
7. Retain native browser ES modules and CSS initially. Introduce small feature boundaries and shared behavior. A framework migration needs evidence from the pilot, not an assumption that professional UI requires React.
8. Keep business truth in existing NOVA API/PostgreSQL contracts. Add narrowly scoped read/persistence contracts only where this plan identifies missing capabilities.
9. Migrate complete workflows in increments. Each increment has visual, behavioral, permission, responsive, and deployment acceptance gates.

Payroll execution, payslips, compensation calculations, AI assistants, arbitrary workflow builders, external integrations, and an offline write queue are outside this redesign. The PRD explicitly defers Payroll; retain current source facts and policy controls without inventing payrun screens. Full customization does not grant the ability to change permissions, domain invariants, or audit history through visual settings.

## 2. Source baseline and what needs attention

These observations start from the planning baseline commit above. In-session implementation updates are noted where they change the baseline; they are not new browser reproductions.

| Observed baseline | Evidence | Design/engineering implication |
| --- | --- | --- |
| Static dependency-free browser client; Bun/TypeScript API, PostgreSQL, Better Auth | `package.json`, `server/package.json`, `web/index.html` | Reuse the current stack. Keep all deployment targets working. |
| At the 1 October planning baseline, `app.js` had 4,633 lines and `styles.css` 212. Follow-on features raised them to 7,797 and 690 lines; the responsive foundation now splits CSS across 10 imported ownership files, while routes/forms/domain flows remain together in `app.js` | `web/app.js`, `web/styles.css`, `web/styles/` | Continue page ownership migration by complete vertical slice; use the blueprint's module map. CSS splitting alone is insufficient. |
| Light/dark semantic green palettes, per-person appearance/navigation/home-module preferences, and personal task views now exist; notification preferences remain separate | `web/styles.css`, `web/ui-preferences.js`, `server/src/commands/ui-preferences.ts`, migrations `0075` and `0077` | Apply the appearance/layout contract consistently to migrated pages; shared organization defaults and view publishing remain future work. |
| Shell and page content are repeatedly replaced; destination heading focus is now managed on route changes and browser Back/Forward | `web/app.js:351`, `385–392`, `5078` | Keep the shell mounted; preserve form, token, query, and focus lifecycles through recoverable errors and identity changes. |
| A workspace destination registry now supplies permission-aware discovery and home fallback order | `web/workspace-destinations.js`, `web/app.js:5038–5041` | Build the My Day composition and migrate feature links/deep links without duplicating capability predicates. |
| Today owns attendance plus leave/WFH; Work owns the daily timeline below several unrelated sections | `web/app.js:3506`, `3623`, `3921` | Put the primary employee daily loop together and move configuration out of daily work. |
| Admin loads 16 resources, then presents many management forms together | `web/app.js:1777`, `1805` | Split into navigable feature sections; load data only for the current workflow and required references. |
| Generic submit failure calls `render()` | `web/app.js:4313` | Preserve mounted fields/drafts and show local errors. Do not discard input on recoverable failure. |
| Invitation/reset tokens are removed from the URL and held in page closures, which a failed-submit rerender replaces | `web/app.js:4267`, `4290`, `4313` | Retain the active form and ephemeral token until success, invalidation, or explicit exit. Keep tokens out of durable storage. |
| Default failure copy implies nothing saved unless confirmed locally | `web/app.js:335` | Distinguish definitive failure from unknown write outcome; reconcile before allowing unsafe retry. |
| Sign-out clears session/grants but leaves other global feature state; no shared identity epoch/request cancellation boundary | `web/app.js:23`, `314`, `4565` | Clear protected data, drafts, timers, pending writes, and selection; ignore late responses belonging to old sessions/routes. |
| Notifications carry task, assignment, leave, WFH, and attendance IDs. Assignment/cancellation and review-decision links now resolve to Work, review-request links open the actor-scoped queue, and legacy task links resolve to Work; reviewer/handover request and other record IDs still need destination-specific resolution | `web/app.js`, `web/workspace-destinations.js`, review and task notification producers | Add authorized resolvers per record type; preserve legacy link formats and never treat an ID as authorization. |
| Signed-in navigation uses a touch drawer through 1023px, a narrower persistent rail on compact desktop, and a full rail on wide desktop. Feature collections reflow by container width; deployment and form patterns have phone/tablet rules | `web/styles/responsive.css`, `web/styles/work.css`, `web/app.js` | The CSS is now split by ownership, and common record/Operations sections use quiet dividers. Rendered mobile/tablet checks of the changed shell remain pending; source rules alone do not establish visual completion. |
| Global large `h1`, heavy labels, dense prose, repeated framed blocks | `web/styles.css:41`, `48`, `55`, `72`; page render functions | Introduce type roles, intentional action tiers, quieter grouping, and progressive disclosure. |
| Useful safeguards already exist: native controls, labels, skip link, current-nav state, reduced-motion rule, permission helpers, failure-aware reads | `web/index.html:14`, `web/styles.css:210`, `web/admin-read-state.js`, `web/role-grants.js` | Preserve and extend these. A reskin must not weaken denied-versus-empty behavior. |
| Tasks/review queues have candidate limits before permission filtering; other reads have fixed caps | `server/src/commands/work-context.ts:1797`, `review-queue.ts:57` | Add correctly scoped pagination/filtering before claiming complete search, totals, or exports. |
| Vercel explicitly maps a short static file list; the client also imports `deployment-guide.js` | `web/vercel-config.ts:11`, `web/app.js:18` | Verify the complete asset graph, including existing omitted mappings, before adding feature modules. An HTML fallback must not answer a JS import. |
| Existing UI smoke uses a DOM stub, and browser JavaScript is not broadly typechecked | `scripts/deployment-ui-smoke.ts`, `server/tsconfig.json`, `.github/workflows/verify.yml` | Keep useful contract tests; add actual browser coverage for visual layout, focus, navigation, and recovery. |

## 3. Product map and information architecture

### 3.1 Current routes and destination plan

Keep existing public URLs and `?view=` links working. Add a small validated route registry rather than coupling navigation to a framework switch. Names below describe proposed product destinations; they do not imply new server domains.

| Current entry | Current work | Proposed destination and treatment |
| --- | --- | --- |
| `/` signed out | Landing, setup/sign-in entry | Concise NOVA welcome. Sign in is easy to find; deployment/setup remain separate operator entry points. |
| `?view=deploy` | Provider path, checklist, scheduler choice, readiness probe | Deployment guide with named steps, concise next action, and expandable provider details. Keep checklist attestations distinct from observed readiness. |
| `?view=setup` | Founder, organization, public origin, attendance policy | First-run setup with logical steps, progress, preserved draft, and partial-completion recovery. |
| `?view=login`, `?view=forgot` | Sign in and recovery request | Focused account forms; password-manager support and truthful email/manual-handoff outcomes. |
| `/accept-invite`, `/reset-password` | Token-based account entry | Focused invitation/reset flows, including invalid/expired/consumed states and retry without token loss. |
| `?view=today` | Attendance, requests, status | My Day: attendance + active assignment + single daily timeline + next actions. |
| `?view=work` | Task creation, review, requests, assignment timer, sessions, timeline | Work: task/assignment collections and record details. Keep the definition selector in task creation; move daily timeline to My Day and reusable-definition/billing administration to Work setup. |
| `?view=work-setup` | Existing catalog/proposal and workstream billing-policy APIs | Work setup: independently permission-gated reusable task definitions and automatic workstream billing rules; no invoice, rate, or payroll controls. |
| `?view=operations` | People/work/calendar projections and CSV | Operations: capability-filtered reporting, explicit query/date/scope, reliable exports, links to canonical records. |
| `?view=notifications` | Inbox, mark-read, optional email preferences | Inbox with target-record navigation. Move preference editing to Settings, retaining a direct link. |
| `?view=admin` | Organization, offices, departments, roles, people, availability, work, audit | Compatibility administration index linking to focused People, Availability, Work configuration, and Organization settings. |
| `?view=invite` | Person invitation | People → Invite. Keep the old URL as an alias and preserve the delivery/handoff journey. |
| `?view=settings` | Account, public origin, email, secure handoffs | Settings: My account, Appearance, Workspace, Organization, Access, Email delivery, Public links, Secure handoffs, Delivery operations, Audit; show only allowed sections. |
| Signed-in `/` / Overview | Settings fallback | My Day by default; optional permitted personal landing destination. Operationally ineligible users receive a useful capability-appropriate home. |

### 3.2 Navigation model

Desktop navigation groups:

- **My workspace:** My Day, Work, Inbox.
- **Team operations:** Reviews, People, Availability, Operations; show only destinations with usable authorized work.
- **Configuration:** Work setup and Settings, with personal and organization sections clearly separated.

Work contains Tasks, Clients and Workstreams, and Task catalog; billing rules live beside the workstream or definition they govern. Availability contains My requests, Team requests, Calendar, and permitted configuration. Reviews contains task reviews and reviewer/handover exceptions. Keep leave/WFH decisions in Availability rather than mixing unlike decision contracts into one generic approval engine.

Client Workstream, Organisation Workstream, Organisation Department, Group/Campaign, Task, Work Assignment, and Work Session keep their PRD meanings. Do not rename every hierarchy to Project or Team. Every task outside its original context displays enough client/organization and workstream information to disambiguate it.

The navigation registry supplies label, URL, group, and discoverability predicate only. Features own data fetching and commands. Real anchors retain open-in-new-tab and link-copy behavior; enhanced same-origin navigation preserves the app shell.

### 3.3 Capability and actor matrix

These are usage scenarios, not hardcoded system roles. Custom role names never determine authorization. The API's effective grants and operational policy remain authoritative.

| Actor scenario | Main jobs | Required design distinction |
| --- | --- | --- |
| Employee with attendance required | Check in, run work, review timeline, request leave/WFH, submit assignment | Attendance and productive work are related but distinct; make the next valid action and blocker clear. |
| Worker allowed to operate without attendance | Start authorized assignment, see daily work, submit | Do not force a disabled check-in flow as the home prerequisite. |
| Reviewer or manager with scoped grants | Review submissions, request changes, handle handover or exceptions | Show exact assignment/review cycle and authorized scope; keep previous/next queue context. |
| HR with onboarding-only access | Invite or activate where permitted, assign office/department/roles, handle lifecycle | Avoid making broad People/Admin reads a prerequisite for a narrowly granted action. |
| Client/workstream-scoped collaborator | See relevant tasks and context, perform granted actions | Search, counts, pickers, and related records obey the same scope. |
| Organization administrator | Configure office/timezone/calendar/policy/roles and examine audit | Effective dates, scope, impact, and revision conflicts are visible at the decision point. |
| Super Admin | Protected ownership, public origin, provider setup, operational status | Preserve protected-role constraints; ownership transfer has an explicit review and final command. |
| Unverified, onboarding, frozen, offboarding, or exited person | Understand status and available recovery/next action | Distinguish authentication, email verification, authorization, and operational eligibility. Never show empty data as a substitute for a blocked state. |

These are scenario names for design review, not predefined role names or a product enum. The acceptance suite must derive actors by composing grants, target scopes, current assignments, lifecycle state, and operational policy. For example, test an actor with `people.view` for one office and `people.edit` for one department; verify both accessible slices remain useful without implying either is global. The current permission catalogue limits `people.invite` to organisation scope, so the UI must not imply narrower invitation grants exist.

### 3.4 Permission model and feature visibility

The professional planning terms are **capability-based information architecture**, **role/permission matrix**, **access-control presentation model**, and **API-to-feature traceability matrix**. They work together: first identify the actor's effective, scoped capabilities; then show the relevant destinations, sections, records, and actions; finally check that each is backed by an authorized API read or command. This is a data-backed product feature inventory as well as a UI design exercise.

NOVA's own rule from the PRD remains authoritative:

```text
protected system rule
+ platform/domain prohibition or locked record state
+ named action permission
+ grant scope intersected with target
+ operational eligibility and policy
+ feature prerequisites
= action the API can authorize now
```

The exact expression/order must follow the command implementing that business action. UI predictions guide discoverability; API/PostgreSQL validation decides the result.

NOVA's grant catalogue is additive and scoped; it is not an arbitrary deny-rule editor. The matrix's prohibition/state layer refers to existing protected-system, lifecycle, eligibility, and locked/final-state rules. Do not invent per-role deny expressions in the redesign.

Evaluate access in layers, without inferring access from a role label:

1. **Session/workspace:** Is the person authenticated, attached to this organization, and in an operable lifecycle/verification state? Does the protected-owner rule apply?
2. **Navigation:** Is there at least one meaningful read or action in this section, or an authorized child section? If not, omit it from navigation and module/search results.
3. **Page and feature section:** Which independent reads/records can the actor access for the current office, department, client, workstream, group, own-record, or assigned-work scope? Load those regions only.
4. **Component and record:** Show detail fields/actions only when the specific target is in scope. One visible control never implies authority for its sibling controls.
5. **Command/action:** Combine the exact permission, scope, operational policy, current record status, and prerequisites. Show a permitted action, its meaningful disabled-with-reason state when a prerequisite can be fixed, or no mutation control when it is outside the actor's authority.

Visibility must be calculated against **effective grants plus record scope**, never hard-coded labels such as “HR”, “Admin”, “Manager”, “Client Reviewer”, or “Employee”. A customer can rename those roles, combine multiple roles, or create a new one. Multiple active grants contribute only the rights actually granted. View does not imply create/edit/delete/review; access to a page does not imply access to every section or row.

| UI boundary | Show when | Example |
| --- | --- | --- |
| Top-level People destination | At least one relevant people read or permitted invite/lifecycle workflow exists in the actor's effective scope | `people.invite` alone can surface Invite; it must not surface every person's employment/role data. |
| Profile detail section | Its source is independently authorized and returned | A person basics section may be available while a role/lifecycle or office-specific panel has a denied/unavailable state. |
| Row action | That action and target match the actor's grant/scope, eligible state, and operating policy | `tasks.view` does not expose Reassign; `tasks.reassign` applies only to tasks in its target scope. |
| Attendance/work control | The action is applicable for this actor, date, assignment, office, policy, and current record state | Attendance-optional work can still lead with Work; geofence setup is visible only to its manager. |
| Administration group | A read or command applies to the target group | A scoped calendar manager sees their offices and calendar tasks without gaining organization-wide role settings. |

Feature access and prerequisites are distinct. A user who **has no grant** should not be promised an inaccessible workflow or loaded protected content. A granted task that is **blocked by a fixable business prerequisite** should remain visible with the reason and permitted recovery (for example, a missing calendar), if its read scope allows the explanation. A **permission read failure** is an unknown access state, not an empty list; fail closed for protected content and give a refresh path. A command-time 403 clears affected protected data and explains that access has changed. Do not show an inert link to a hidden protected feature merely to make the menu look complete.

Use a page visibility/section/action descriptor table derived from canonical permission keys and their scopes as the UI navigation index. Reuse `GET /api/me/permission-grants` and current helpers for effective grant data. Ensure read/navigation predicates are not hand-copied out of sync across shell, route parser, feature menu, and settings. The task catalog already returns its view/propose/manage/review capabilities together as response booleans; use that only for that feature. For larger features, add a compact, target-aware capability read only when the UI cannot otherwise determine which subregions it may query. A client-provided target or cached grant is never proof to the server.

Keep *who can discover/see this surface*, *who can read each field/record*, and *who can mutate this target right now* as separately reviewable checks. Do not request or cache a broad Admin payload merely to decide which Admin sections to display. Filter/aggregate at the authorized read boundary **before** applying a page limit. If a data slice fails, retain other independent authorized slices. On logout, expiry, organization/person switch, or loss of permission, remove any newly unauthorized result, local detail, selection, saved field/view, and pending update immediately.

### 3.5 Repository-backed domain and API inventory

This inventory is from repository migrations, route handlers, and read/command modules; it does not inspect any customer's populated database. The map records which existing domain data can power an intentional user-facing feature. It does **not** mean every table should become a screen or every field should be shown. Expose the minimum authorized information that helps complete the listed job; internal identity tokens, hashes, rate limits, OAuth state/secrets, encrypted provider credentials, raw outbox payloads, and security internals are never ordinary UI data.

| Existing domain data / read and command families | Permission/capability examples already in NOVA | Useful product surfaces | Plan status |
| --- | --- | --- | --- |
| Organization, office/timezone/geofence, Organization Department; read organization/offices/departments, permission and role catalog | `organisation.settings.manage`, `roles.view`, `organisation.public_origin.manage` | Workspace identity, office settings, scoped calendar/attendance administration, account context | Existing configuration in broad Admin; refactor into permission-filtered organization sections. |
| Person, identity mapping, status periods, employment terms; office/department/role assignments; invitation lifecycle and audit | `people.view/create/edit/invite/activate/freeze/offboard`, `roles.assign`, with allowed target scope | People directory, person profile, invite/onboarding queues, lifecycle workflow, organization history | Lists and forms exist; complete scoped detail/handoff/history UX and paging. Never display auth subject/token values. |
| Role, role operational policy, permission definition, scoped grants | `roles.view/create/edit/assign`, role-dependent grants | Role catalog, edited starter preview, grouped grant + scope editor, impact/revision review | Data and forms exist. Preserve permission/action vs eligibility/policy distinction and protected role. |
| Client, Client Workstream, Organisation Workstream, Group/Campaign, client department/membership | `clients.view/create/edit`, `clients.departments.manage`, `clients.members.manage`, `workstreams.view/create/edit`, `groups.view/create/edit` | Client/workstream explorer, membership and context selectors, scoped record breadcrumbs | Create/setup exists within Admin; move into Work configuration with membership/read coverage. |
| Task and correction provenance, due date, billing rules; task catalog entries/proposals; role-safe classification | `tasks.view/create/edit/assign/reassign`, `tasks.create.billable`, `tasks.catalog.view/propose/manage/review`, `workstreams.billing_policy.manage` | Work collection/detail/create; approved definition chooser and editable proposal/review queue; inheritable workstream billing configuration | Work commands and many panels exist. Separate daily execution from configuration; preserve server classification and fixed history. |
| Assignment, eligible assignee, reviewer, reviewer request, handover, exception, review cycle/submission | `tasks.start/submit/review`, `tasks.reviewer_manage`, `tasks.reviewer_request`, `tasks.handover_request/accept`, relevant task/work scope | My assignments, scoped review queue, review cycles, collaboration requests, handover/reviewer exception history | APIs exist. Complete dedicated queues, states, record details, and target-aware actions. |
| Attendance day, office-local date/timezone, check-in/out, mode/evidence, attendance correction | `attendance.view/check_in/check_out/change_mode/recover` within scope + attendance policy | My Day attendance card; own/team attendance detail; guarded check-in/out/mode and recovery | Core UI exists in Today/Admin. Join to My Day and distinguish evidence, denied location, unsupported state, and provisional entries. |
| Shift, working calendar/rules, effective-dated office calendar, holiday, organization attendance policy; effective-dated WFH eligibility/override | `availability.shift.view/manage`, `.calendar.view/manage`, `.holiday.view/manage`, `.wfh_policy.view/manage`, geofence and attendance settings | My calendar/agenda, clearly separate team calendar and authorized settings, per-office/effective-date policy | Configuration exists. Calendar read projection is incomplete for a unified leave/work/review calendar; state this gap clearly. |
| WFH request/provisional attendance; leave request and request-days; exception/recovery | `availability.wfh.request/review`, `leave.request/review`, `availability.exception.view/resolve`; attendance recovery | My requests, decision queues, conflict/recovery detail, exception list with audited resolution | Commands exist, some UIs are embedded in Today/Admin. Split by job and show provisional relationships honestly. |
| Work session segments, timeline adjustments and unified day projection | `work.timeline.view`, `work.timeline_adjust_own`, `work.timeline_adjust_others`, plus `tasks.start` and eligible assignment state | My Day chronology and active work; permission-filtered team timeline; justified correction actions | Work session/timeline APIs exist. Bring timeline into home, preserve session ledger, add missing context fields only if required. |
| Notifications inbox/unread, email opt-in; delivery outbox and delivery-failure state | Own notification preferences plus `notifications.manage`, `notifications.delivery.view`, `auth.manual_recovery` as relevant | Inbox with real target links, own email choices, separate authorized delivery operations/handoff area | Admin now has a bounded delivery operations surface: `notifications.delivery.view` gates inspection and `notifications.manage` independently gates requeue. The browser uses failed/dead-letter status only as a presentation hint; host and server recheck eligibility. Never expose credentials or delivery secrets. |
| Audit events, authorized people/work/availability reads, optional supported exports | Permission for each source and audit-event scope | Domain reports that drill into records; action history and honest CSV exports | Operations is currently a projection from read results, not a live capacity engine. Use loaded/scope labels or add server pagination/report read before promising totals. |
| Personal UI preferences and saved task views; organization appearance/view defaults | Owner-scoped appearance/workspace preference API and owner-scoped revisioned task-view API now exist; shared organization defaults do not | Personal themes, navigation/home modules and bounded task views; separately authorized workspace defaults | Keep own preferences/views independent from role settings. Shared defaults still need their own permission, schema, revision, and audit boundary. |
| Payroll execution/payrun | Some future `payroll.view/manage/lock` permission definitions and policy flags; PRD defers payrun | No payroll execution surface in this phase | Permission metadata/policy flags alone are not records or payroll API capability. Keep V1 payrun screens deferred. |

The inventory points to surfaces based on real records and command loops. It also distinguishes backend-existing/UX-missing from data/read-model/API-missing. “Possible using current database data” is not enough to display a new feature: the authorized read, stable record/detail route, correct domain owner, useful volume/search semantics, command, state lifecycle, and recovery all need to exist.

### 3.6 Capability matrix and feature test composition

Before an implementation slice, maintain a compact matrix from permission key and scope to nav/page/record/action and server route. Do not precompute one row per role name: those are customer data and change continuously. The route registry must use stable feature IDs and permission/capability predicates, then resolve the current actor grants and scoped resources on entry.

| Product feature | Read surface | Actions inside that feature | Critical additional gate | Navigation visibility rule |
| --- | --- | --- | --- | --- |
| My Day / self attendance | `/attendance/today`, `/work/timeline`, `/work-sessions/mine`, own assignments/leave/WFH | Each check-in/out/mode/recover, timer start/pause, timeline adjustment, and request independently gated | Self identity, effective operational policy, business date, attendance/assignment state, geofence/request status | Show if the actor has a useful self-work/attendance/request read or action; compose only relevant modules. |
| Work and task detail | `/tasks`, `/work-context`, `/work/assignments/mine`, target detail/candidate reads | Create/edit/due date/assign/reassign/start/submit distinct | Task/work scope; actual assignment eligibility; required context; idempotency/revision | Show only when self assignment or scoped task view/action creates a usable destination. Filter target records before pagination. |
| Reviews/collaboration | Pending reviews, reviewer requests, handovers, target candidate lists | Review, request/reassign reviewer, accept/decline/withdraw handover, exception grant distinct | Exact assignment/cycle, no self review, candidate eligibility, assigned-work/client/workstream/group scope | Show each queue when that reader/action exists; hide unrelated queue tabs/counts. Empty authorized queue differs from no permission. |
| People/lifecycle | Scoped people/person data and onboarding state | Invite/create/edit/activate/freeze/offboard each independent | Protected Super Admin, target state, lifecycle consequences, effective date and scope | Invite-only access may show invite entry only; broad directory appears only with usable people read. |
| Availability | Own/pending requests, attendance/calendar and policy reads | Request/review/cancel/recover/configure per permission | Own vs target scope, effective office/date, conflict resolution, applicable policy | My requests can exist without team review/config menus. Configuration sections require their own view/manage capabilities. |
| Work context/catalog | Scoped clients/workstreams/groups/tasks/catalog/policy reads | View, membership, create/edit, proposal/review, billing/default edit split | Parent scope, future-effective behavior, classification policy, immutable historical facts | Show useful read/execution entry separately from manage/proposal features. |
| People reports/Operations/Audit | Authorized source-specific projections and event reads | Export only records in the same authorized filtered scope; manage delivery separately | Pagination, partial reads, current authorization, data freshness | Destination shown for at least one useful authorized report; each report independently fails closed. |
| Inbox | Own notifications and unread count | Mark read/read all per own records; route link is an ordinary authorized target read | Target may be deleted/forbidden; opening notification does not execute command | Show if own notification access is part of the actor workspace; never leak another actor's events. |
| Organization/provider settings | Organization/role/office/email/public-origin/handoff/delivery read per existing boundary | Each setting/action independently checked; protected transfer explicit | Super Admin protected state, exact scope, provider runtime, verification/handoff outcomes | Settings retains own account/appearance sections; organization children require their own grants. |
| UI personalization | New preference/view endpoints | Personal edits vs authorized team publish/admin-default operations | Person/org identity, view ownership, base revision, schema, allowed fields | Own appearance is useful to every signed-in user; team defaults appear only to authorized managers. |

Access tests combine orthogonal factors rather than testing a canned “HR user”: active roles/grants union; scope type (own, office, department, client, workstream, group, assigned work, organization); actor lifecycle; verification; operational policy; target state; and command. Cover `view` without `edit`, `invite` without directory access, one-office reads with organization reads denied, broad permission with locked/final state, multiple overlapping grants, revoked grant mid-session, denied read vs empty, API 403 after stale visibility hint, and protected-owner attempts. Assert both what is visible and what data is never fetched/rendered.

## 4. Visual direction and foundations

### 4.1 Art direction

NOVA should feel precise, quiet, and substantial: a black/white neutral working surface, controlled green accent, crisp typography, useful density, and carefully aligned controls. Most of the screen belongs to the work. Use green for primary action, active navigation, focus, and selected meaning; use text/icons as well as color for status. Separate success semantics from branding even when both are green.

Use solid readable surfaces for records, forms, tables, and dialogs. Keep elevation for actual overlays. Avoid oversized marketing headlines inside operational pages, decorative KPI strips, repeated card shells, pervasive blur, gradient decoration, and long explanations of implementation mechanics. Technical detail belongs in operator/configuration surfaces or a relevant disclosure.

### 4.2 Proposed default palette

These are starting design values, not a complete certified palette. CSS tokens will become the single implementation source of truth. Validate hover, pressed, disabled, selected, warning/danger/info, focus, and custom-palette combinations before release.

| Semantic role | White + green | Black + green |
| --- | --- | --- |
| Canvas | `#f6f8f7` | `#0c100e` |
| Main surface | `#ffffff` | `#151c18` |
| Primary text | `#17211d` | `#edf5ef` |
| Secondary text | `#56665e` | `#afbeb4` |
| Primary accent | `#126a52` | `#68d6a4` |
| On-accent | `#ffffff` | `#062718` |
| Focus | `#16815d` | `#68d6a4` |
| Quiet divider | `#dbe3de` | `#35443a` |
| Subtle grouping/skeleton | `#f0f4f1` | `#202a24` |
| Selected surface | `#e5f4ec` | `#193d2c` |
| Selected foreground | `#104d38` | `#c8f8dc` |
| Required field boundary | `#84968b` | `#728379` |

Calculated sRGB contrast for the proposed pairs: light body 16.51:1, light secondary 6.07:1, light primary button 6.54:1, dark body 15.61:1, dark secondary 8.96:1, dark primary button 8.96:1. Light and dark field boundaries against their main surfaces are 3.13:1 and 4.32:1. These calculations cover only these exact pairs; they do not verify rendered controls or the whole theme. Set exact semantic warning, danger, and information pairs at the foundation gate, validate text and non-text states against their real surfaces, and keep them independent of the configurable accent.

Normal text targets at least 4.5:1, qualifying large text 3:1; necessary control/state indicators target 3:1 against adjacent colors. Quiet decorative separators are a separate role from required field boundaries. Sources: [W3C text contrast](https://www.w3.org/WAI/WCAG22/Understanding/contrast-minimum.html), [W3C non-text contrast](https://www.w3.org/WAI/WCAG22/Understanding/non-text-contrast.html).

### 4.3 Typography, geometry, and tokens

| Foundation | Proposed recipe |
| --- | --- |
| Typeface | Interim default: Inter variable with a system UI fallback; users can choose the device typeface. The requested NOVA brand font is still to be selected and license-checked, then served as static WOFF2 assets through NOVA's Fastly delivery path once its asset origin is confirmed. Use `font-display: swap`, preserve the system fallback, and keep the font source in deployment configuration rather than user-editable URLs. |
| Page title | 30/36px desktop; 26/32px narrow; weight 600. Separate public display heading role. |
| Section and record title | 18/24px and 16/22px, weight 600. |
| Body and controls | 14/21px body; 14/20px actions; 13/18px persistent labels. Editable touch fields use at least 16px text. Reading areas may use 16/24px. |
| Metadata | 12/16px minimum default, adequate contrast, sentence case. Tabular numerals for durations/counts. |
| Weights | 400, 500, 600; reserve 700 for rare emphasis. |
| Spacing | 4, 8, 12, 16, 20, 24, 32, 40, 48, 64px; shared roles for page inset, section gap, control gap, and cell inset. |
| Standard/compact control | 40px minimum visual height on fine pointers; compact variants reduce horizontal padding, not target height. Coarse-pointer targets remain at least 44×44px. |
| Shapes | 10px fields/menus, 14px meaningful panels, 20px dialogs; primary/secondary action capsules. Cards, fields, and rows do not all become pills. |
| Rows | 48px comfortable / 40px compact minimum for single-line desktop rows; content and larger text increase height. Touch actions keep 44px targets in either density. |
| Icons | One consistent SVG family/style, typically 16px controls and 20px navigation; shared icon alignment. Label unfamiliar actions. |
| Focus | One visible ring owner; 2px ring with offset, visible against both surrounding surfaces, not clipped. |
| Motion | Feedback 120ms, reveal 180ms, contextual sheet 240ms, exit 140ms as tunable defaults. No animation delays business completion. |

Use semantic `--nova-*` tokens for color pairs, type roles, spacing roles, control sizes, radii, elevation, motion, and stacking. Bridge existing names temporarily in one stylesheet; remove aliases after the last consumer migrates. Component variants consume tokens. Features do not each define another green, input border, or title size.

Treat the product UI playbook as a quality bar and adapt its examples to NOVA's native module structure. `/styles.css` is only the ordered import manifest; it must not become the home for screen layouts or feature compositions. Feature modules own their page structure and, when substantial enough, their responsive styles beside the feature. Shared styles own stable interaction mechanics and primitives. Keep the theme palette in `tokens.css`, have product styles consume semantic tokens, and add a regression check when a new feature stylesheet is introduced so local literals cannot silently escape theme changes.

Each control requires default, hover, focus-visible, pressed, disabled, pending, and applicable selected/open/invalid states. Disabling a control does not explain a blocker: show a concise reason when the unavailable action is relevant. Use purpose labels such as Save role, Submit for review, Pause work, and Request leave.

## 5. Responsive layout contracts

Breakpoints are starting content-fit rules, not device detection. Use CSS Grid/Flexbox and shared media-query thresholds for the shell. Use container queries when a reusable region needs to respond to its actual allocated width; provide a readable single-column baseline.

| Available viewport | Shell and spacing | Collections and details | Forms and controls |
| --- | --- | --- | --- |
| 320–639 CSS px | Compact header, explicit menu button, modal navigation drawer; 16px page inset, reduced to 12px only where needed at 320 | Summary list for serial work; genuinely comparative tables get a named local horizontal scroller. Details become a route or full-height sheet. | One field column; toolbar rows wrap; filters open a labeled sheet. Important action stays visible in flow; use a sticky action bar only when it does not obscure content or the keyboard. |
| 640–1023 | Tablet/split-screen layout; 20–24px inset; drawer remains default so content keeps useful width | Compact table or list based on content; usually one primary pane. Full record view or sheet for detail. | Two columns only when each field retains sufficient width; decision summaries span both columns. All touch targets retained. |
| 1024–1279 | Persistent approximately 232px rail if content fits; 24–32px main inset; optional collapsed rail | Main workspace uses the available width. Detail normally replaces the workspace or opens as a modal sheet. | Inline toolbar with wrap fallback; grouped forms capped around 720–800px. |
| 1280–1535 | Persistent rail and generous working area | Side inspector only when its actual container can hold at least 680px main + 360px inspector + gap. A 1280px viewport alone is not sufficient with a full rail. | Controls stay aligned; primary action remains near title or current work. |
| 1536+ | Same hierarchy; comparison surfaces can grow, reading/forms stay capped | 360–440px side inspector when useful; sensible column widths and quiet outer margins | Do not stretch fields, labels, or paragraphs across the entire monitor. |

The desktop width rule is arithmetic: **workspace width ≥ 680px main + 24px gap + 360px detail** before showing both panes. Rail and page insets are outside that workspace measurement. At larger text settings or with wide content, collapse earlier.

At 640–760 CSS px, the current implementation deliberately keeps cards and forms in one column; at 761px and above, only card grids gain a second column, while form columns remain based on the allocated width. Standard fields use a 40px minimum height on fine-pointer layouts and expand to 44px for coarse-pointer layouts; compact visual buttons also retain the 44px coarse-pointer hit area.

### 5.1 Behavior by surface

| Surface | Desktop | Tablet | Phone |
| --- | --- | --- | --- |
| My Day | Primary timeline/current work; compact secondary upcoming/request context | Main timeline followed by secondary sections | Attendance state, current work, timeline, then optional modules; no long dashboard grid before the next action |
| Work | Useful comparison columns with contextual detail | Prioritized columns; detail takes focus in its own surface | Task/assignment summary rows with title, workstream, status, due state, next action; full details on open |
| Reviews | Queue + decision detail when width permits | Queue → detail, preserving position | One review at a time with visible back/next and complete evidence; action footer respects keyboard/safe area |
| People | Directory table + record | Directory with reduced visible metadata | Name, lifecycle, organization context; full profile and lifecycle forms on dedicated surfaces |
| Availability | Calendar/agenda and separate request queues | Agenda by default; calendar choice where useful | Chronological agenda, date jump, request detail; month view is optional, not the only entry |
| Role editor | Permission groups, grant scope, impact summary | Stacked groups with scoped selectors | Searchable permission groups and full-width grant rows; no squeezed permission matrix |
| Operations | Comparison tables and query controls | Priority columns and local scrollers | Summary list where comparison is unnecessary; explicit scrollable comparison table when necessary |
| Deployment/setup | Step rail and focused content | Compact step summary + content | Current step, progress text, next/back; technical commands wrap or scroll locally |

### 5.2 Non-negotiable layout behavior

- No page-wide horizontal overflow in ordinary content. Long names, emails, workstream paths, errors, translated labels, and IDs wrap or truncate intentionally with an accessible route to the full value.
- Preserve all important information/actions across breakpoints. Fewer visible table columns means details remain reachable; permission state, task context, blockers, and primary action are never removed to make a screenshot fit.
- Use one normal vertical document scroller. A table may own its horizontal axis; a modal may own a bounded internal vertical scroller. Avoid nested vertical scrolling inside every dashboard section.
- Retain OS scrollbars. Put stable gutter policy on `html` and verify overlay opening does not move the header/content edge. Use dynamic viewport height and safe-area padding for drawers/sheets.
- At short landscape heights or high zoom, let modal chrome scroll when a sticky header/footer would crowd out the form. Focused fields must remain visible above on-screen keyboards and sticky actions.
- Verify representative widths at 320, 390, 768, 820, 1024, 1280, and 1440 CSS px, plus 200% text enlargement and 400% browser zoom. Check keyboard focus and Escape/focus return for the workspace drawer, coarse-pointer hit areas, long translated labels, deployment-step wrapping, and page-wide horizontal overflow.
- Navigation drawer closes after route selection. Escape closes the topmost overlay; dismissal restores focus to its trigger, while completed navigation focuses the destination heading.
- Resize/orientation changes preserve form values, selected record, filters, and active assignment. Avoid mounting separate desktop/mobile business stores or submitting twice.
- Test reflow at 320 CSS px and equivalent 400% zoom from a 1280px viewport. Two-dimensional data may use a local scroll region; surrounding controls still reflow. [W3C reflow](https://www.w3.org/WAI/WCAG22/Understanding/reflow.html)
- NOVA's proposed 44px touch target exceeds the WCAG 2.2 AA 24px minimum and its exceptions; do not mistake 44px for the literal AA requirement. [W3C target size](https://www.w3.org/WAI/WCAG22/Understanding/target-size-minimum.html)

## 6. Complete screen and workflow briefs

Every brief is implemented with the applicable state matrix in section 7, authorized record scope, and the responsive rules above. Page recipes are shared; domain transitions remain feature-owned.

### 6.1 My Day

**Job:** understand today and perform the next valid action. Lead with the effective office business date/timezone and person context. Put attendance state beside the active work summary, followed immediately by the single Daily Work Timeline. Keep assigned work and pending personal requests as secondary modules. At wide widths, a secondary Quick access panel may list destinations already visible in the shared permission-aware workspace registry and personal navigation order; it performs no additional reads or grants. Place it after daily content on tablet and phone. Every feature inside those destinations continues to gate its own reads and actions independently.

The timeline uses the authoritative projection of attendance, work sessions, gaps, exceptions, and supported non-work events. A chronological semantic list is the baseline; any visual time track has the same accessible content. An update to a displayed clock must not rebuild the page or announce each second. Resume/reconnect checks authoritative session state.

Check-in differentiates office and approved WFH, requests location at the relevant action, and explains geofence/accuracy/permission failures. Do not display WFH approval as completed attendance. Check-out must communicate any server-required session resolution. Timeline correction exposes only eligible past gaps, names the assignment and reason, and shows the authoritative result. Expose recovery actions only where supported and permitted.

Acceptance: attendance-required and attendance-optional users both complete their legal daily loop; leave, holidays, closed day, provisional WFH, missed checkout, and permission changes produce truthful states. Date-only requests remain date-only; office business dates never silently become browser-local dates.

### 6.2 Work collection and task detail

**Job:** find, understand, execute, and revisit assigned work. Default to Mine with useful All visible / Due / Awaiting review filters according to access. Table supports comparison; list supports serial work; an optional status board is a presentation of existing states, with no implicit transition created by moving a card.

Show task title, client/organization workstream, status, assignee or assignment count, due state, and only relevant classification metadata. Separate task-level aggregate state from each Work Assignment and review cycle. Keep Create task in the collection header; move reusable definitions and billing policy maintenance to Work configuration.

Task detail places title, context, lifecycle, and next legal action first. Sections contain description/properties, assignments and reviewer, work sessions, review history, corrections, and audit-relevant history. Use explicit edits for due date and reassignment. Preserve source filters and scroll on close/Back.

Creation requires explicit client/organization context and a valid workstream. A reusable task definition previews its effect. The server classifies billability; the form must not offer an unauthorized manual classification switch. Correction tasks link to their source and remain separate work, preserving billing provenance and historical snapshots.

Acceptance: create, assign/self-assign where permitted, start, pause, submit, revise, inspect correction, and revisit history work without global rerender or lost drafts. Browser retry cannot duplicate creation. Board grouping never rewrites status or assignment data merely to alter layout.

### 6.3 Reviews and collaboration

**Job:** make a decision with the required evidence. Present a scoped queue with task context, assignee, submission age, review cycle, and exception state. Open review detail with submission/history and eligible decisions.

Approve and Request changes use different action recipes. Request changes collects a required reason in a designed form, replacing `window.prompt`. Decisions stay pending until confirmed. A stale cycle shows the newer record and retains the reviewer's draft feedback. Handover and reviewer changes show valid candidates, ownership consequences, and unresolved exceptions.

Acceptance: queue → review → decision → next item works by keyboard/touch. No self-review or scope bypass. Handover, missing candidate data, duplicate decision, permission loss, and concurrent resolution are explicit. Do not label a capped queue as the complete organization total.

### 6.4 People and lifecycle

**Job:** locate a person and manage authorized lifecycle work. Directory fields prioritize name, lifecycle, office, Organisation Department, and applicable role summary. Invitations and onboarding are visible saved filters or queues rather than forms inserted above every person.

Profile header shows lifecycle and next action; sections contain operational setup, effective-dated organization/role assignments, accessible work/availability projections, and history. Only request fields the actor can use. Onboarding is a short checklist of actual prerequisites. Freeze, offboard, complete exit, and handover use impact review, required reasons, and explicit final actions.

Acceptance: invite → delivery or secure handoff → account entry → verification → onboarding → activation is traceable. HR with only onboarding authority can perform the allowed slice. Freeze/exit retains history and reflects session/operational consequences. Similar names have enough context to avoid acting on the wrong person.

### 6.5 Availability, leave, WFH, and recovery

**Job:** request time/location arrangements and review exceptions. Separate My requests, Team requests, Calendar, and Configuration. Request lists show dates, request type, current decision, and permitted cancel/review actions.

Leave/WFH forms keep effective office timezone and date semantics clear. Expose approved, pending, rejected, cancelled, conflicting, and provisional attendance relationships. Calendar is a projection, not a separate scheduling database. Review details show relevant conflicts and consequences before decision.

Configuration groups shifts, calendars, weekly rules, holidays, WFH policy, attendance interpretation, and geofence under their office/effective date. Historical exceptions belong to a recoverable queue with resolution notes; changing configuration does not visually imply rewriting history.

Acceptance: employee request and scoped reviewer decision are tested together, including overlapping/changed dates, recovery, leave cancellation where permitted, and different office-local business dates. Geometry/time evidence is shown only as needed for the decision.

### 6.6 Clients, workstreams, groups, catalog, and billing rules

**Job:** maintain work context and reusable definitions without interrupting daily execution. Use navigable client/workstream records with scoped members, optional groups, tasks, and configuration. Keep Organisation Workstreams distinct from Organisation Departments.

Task catalog includes approved definitions, proposal/review state, and where a definition applies. Billing settings show inheritance, explicit override, reset-to-inherit, effective behavior, and history. Preview the impact on future work; do not imply existing tasks/sessions change when policy changes.

Acceptance: no orphaned or guessed task context; membership candidate reads honor access; classification/billing provenance remains visible and accurate; restricted actors do not get misleading empty administration forms.

### 6.7 Operations and audit

**Job:** compare authorized facts and follow exceptions to their records. Use explicit domain, scope, date range, and data freshness. Keep people/work/calendar reports connected to canonical detail surfaces. Audit is a separate read-focused surface with actor, action, time, affected object, and useful filters.

Keep CSV export next to the exact query it exports. Until server pagination/export contracts guarantee completeness, label exports as the loaded result set and expose any cap. No fake global counts, financial summaries, or invented payroll dashboards.

Acceptance: displayed scope, count, read status, and export agree. A partial/denied read disables an affected export without erasing unrelated useful results. Pagination and deterministic ordering preserve position.

### 6.8 Inbox and notification settings

**Job:** find a relevant event and continue the underlying work. Use compact rows, readable unread distinction, timestamp, context, and a real target link. Mark-read feedback is local; optional email preferences live in personal Settings.

The deep-link resolver validates parameter names/IDs, reauthorizes the target, and opens the correct task, assignment, request, or attendance record. Missing/deleted/inaccessible targets show a safe explanation and a relevant return path. Marking a notification read never performs its underlying business action.

Acceptance: existing `today&task=`, `today&leave=`, `today&wfh=`, `today&attendance=`, `work&assignment=`, and `work&task=` links work. Generic notifications never disclose details not allowed in the destination.

### 6.9 Settings, access, and operator surfaces

**Personal:** account verification/password, appearance, navigation/home, and notification preferences. **Organization:** identity/defaults, offices/departments, roles, attendance policies, email delivery, public links, ownership, secure handoffs, delivery operations, audit.

Role editor separates action permissions and scoped grants from operational eligibility. Starter profiles are editable previews with visible grants; changing a starter never silently adds privileges. Scope selectors show only valid choices. Save shows impact and checks revision.

Email configuration follows save → connect if applicable → test → activate. Show runtime provider support. Public-origin changes explain resulting link behavior and existing blockers. Secure handoffs retain one-time reveal and expiry/consumption semantics. Secrets/passwords never enter customization storage or ordinary activity logs.

Acceptance: personal settings remain usable without administration authority; protected Super Admin rules remain intact; provider failure does not block core work; ownership transfer and public-origin changes use existing server commands and accurate consequences.

### 6.10 Public authentication, first run, and deployment

**Job:** enter an existing workspace or complete a real setup. Use focused forms with one primary action, persistent labels, password-manager/autocomplete support, useful validation, and an obvious recovery route.

Setup stages correspond to distinct decisions and persisted outcomes, not arbitrary field counts. Track founder registration, organization creation, public-origin save, and verification separately so a later-stage failure does not restart completed commands. Keep bootstrap and token material ephemeral.

Deployment guide retains provider-specific steps and readiness checks. A selected checkbox is an operator attestation, not proof of remote provisioning. Reduce repeated technical prose while keeping exact instructions discoverable. Browser setup does not claim it configured a host, copied secrets, or installed a scheduler.

Acceptance: retry preserves safe fields and active token context; invalid/expired links are distinct from recoverable submit failure; manual recovery is clear when email is disabled. All existing supported deployment-guide paths remain valid.

## 7. Interaction and state contracts

### 7.1 Data and mutation states

| State | Visible behavior | Engineering contract |
| --- | --- | --- |
| Initial loading | Retain shell/title; region-shaped skeleton or concise status | Skeletons are decorative; announce once per region. |
| Ready | Real records and valid actions | Stable record IDs; no invented status/counts. |
| Empty | Explain absence and permitted next action | Successful empty response, not swallowed failure. |
| Filtered-empty | Retain query/filter controls and clear action | Clearing search does not silently reset unrelated filters. |
| Refreshing | Retain usable content, drafts, position, and selection | Local updating status; obsolete responses cannot replace current scope. |
| Stale / temporarily offline | Name freshness/paused refresh when it matters | Retain protected data only while authorization remains valid; no promise of synchronization. |
| Denied / session lost | Appropriate recovery/permission explanation | Remove protected data and relevant caches; do not keep stale rows after permission revocation. |
| Partial read failure | Preserve successful independent regions | Scoped retry; failed counts/exports marked unavailable. |
| Validation failure | Inline field error + focused error summary when needed | Draft retained; labels/errors associated programmatically. |
| Submitting | Stable action geometry, named pending intent | Guard duplicate activation across all entry points for that command. |
| Confirmed failure | Error beside the failed work, explicit retry | Preserve input and command context. |
| Unknown write outcome | “We could not confirm the result” + Check status | Reconcile by existing command identity/resource read; do not blindly repeat a consequential write. |
| Revision conflict | Show latest relevant changes and retained draft | No silent overwrite; explicit rebase/keep-latest/review choice as supported. |
| Confirmed success | Updated authoritative record and local feedback | Clear only the completed draft; toast is supplementary. |
| Unsupported capability | Explain unavailable action only when relevant | Do not add pretend UI with no command/data contract. |

Use simple feature-local state objects with mutually exclusive statuses. Do not build a generic workflow engine to encode this table. High-consequence decisions wait for server confirmation; low-risk appearance changes may preview optimistically.

### 7.2 Shared controls and overlays

- **Buttons:** primary, secondary, quiet, danger; stable label/icon/pending slots and intentional pressed feedback. One dominant action per compact group.
- **Fields:** visible label, optional hint, associated error, correct type/autocomplete/input mode, readable disabled value, and no fixed height that clips increased text.
- **Selectors:** native select for short simple values with a crafted trigger; searchable accessible combobox for large person/workstream lists only after choosing a tested behavior solution. Custom trigger/open panel/focus/selection must be consistent. Native popup rendering may vary by OS.
- **Menus versus filters:** commands use menu behavior; compound filters are labeled forms. Do not nest interactive fields inside listbox options.
- **Dialogs/sheets:** prefer native `<dialog>` for modal semantics, with explicit accessible title, initial focus, close/dirty handling, scroll policy, and focus restoration. Verify nested controls and browser behavior rather than assuming the element completes the product contract. [MDN dialog](https://developer.mozilla.org/en-US/docs/Web/HTML/Reference/Elements/dialog), [WAI dialog pattern](https://www.w3.org/WAI/ARIA/apg/patterns/dialog-modal/)
- **Record inspectors:** nonmodal desktop rail stays in logical document order and retains the collection; modal narrow sheet follows dialog rules. Record changes cannot mix a new title with an old response. Long editing gets a full route.
- **Tables/lists:** native semantics, meaningful row links, separate checkbox and action targets, sticky headers only where they help. Do not add `role="grid"` without its keyboard model.
- **Selection:** stable IDs, explicit selected count, clear visible-page scope. Filter changes disclose hidden selected items; identity/collection/authorization changes clear incompatible selection. “All matching” and consequential bulk operations require a server scope contract before implementation.
- **Search:** filter the authorized collection; indicate if search covers only loaded data until the API supports full search. Preserve input focus, cancel/ignore obsolete responses, and announce settled results once. Global command search is not required for this redesign.
- **Destructive actions:** designed confirmation naming object, reason, impact, and final action; no browser `prompt`/`confirm` for core workflows. Offer Undo only when a real inverse command exists.
- **Reordering:** optional drag is supplemented by Move up/down or Move to controls usable by click, tap, and keyboard. [W3C dragging movements](https://www.w3.org/WAI/WCAG22/Understanding/dragging-movements.html)
- **Sticky controls:** ensure keyboard focus remains visible rather than hidden behind header/action chrome. [W3C focus not obscured](https://www.w3.org/WAI/WCAG22/Understanding/focus-not-obscured-minimum.html)

Reduced motion removes travel, scaling, shimmer, stagger, and animated scrolling; static state feedback remains. Focus changes and urgent status never wait for motion. A route change focuses its heading; opening/closing a bounded task returns focus meaningfully. Editing a field, filtering, refreshing, or showing a toast does not unexpectedly move focus.

## 8. Full customization, with clear ownership

Customization is a committed part of this plan. The implementation is complete only when supported choices actually affect the corresponding migrated pages, survive reload, sync at their declared scope, recover failed saves, and reset predictably. This is more than a theme toggle.

### 8.1 Customization catalogue

| Area | Supported choices | Owner/scope |
| --- | --- | --- |
| Theme | System, white/light, black/dark; immediate preview | Person + organization; system is the initial mode default |
| Accent | NOVA green default, curated accessible presets, custom color with validated/derived light and dark foreground/fill/hover/focus pairs | Personal preference; organization may define the default |
| Surface and shape | Curated neutral surface treatment and bounded subtle/soft corner treatment; readable solid operational surfaces | Personal appearance; semantic component geometry stays coherent |
| Typography | Default/larger type scale, reading width, approved font presets if actually supplied and verified | Personal appearance; no arbitrary remote font URL |
| Density | Comfortable/compact collections and appropriately grouped controls | Personal default plus supported collection override; touch/legibility floors still apply |
| Motion and contrast | Follow system, reduced, off; stronger-contrast treatment | Personal preference combined with OS accessibility requirements |
| Workspace layout | Comfortable/wide content, rail collapse, bounded rail width, inspector preference | Reading preference syncs; rail geometry is device-local |
| Navigation | Pin/unpin permitted destinations, favorites ordering, visible group collapse, permitted default landing page | Personal + organization; Settings/reset remains discoverable |
| My Day modules | Show/hide/reorder supported modules; compact/standard/wide sizes where meaningful; keyboard Move controls; reset | Personal + organization; current critical blockers remain visible outside optional modules |
| Collection views | Supported table/list/board/agenda choice, sort, filters, grouping, columns/order/width, wrap, density, optional metadata | Personal saved view or explicitly shared authorized view |
| Record reading | Supported optional metadata sections, reading width, peek/full-page preference | Personal display; mandatory context and critical state remain available |
| Shared defaults | Organization identity/branding, approved default appearance, default home/view arrangements | Explicit administrative configuration; preview impact, authorization, revision, audit |
| Notifications | Existing per-event optional email choices, exposed coherently in Settings | Existing notification preference contract; not merged into appearance storage |

Do not expose raw CSS, arbitrary JavaScript, unbounded dimensions, a free-form dashboard schema, or editable domain status vocabularies as appearance customization. Curated options can still give broad control without every person becoming a UI designer. Custom accents must never recolor warning/danger semantics into ambiguity.

Logo/upload customization, if included in shared branding, requires an actual constrained asset upload/read/delete contract, validation, accessible text fallback, and an owner. It must not be represented by a nonfunctional image picker. Organization name is already a domain field and retains its existing command.

### 8.2 Resolution and persistence

Resolve defaults in this order: **product defaults → authorized organization defaults → selected shared/personal view → allowed personal overrides → temporary safe route/session choices**, then apply accessibility and authorization constraints. Personal choice does not mutate a shared default.

Use narrowly scoped PostgreSQL/API contracts for four record purposes. The first personal appearance contract is now implemented; add the other records with their owning features:

1. Personal UI preferences, keyed by organization + person: version 1 currently stores appearance, navigation order/pins/home, and My Day modules. Saved task-view definitions live separately in the owner-scoped revisioned contract added in migration 0077; they are not copied into generic preferences.
2. Organization UI defaults: administrator-controlled default presentation/branding, not business policy.
3. Saved view definitions: authorized personal/shared query and display definitions bound to a specific collection.
4. Personal overrides to shared views: patch of permitted fields plus the shared base revision.

Each record has a schema version for data migration and a separate revision for concurrent writes. A few well-scoped tables/commands are sufficient; no generic settings service or remote configuration platform is required. Reuse the API actor context, RLS, validation, audit where applicable, and optimistic-concurrency conventions already present in NOVA.

Persist cosmetic changes with allowlisted field patches and the expected revision. Preview immediately; debounce synchronization and expose Saving/Saved/Retry locally. Merge independent-field updates; competing edits to the same field get a deliberate choice. A newer unrecognized schema is not overwritten by an older client. Migrations validate enums, lists, bounds, collection/property IDs, duplicates, and retired keys.

Device storage is optional acceleration for safe appearance/rail state, with graceful storage failure. It is not the authoritative cross-device record. Do not store personnel data, credentials, tokens, raw search text, private notes, or arbitrary query definitions in generic preferences. Saved query values live in the authorized saved-view contract with sensitivity/retention rules.

On account change/logout/permission loss, cancel pending scoped work, clear protected caches and drafts, and ignore previous-identity responses. Unauthorized saved fields/modules disappear immediately. Keep harmless compatible defaults when saved configuration cannot load, while explaining that synchronization is unavailable.

### 8.3 Reset rules

- Reset appearance restores inherited product/organization appearance without touching views or domain settings.
- Reset navigation/home restores that person's applicable default layout and clears personal patches only.
- Reset this view clears current search and temporary route overrides. For a shared view, return to the latest shared definition; for a saved personal view, discard unsaved edits back to its saved definition; for an ad-hoc view, restore default configuration.
- Resetting a view does not delete it or silently clear selected record context; explain hidden selected IDs. Changing collection/identity/scope clears incompatible selection.
- Delete saved view is a separate deliberate operation. Save for team is a distinct authorized action with an impact preview. Restoring organization defaults never changes attendance, permissions, or other domain policy.

## 9. Frontend architecture and maintainability

### 9.1 Smallest sufficient organization

The target is small native ES modules with explicit mount/update/dispose responsibilities. Create a file/folder when its responsibility is migrated; do not scaffold the whole tree empty.

```text
web/
  app.js                     bootstrap only after migration
  app/                       route registry, mounted shell, session boundary
  ui/                        native controls, fields, modal/menu behavior,
                             feedback, record inspector, collection toolbar
  platform/                  HTTP/error mapping, identity/request lifetime,
                             central date/duration formatting
  features/
    auth/                    public entry, token-scoped forms, recovery
    my-day/                  daily composition, attendance, timeline
    work/                    task/assignment/correction presentation
    reviews/                 queue, decisions, reviewer/handover UI
    people/                  directory and lifecycle UI
    availability/            requests, calendar, configuration
    operations/              reports and export UI
    settings/                account, access, organization, providers
    preferences/             resolution, validation, persistence, reset
    deployment/              existing guide and stage behavior
  styles/
    tokens.css               canonical semantic values
    base.css                 restrained reset, type, focus, document flow
    controls.css             reusable control recipes
    shell.css                navigation and responsive composition
  styles.css                 ordered entry while compatibility requires it
```

Feature-specific styles stay beside their feature when needed. Keep small related UI/data/state functions together until separating them improves ownership. Do not create a model/data/workflow folder for every small form. Shared primitives never import features. Features use a deliberate public contract when collaborating; neither the shell nor a global utility file owns their business rules.

Keep explicit CSS source order and feature namespaces. Avoid growing a file of final override selectors, permanent duplicated token systems, or `!important` everywhere. Retain the existing global `[hidden]` safeguard where needed. Adopt cascade layers only with an intentional legacy-unlayered-style strategy; simply layering new rules under unlayered legacy CSS will not solve specificity.

### 9.2 State ownership

| State | Canonical owner |
| --- | --- |
| Records, permissions, classifications, policy, history, time truth | API/PostgreSQL |
| Active route, permitted record ID, safe date/view/sort/page | Validated URL + route module |
| Current fetched data | One feature resource state, scoped to actor/organization/query |
| Form input, review notes, selection | Feature instance; retain through local recovery |
| Temporary menu/dialog state | Owning UI component |
| Appearance/navigation/home/views | Authorized preference/view records |
| Rail width/collapse | Bounded device-local presentation |

Use one session epoch plus route/request identity to prevent old responses updating new users or routes. Abort obsolete reads where possible; abort is not proof a server write was cancelled. Provide feature disposal for event listeners, subscriptions, and display timers. Render local regions and changed rows rather than replacing the whole application after every event.

Preserve existing safe text escaping and use `textContent` for external data. A templating refactor must not introduce HTML injection. Do not serialize sensitive drafts into URL/history. Maintain `no-referrer` and token-redaction behavior on account entry pages.

### 9.3 Reuse and dependency decisions

| Need | Initial choice | Revisit only when |
| --- | --- | --- |
| Routing | Existing History API + validated registry/compatibility resolver | Nested route lifecycle cannot stay clear after the pilot |
| Styling | Semantic CSS custom properties, Grid/Flexbox, purposeful responsive rules | There is a demonstrated unmet behavior; a utility framework is not required for polish |
| Ordinary controls | Native semantics with shared crafted styling | Actual browser/keyboard behavior fails the required task |
| Modal | Native dialog with NOVA lifecycle/scroll contract | Browser-matrix evidence shows unmet behavior |
| Searchable large selector | Evaluate a maintained accessible native-compatible solution against explicit keyboard/touch requirements | Needed by real people/workstream volume; do not hand-build an incomplete combobox |
| Tables | Native table + scoped sorting/pagination | Measured editing/selection/size complexity justifies headless mechanics |
| Data state | Feature resource state and small transport/lifetime helper | Multiple live consumers require a more capable shared cache; no parallel sources of truth |
| Motion | CSS | Coordinated interrupted presence cannot be maintained simply |
| Icons | One verified small SVG set, installed/subset or local as appropriate | Needed icon coverage warrants expansion; avoid shipping an entire catalogue |
| Browser tests | Existing harness where meaningful plus one real-browser test tool | Layout/focus/recovery cannot be proven by the current DOM stub |

Any dependency decision records the unmet requirement, native/existing alternative, accessibility behavior, compatibility, license, maintenance, measured bundle impact, and replacement boundary. Do not introduce React, a UI kit, router, state library, query cache, animation library, and table engine as a single redesign prerequisite. Equally, do not reject a mature accessibility primitive when it is the smaller reliable solution.

## 10. API and platform work required by the experience

| Requirement | Existing capability | Additive work / boundary |
| --- | --- | --- |
| My Day | Attendance, work session, timeline reads/commands exist | Compose reads without creating new truth; add missing timeline workstream/client labels to authorized read projections. |
| Deep links and record detail | Notification IDs and domain APIs exist | Resolve legacy parameters; verify/add scoped detail reads where list-only reads cannot retrieve a target. Never load every record to find one. |
| Complete collection search and pagination | Some lists are unbounded, others capped | Move visibility/scope filtering before page limits; deterministic order + cursor/query metadata; authoritative totals only where affordable/needed. |
| Reliable exports | Browser CSV from canonical returned rows | Label loaded scope now; add authorized complete-query export only when required, with correct cap/partial/error handling. |
| Full customization | Personal appearance/navigation preference schema v1 and personal saved task-view schema v1; optional notification preferences remain separate | Continue applying appearance/layout controls across migrated pages. Organization defaults and shared-view overrides still require separate permissions and APIs; retain notification preferences separately. |
| Conflict and retry | Some commands already have idempotency or revision contracts | Inventory each migrated command. Reuse existing contract; add missing deduplication/versioning only where command semantics require it. No fake universal operation endpoint. |
| Existing capabilities without complete UI | Attendance recovery, leave cancellation, assignment reviewer management, client membership, delivery inspection/requeue exist in API routes | Build scoped feature flows against those contracts and test lifecycle outcomes. Do not claim they are new backend engines. |
| Static assets | Different hosting adapters expose the same `web/` client | Explicitly verify every imported JS/CSS/asset path and auth deep link on Node/VPS, Cloudflare, Netlify, Vercel. Allowlist intended static roots; keep API precedence and path safety. |
| Broader type checking | Server/adapters are TypeScript; browser modules mainly JavaScript | Add JSDoc + `checkJs` incrementally for changed contracts, or a narrowly justified compile step if the pilot warrants it. Do not force a build-system rewrite solely for syntax preference. |

No new direct Supabase calls from the browser. Customization storage and collection APIs use the same authenticated NOVA boundary and portable PostgreSQL model.

## 11. Implementation sequence and review gates

The design deliverables below are required work, not optional polish at the end. Parallel implementation is safe only after shared tokens/controls/contracts are agreed. Workstreams may then proceed by feature ownership; one owner integrates the shell, API contracts, and design system.

| Phase | Concrete deliverables | Exit gate |
| --- | --- | --- |
| 0. Baseline and design evidence | Complete this source inventory with isolated browser walkthroughs, role/capability scenarios, realistic long-content fixtures, current screenshots, request/asset baseline, and component inventory | Observed behavior is separated from mock/simulated states; priority workflow issues are reproducible. |
| 1. Foundation and recovery | Complete light/dark semantic tokens; select and license the NOVA brand font and configure its Fastly-served WOFF2 assets with a system fallback; type/spacing/icon rules; crafted control specimen; mounted shell; route/focus lifecycle; preserve failed forms and token context; identity cleanup; static asset checks | Both themes and control states work at 320/768/1024/1440 widths, keyboard/touch; the font loads from the confirmed Fastly path and falls back cleanly when unavailable; auth recovery survives a recoverable failure; all intended assets load. |
| 2. Complete pilot: Work + detail + My Day link | High-fidelity layouts for 390, 768, 1024, 1440 widths; task collection, detail, creation/edit/retry loop; supported record deep link; current-work integration | Create/find/open/edit/recover/return works with scoped permissions and real persistence; resize preserves context. Pilot proves native-module maintainability. |
| 3. My Day and review execution | Unified daily surface, attendance/geolocation/WFH states, timeline/correction, task review and handover forms | Full attendance/work/review loop passes for required/optional attendance and relevant roles; unknown outcomes/conflicts are handled. |
| 4. People and Availability | Directory/profile, invite/onboard/freeze/offboard/handover; request/review/calendar/configuration and recovery surfaces | Employee + HR + reviewer journeys complete; effective dates, history, and restricted scopes remain correct on phone/tablet/desktop. |
| 5. Configuration, operations, and public surfaces | Clients/workstreams/catalog/billing, role/access editor, reports/exports/audit, inbox, account/operator settings, first run/deployment refinements | No orphaned legacy workflow; notification targets open; exports are honest; provider/role constraints preserved. |
| 6. Full customization rollout | Persistent appearance, navigation, home modules, personal/shared views, scoped defaults; custom palette validation, migrations, conflict/reset UX | Every catalogue choice is functional across relevant migrated pages; cross-device persistence and account separation proven; reset semantics tested. |
| 7. Release and retire old UI | Cross-browser/device/accessibility/performance evidence, asset/deep-link matrix, legacy code/style deletion, final usage checks, contributor recipe | Complete workflow and theme matrix passes; no duplicate sources of truth; rollback remains possible without losing business data. |

Start preference schema and appearance persistence during phase 1; apply appearance settings to the pilot in phase 2. Phase 6 finishes broader layout/view customization after the destination surfaces exist. This sequencing does not remove customization from scope.

Phase 1 visual deliverables must include control states, navigation, a dense collection, long form, modal, loading/empty/error/denied examples, and both default themes. Phase 2 must demonstrate a full workflow at actual viewport sizes rather than a desktop mockup shrunk to phone scale.

For each feature increment: write a short actor/job/record/transition brief; identify authorized data and expected volume; design happy/error/narrow states together; implement against existing commands; verify visual and persisted outcome; remove migrated legacy code. Rollback switches page presentation only and keeps domain data/migrations backward compatible. Avoid a long-lived parallel frontend.

No reliable calendar estimate is possible before the browser baseline and pilot. Use these exit gates as the delivery plan; estimate later phases from measured pilot throughput and actual API gaps.

## 12. Verification and release definition

### 12.1 Viewport and input matrix

| Test condition | Required coverage |
| --- | --- |
| 320×568 | Minimum reflow; no lost action or clipped error/label |
| 360×800 and 390×844 | Common narrow workflows; full forms, sheet, nav, keyboard opening |
| 430×932 | Large phone; long titles and touch targets |
| 768×1024 and 820×1180 | Tablet portrait and touch forms/queues |
| 1024×768 and 1180×820 | Tablet landscape/small laptop; short viewport and inspector decision |
| 1280×800 and 1440×900 | Desktop collection density and actual inspector fit |
| 1920×1080 | Wide comparison without overly stretched forms |
| Arbitrary split window and orientation change | Content-fit thresholds, draft/record/selection preservation |
| 200% text size; 400% zoom equivalent; forced colors | No clipping; usable reading order/focus/control boundaries |
| Keyboard, fine pointer, coarse pointer, screen reader | Complete job without hover/drag dependence or traps |
| Reduced motion and off | No travel/shimmer/scale; state remains obvious |

Proposed browser matrix: current stable Chromium/Edge and Firefox on desktop; Safari on supported macOS/iOS; Android Chrome. Record exact tested browser/OS versions in release evidence. Emulation covers dimensions; it does not certify a physical touch keyboard, iOS viewport behavior, or assistive technology. Avoid promising support for untested CSS enhancements.

### 12.2 Content, permissions, and failure scenarios

- Empty workspace, small ordinary set, dense 200-person organization, many historical tasks, and long notes/names/workstream labels. Use bounded page sizes; a 200-person target does not bound task history.
- Super Admin, narrowly scoped HR, reviewer, workstream-only collaborator, employee, attendance-optional worker, unverified person, revoked permission, and inactive lifecycle.
- Initial load, slow response, denied read, partial region failure, stale refresh, offline hint, actual network failure, failed save, duplicate activation, out-of-order response, session/account change mid-request, and concurrent edit.
- Invitation/reset recoverable error after URL token removal; expired link; one-time reveal; setup failure after an earlier command already succeeded.
- Task creation idempotency; billability provenance; due-date conflict; assignment/review distinction; correction restrictions; handover and no eligible candidate.
- Office business-day boundary, different timezones, date-only request preservation, geolocation blocked/timeout/inaccurate/outside radius, leave/WFH conflicts, and closed-day recovery.
- Preference save failure, reload/device sync, field conflict, old/new schema, corrupted/unavailable local storage, retired/unauthorized field, shared-view revision update, and every reset scope.
- Mobile keyboard, long modal, nested picker, Escape order, trigger removal after success, orientation during edit, and sticky footer focus visibility.

### 12.3 Test layers and evidence

Retain existing unit/API/domain checks. Add focused logic checks for route compatibility, preference validation/resolution/migration/reset, query lifetime, and command recovery. Use real-browser integration checks for the highest-risk complete workflows and visual regressions for shared controls plus representative pages. The current stub smoke remains useful for deployment-guide contracts; it is not layout or accessibility evidence.

Run the existing relevant repository checks for changed code: `bun run test`, `bun run typecheck`, `bun run typecheck:operator`, `bun run typecheck:cloudflare`, server build, and browser module syntax/type checks. Add an imported-asset graph check and browser coverage to CI. Run database/RLS/migration fixtures and lifecycle QA only on a verified disposable database when API/schema work requires it. Never infer a hosted deployment pass from local tests.

Pair automated accessibility checks with keyboard and screen-reader walkthroughs (NVDA on Windows; VoiceOver for Apple coverage). Verify contrast on actual rendered token pairs, including every approved custom preset and action state. Use a component/state specimen in both themes to catch system-wide drift before reviewing every screen.

Do not test every customization combination exhaustively. Cover all individual controls, then a pairwise matrix and high-risk combinations: dark + custom accent + compact, large type + narrow + long labels, touch + dense table, reduced motion + async feedback, shared view + lost access, and saved layout + changed screen width.

Measure initial/transferred JS/CSS, request count by route, input latency, layout shift, and representative render/refresh times. Establish budgets from the baseline and test hardware. Changes must not fetch all feature data at shell boot, create per-row request waterfalls, remount the whole app on small updates, or hide capped datasets behind confident totals. Add virtualization only if bounded rendering is still measurably slow.

### 12.4 A feature is done when

- Its primary loop is discoverable, complete, and recoverable, with authoritative persisted outcomes.
- The same job works on phone, tablet, desktop, keyboard, and touch; both default themes and applicable customization controls are supported.
- Empty, denied, loading, failed, stale, pending, conflict, and unknown-outcome states are implemented where relevant.
- Scope/permissions, chronology, billing provenance, effective dates, and history remain correct.
- Direct link, refresh, Back/Forward, source-list return, and resize preserve the intended context.
- No protected state survives identity loss; sensitive data stays out of URLs/preferences/logs.
- The code has an obvious owner, small public boundary, reusable controls, and no unnecessary platform rewrite.
- Verification records distinguish actual browser/API results from fixtures or simulated states, with known limitations retained.

## 13. Immediate execution order and outstanding design work

Begin with an isolated read/write browser QA environment using synthetic data and the existing role matrix. Capture the current critical loops. Then implement the form/token recovery and session/request lifetime foundations alongside the complete white/green and black/green token/control specimen. Verify static asset routing before extracting new modules. Use Work collection → task detail → edit/retry → return as the first polished vertical slice, then join it to My Day's attendance/current-work/timeline loop.

The following are implementation design tasks, not reasons to stop planning: finish all semantic status and dark-boundary color pairs; choose the exact icon source; confirm supported browser versions; measure selector/list volumes; freeze preference/view schemas and retention; define any missing scoped detail/projection endpoints; and select a browser-test runner after inspecting available tooling. A framework choice should remain open only if the complete pilot demonstrates a concrete reason to change the current one.

## 14. Source and decision record

### 14.1 Initial implementation status — 1 October 2026

The first revamp slice is implemented in the existing native client. A single [workspace destination registry](../web/workspace-destinations.js) owns current signed-in destination labels, access predicates, route-entry checks, and home priority. Admin reads the actor grants first, then requests each resource only when its endpoint's exact permission/scope contract is met; denied prerequisites remain distinct from empty results and request failures. Admin feature descriptors gate sections independently, and the geofence office selector uses its purpose-limited endpoint. Invite-only access surfaces Invite without exposing broad Admin reads. The grants read also reports actor-applicable self scopes and whether the person has an open work session, so scoped attendance and timer recovery do not disappear behind route gates. Manually entered routes receive a permission check before their page reads run; client-side visibility remains a hint and API authorization remains authoritative. Admin task operations now receive effective target-scope hints and omit Assign, Reassign, and Cancel actions when the matching permission is absent. Leave and WFH review rows include a server-derived self-review guard; eligible leave requests expose cancellation only when the server says the command can succeed. Client navigation focuses the destination heading on route change and browser Back/Forward. Settings separates personal account and appearance controls from authorized public-origin, Super Admin email-delivery, and authorized secure-handoff areas. Settings and the person's own inbox remain available.

The Work review row replaces its old prompt with a required inline feedback form capped at 2,000 characters, an accessible count and validation message, and explicit send/cancel actions. Drafts stay in memory, scoped to the signed-in actor and assignment; they survive same-actor rerenders and recoverable authorization refresh, and clear on success or confirmed identity change. The pending queue projects strict row-level `canReview` only after current-reviewer, open-cycle, awaiting-review, and effective scoped `tasks.review` checks. Decisions submit the visible review-cycle ID; the command locks the current open cycle and returns a distinct conflict if the page is stale. The client refreshes the queue, preserves the note, and requires the reviewer to acknowledge that the feedback still applies to the newer cycle. A separate reviewer-bound context panel now shows task context and up to 50 prior review decisions without exposing the roster. The schema still has no submitted artifact model. Tests cover feedback validation, queue filtering, expected-cycle input parsing, and detail-query contracts. They do not replace PostgreSQL transaction coverage or authenticated browser/assistive-technology review. The queue remains bounded to 100 rows without a cursor or total.

My Day now composes separate Attendance, My work, daily Timeline, Leave request, and WFH request modules from their existing reads. The destination opens when at least one module is usable; each module read is planned independently and hidden modules issue no fetch. Attendance view is still distinct from check-in, check-out, and mode-change controls, and request modules require their own self-applicable grants. Assignment and timeline previews show bounded rows and link to Work rather than claiming complete history. An action-only attendance role uses the separate `GET /api/attendance/action-context` projection, which exposes only the current-day state and prerequisites needed for its own action; `GET /api/attendance/today` remains view-only and commands recheck the grant.

People freeze visibility and command authorization now agree with the permission catalogue: organisation, office, and department grants are evaluated against the target person's current effective membership. Scoped freeze administrators are also included in the event notification query. Tests check the SQL scope and effective-date contract plus the client target-match hints; actual PostgreSQL lifecycle execution remains a release check.

Personal appearance version 1 now has an additive migration and authenticated `GET`/`PATCH /api/me/ui-preferences` contract, scoped to the session actor by request context and row-level security. Writes use a separate schema version, expected person binding, and revision, debounce in the client, and expose an explicit conflict choice. The current controls cover system/light/dark, curated or custom accent, density, type scale, Inter/device typeface, contrast, motion, surface, and content width. Accent text is derived against its actual tinted surfaces; success states remain semantically separate from the customizable brand. Organization defaults, navigation/home composition, collection views, and shared-view overrides are still outstanding.

The current shell uses a native modal workspace drawer below 1024px and a desktop rail above it. The drawer provides Escape and explicit close behavior, returns focus to its trigger, and keeps phone navigation from pushing page content down. Responsive fixes keep landing cards to one column on phones, stack the deployment step rail below 901px, and give coarse-pointer links and summaries larger hit areas. The light/dark semantic palette has been introduced into the existing stylesheet to avoid a second, empty CSS framework. Inter is currently fetched from the official `rsms.me` stylesheet with system fallback; the requested NOVA font and Fastly asset delivery remain unimplemented pending the licensed font asset and confirmed Fastly origin. The Vercel static map now includes the shared preference module and the existing deployment module import.

This is not a phase-1 exit: the shell still remounts on navigation and failed-form recovery remains incomplete. Admin, Work, Operations, My Day, and Inbox page reads now abort on route or identity changes and ignore stale continuations. Shared button actions now bind their completion to the initiating actor and page, and current 401/403 command failures clear protected data before a guarded grant refresh; the common submit path preserves drafts and applies the same denied-command recovery. Remaining custom form success paths and route loaders still need post-await guards. No live or hosted database was inspected and no migration was applied by this review. A real-browser viewport pass covered the public home and deployment guide at 320×568, 360×800, 390×844, 430×932, 768×1024, 820×1180, 1024×768, 1180×820, 1280×800, 1440×900, and 1920×1080: neither route had horizontal overflow. At 390×844 the Vercel + Supabase choice advanced the deployment guide and retained accessible headings and buttons. The 320px check originally caught and fixed a horizontal overflow caused by an unnecessary body minimum width alongside the stable scrollbar gutter. This evidence covers public routes only; no authenticated role workflow, mobile drawer interaction, zoom, forced-colors, or full input matrix has been performed. Continue the staged workflow in section 11 and keep those gates open.

Responsive follow-up applies the documented 16px inset above 359px and 12px at narrower widths, uses 16px form-control text to avoid narrow-screen browser zoom, adds safe wrapping for long list/error/account text, and resolves system contrast from `prefers-contrast: more`. My Day uses one column through tablet widths and two columns only when the desktop content area can support them; its timeline spans both columns. These source-level fixes still need rendered verification at the required widths and operating-system settings.

The Work pilot now has Mine and All visible summary collections. Mine searches task titles and filters assignment status/due date; it gives full summaries to `tasks.view` roles and a minimal own-assignment projection to roles with a currently usable assignment action but no `tasks.view`. That projection hides detail, billing, review, correction and task-detail navigation while preserving the authorized action and timer controls. All visible searches titles and filters task status/due date. Each collection has its own permission-first stable cursor read, stores filters in the URL, binds cursors to the active filters, avoids invented totals, and reports only the current page. All visible accepts broad `tasks.view` scopes (organisation, client, workstream or group), so a view-only role can browse without `tasks.create`; assigned-work-only roles keep Mine without seeing a duplicate collection or peer-assignment counts. Direct and group-only `tasks.create` targets are returned separately from browsing. A group-only target carries its required parent workstream and group into both task composers, without requiring parent `tasks.view`; optional group choices are limited to authorized context. Opening a task and returning restores the originating task link's keyboard focus and recorded scroll, even when that task appears in both collections. Synthetic browser inspection covered Mine, All visible, and a group-only composer at 390×844, 768×1024 and 1280×900 with no document horizontal overflow; it verifies rendering only, not authenticated API behavior or PostgreSQL execution. Server parser/SQL tests cover action-only DTO privacy, filter-bound cursors, status semantics, broad-scope collection access, and permission-before-limit ordering. The legacy `/api/tasks` read remains in Admin task management, correction selection and Operations export; because it returns the full assignee roster, both the browser read planner and API now require broad `tasks.view` scope before exposing a roster row. Assignee email has also been removed from this response. It still has a pre-visibility 200-row cap and N+1 assignment reads. Replace those consumers with purpose-specific contracts before they can claim a complete collection or export. Verify group-only creation and both collection routes against real scoped role fixtures and PostgreSQL at 390, 768, 1024, and 1440 widths before calling the Work pilot complete.

The follow-up foundation slice adds canonical `--nova-*` color, type, spacing, geometry, control-height, elevation, motion, and layer tokens in the existing stylesheet, with temporary aliases for older selectors. Shared buttons, panels, fields, navigation controls, and focus styling now consume those tokens; personal accent application writes the canonical color roles. High-contrast focus colors remain theme-owned so an inline custom accent cannot override them. This is a token foundation, not a full CSS migration or a phase-1 exit; feature selectors still contain legacy geometry values and need incremental migration with rendered checks.

The control-size implementation follows the 40px fine-pointer / 44px coarse-pointer contract for form fields as well as buttons. The 640–760px single-column behavior is an intentional content-fit rule; the documented viewport and zoom matrix still needs full rendered checks.

The final migration-to-UI review also found that `workstreams.view` could authorize rows from `GET /api/work-context` without enabling Work navigation. The planner now enables only the work-context read for supported `clients.view`, `workstreams.view`, or `groups.view` scopes, and Work renders those server-filtered records in a read-only context panel. It does not enable task collections, creation, catalog proposals, or billing changes. Person history and client membership pages now use bounded scoped reads; the People directory itself and full client/workstream explorer still need paging and deep-link contracts. Task notification links now route to the matching Work surface; older `today&task=` links are resolved while reviewer-only access stays on the permission-filtered review queue. Other record deep links remain open.

### 14.2 Follow-up implementation status — 2 October 2026

The follow-up closes several previously listed UI/data gaps while keeping feature access tied to the exact grants. Operations now includes a bounded attendance recovery queue and audited reason-required correction form. Availability has a dedicated 31-day business-date agenda with independent source permissions and stable pagination. Person history is linked from the role-filtered directory; client membership managers can page, add, and end memberships when the scoped person picker is available. Settings now supports personal navigation ordering/pins/home choice and My Day module visibility/order. Task review context uses a reviewer-only history projection. The combined availability-configuration read has been split by shift/calendar/holiday grant, so one view permission no longer exposes every configuration dataset.

Static test and typecheck evidence does not substitute for executing the new SQL against PostgreSQL. Docker is unavailable in this environment and the configured database connection was refused, so the people-history, membership, attendance-recovery, availability-agenda, and review-detail queries require a verified disposable PostgreSQL run before release. Authenticated browser and assistive-technology checks across phone, tablet, and desktop also remain release checks. The external Inter stylesheet is currently served by the font author's Cloudflare CDN; the selected NOVA brand WOFF2 and confirmed Fastly origin are not available in this checkout.

The role/component review tightened feature discovery to require the reads each current surface actually consumes: roles, availability configuration, and WFH overrides no longer appear from mutation-only grants when their list/catalog prerequisites are unavailable. Admin and Operations no longer route assigned-work-only viewers through the broad legacy `/api/tasks` roster; their authorized task actions remain on Work's Mine projection. Work navigation also fails closed when the permission read is unavailable, including a stale open-session hint. Admin Work now requires the selector/data prerequisites for client/workstream/group creation and task editing/assignment; permissions with no corresponding edit or reviewer-management UI do not expose an empty Admin section. These are client-side discovery/read-planning rules; server commands continue to enforce authorization.

Work configuration now has a dedicated `?view=work-setup` destination. Organization-scoped catalog capabilities and organization/client/workstream-scoped billing-policy management are planned and loaded independently. Catalog-only actors receive Work setup without Work or Admin; billing-only actors see only authorized workstream policy controls. Daily Work retains its authorized task-definition selector for creation, while catalog/proposal administration and policy editing no longer render in Work or Admin. Server commands remain authoritative and data reads stay bounded to existing API contracts. The mobile workspace dialog now owns vertical scrolling so all permission-visible navigation remains reachable at short landscape heights; automated browser/keyboard confirmation remains open because this checkout has no browser test runtime.

Leave attendance-conflict decisions now use an inline labeled form with an explicit approve/reject choice and required resolution note. The pending-request read exposes the action only when the actor can both review leave and recover attendance for that target; ordinary approve/reject buttons are withheld for conflicted requests. The command still rechecks both grants in its transaction. The earlier “recovery is blocked” note is superseded: a safe, bounded candidate read and Operations queue are now implemented; PostgreSQL execution and authenticated browser verification remain release gates.

Primary repository references: `NOVA PRD.md` (domain glossary, roles/scopes, daily timeline, payroll boundary, smallest correct implementation), `README.md`, `docs/foundation-design.md`, `docs/verification-matrix.md`, `docs/qa-and-completion-plan.md`, `web/app.js` (transitional route/API host), `web/src/design-system/foundations/` (current tokens and theme), `web/src/features/` (feature-owned UI and styles), `web/admin-read-state.js`, `web/role-grants.js`, `web/vercel-config.ts`, server command/read modules, and `.github/workflows/verify.yml`.

The companion [UI feature and capability map](ui-feature-capability-map.md) traces the ordered database migrations through 0077 to existing UI/API capability, missing components, permission boundaries, and data-contract gaps. Treat migrations as the schema source in this repository; hosted migration state must be verified per installation.

The All visible Work collection now uses one semantic task-summary list backed only by `GET /api/work/tasks/visible`. Container-width rules present a single-column, labeled summary on phones; a two-column task/context row with four labeled facts on tablet and constrained layouts; and a wider comparison grid when the collection has room. Client/workstream and optional group/department stay in their authorized DTO; status, priority, due date, and assignment count retain explicit text labels. The count is labeled “Assignments” because the query counts every non-cancelled assignment, and the UI leaves today/overdue decisions to the server's actor-business-date filter. Submitting a filter returns focus to the last-used filter; paging keeps a predictable collection-heading target. Work’s introductory copy now reflects whether a role can act, create, review, or only read; Mine’s empty state is filter-aware and announced once. A local browser harness loaded the real `app.js` and stylesheet with synthetic session, role, and API data. At 320, 390, 768, 1024, 1280, and 1440 CSS pixels it showed one visible task link per row and no document-width overflow; keyboard checks covered filter focus, URL-backed cursor paging, task detail/back focus restoration, and the `tasks.view` versus assigned-work-only collection gate. This confirms the client behavior in the current Chromium browser with mocked API responses only; it does not replace PostgreSQL-backed role tests, zoom/assistive-technology testing, or the broader browser matrix.

On 2 October 2026, the first Work UI ownership slice moved saved-view controls and Settings view management into `web/features/work/saved-task-views.js`, and moved the All visible collection's semantic rows into `web/features/work/visible-task-list.js`. These modules receive role-filtered data and narrow callbacks; `app.js` retains route/query composition and API calls, and the backend continues to authorize every read and mutation. The Work page now puts assignments and visible tasks before secondary reviews, collaboration, and context. Tests cover inaccessible collection hiding, view update/delete affordances, safe text rendering, and save limits. The synthetic Work preview was rendered at 390, 768, 1024, and 1440 CSS pixels; its diagnostic reported no child overflow at each width, and empty results use a neutral status treatment. This does not verify populated data states or authenticated backend behavior. The change starts the Work pilot; it does not complete route extraction or the broader design-system phase.

The same bounded integration pattern now owns the Operations attendance recovery queue in `web/features/attendance/recovery.js`. `app.js` supplies the already permission-planned first page, cursor-backed candidate reads, stale-request guard, time formatter, and the audited correction callback; the component owns the responsive form, locked fields for a known open check-in, live result status, empty/error rendering, and paging. Focused browser-module tests cover empty state, open-check-in field constraints, and cursor continuation. The synthetic Operations preview was checked at 390, 768, and 1024 CSS pixels with no horizontal child overflow. This is visual evidence for the fixture only; it does not validate a signed-in role or live database, and the wider Operations reports still require their own feature boundaries and workflow review.

The date-bounded Availability agenda is now mounted from `web/features/availability/agenda.js`; its module owns labeled date controls, the 31-day validation, event summaries, truthful loaded counts, paging, and distinct loading/empty/error states. The application host retains permission-derived source labels, API transport, URL updates, time-zone formatting, and request-lifetime checks. Focused tests cover the initial prompt, invalid ranges, event content, paging, and denied reads. A populated synthetic fixture at 390 and 768 CSS pixels showed no horizontal child overflow. Role-authenticated browser testing and source-specific authorization verification remain outstanding.

The People directory and person-history presentation now also live in `web/features/people/people-directory.js`. The host supplies the role-filtered directory records, bounded history loader, current-request guard, and history navigation; the feature owns search/filter counts, profile/history composition, and cursor loading. Its directory notice accurately says the source endpoint is not paginated, and a history route refuses an ID absent from the current authorized directory. Focused tests cover filtering, role-scoped IDs, loading, transient paging failures, and access revocation. The populated fixture was inspected at 390 and 768 CSS pixels without horizontal overflow. The People read is currently unpaginated and may grow without a server limit; add stable paging before the dataset becomes large, and finish lifecycle-management flows with their own supporting contracts.

On 2 October 2026, the next integration pass extracted Operations' People comparison into `web/features/operations/people-report.js`. `app.js` keeps grant planning, the people read, history navigation, and CSV generation; the feature owns the scoped table, truthful empty/error states, and accessible row labels. The container switches to labeled records when the report region is at or below 64rem, so the shell's rail and page gutters—not just viewport width—decide when the table becomes cards. A populated synthetic Operations fixture at 1280px showed no child overflow; its rows reflowed to two-column labeled records at the available ~900px content width. No authenticated role or live database was exercised.

The same pass corrected component ownership and theme propagation: Work container-query rules now live with the Work styles, compact density covers the All visible row, persisted compact rules live in the preference stylesheet, and repeated 44px targets consume `--nova-control-touch`. The accent swatch border now uses the semantic control-border token. My Day's screen and shortcut-panel styles have moved from the shared shell stylesheet into feature-owned styles; the legacy stylesheet is an import manifest. A regression test rejects literal palette values in product CSS outside the canonical token sheet. Geist Variable is now bundled locally from licensed Fontsource WOFF2 assets and offered by the appearance editor when the local font assets are present. A Fastly service/origin and deployed cache headers remain unverified; local and configured-host asset paths are documented in `docs/nova-ui-replan.md`.

Applied skills: `C:/Users/hp/.codex/skills/novadesign/SKILL.md` with its design, engineering, and interaction references; `C:/Users/hp/.codex/skills/ponytail/SKILL.md`. The COVENA examples were adapted to NOVA; its violet identity, React examples, and optional feature catalogue were not treated as requirements.

User decision on 1 October 2026: default black/green and white/green, with full customization. This supersedes any assumption that NOVA should adopt COVENA violet. Native modules, exact visual dimensions, page regrouping, and the staged rollout above are proposed implementation decisions grounded in the inspected repository.
