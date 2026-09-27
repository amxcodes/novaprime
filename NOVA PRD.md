# NOVA --- Product Requirements Document

**Status:** Draft v2.02\
**Purpose:** Clean rebuild from scratch\
**Audience:** Product, design, engineering, future contributors\
**Primary deployment target:** GitHub -> Cloudflare Worker + Supabase Cloud PostgreSQL\
**Compatible hosted targets:** Netlify/Vercel Functions + Supabase Cloud PostgreSQL\
**Portability target:** Direct/self-hosted PostgreSQL + NOVA services on a VPS\
**Target organisation size:** 15--50 employees initially, scalable
toward \~200 employees\
**Architecture principle:** One modular application, one canonical
PostgreSQL data model, portable deployment\

# 0. How to use this PRD

This document is the product contract for rebuilding NOVA slowly, one
verified vertical slice at a time.

It defines:

-   what NOVA is;
-   the core domain model;
-   the relationship between people, availability and work;
-   roles and operational capabilities;
-   the unified daily time experience;
-   work timeline correction;
-   task and assignment lifecycles;
-   people lifecycle;
-   payroll boundaries;
-   architecture and portability;
-   security and invariants;
-   the order in which the product should be built.

This is **not** an instruction to implement every feature immediately.

The rule is:

> **Do not build the whole system at once. Build the smallest complete
> slice, verify it with real usage, then continue.**

The existing NOVA/reference material is a source of business rules and
edge cases, not an implementation to blindly extend.

------------------------------------------------------------------------

## 0.1 Smallest correct implementation

NOVA implementation follows this rule:

> Build the smallest implementation that is accurate, secure, complete,
> maintainable, and portable.

"Smallest" means minimum unnecessary complexity, not minimum lines of
code. Code size must never be reduced at the expense of correctness,
security, data integrity, deterministic behaviour, maintainability, or
portability.

Prefer the solution that provides the strongest result with the least
unnecessary custom code:

-   prefer database constraints and atomic transactions when they safely
    enforce a real invariant;
-   prefer standard-library or platform primitives over custom
    implementations when suitable;
-   prefer one canonical implementation over duplicated business logic;
-   prefer explicit, narrow abstractions over speculative generic
    frameworks;
-   prefer simpler code when two approaches provide equivalent security
    and correctness;
-   use a more sophisticated implementation when it materially improves
    security, correctness, reliability, or maintainability without
    creating greater unnecessary complexity;
-   do not optimize for line count alone;
-   do not remove validation, authorization, auditability, or integrity
    protections merely to make code shorter;
-   do not introduce abstractions, dependencies, services, queues,
    caches, or infrastructure without a concrete requirement.

The target is **smallest correct code**, not merely smallest code.

### Code readability and documentation

Maintainability should come primarily from clear structure, naming,
types, boundaries, invariants, and focused functions rather than
exhaustive comments.

Do not add comments that merely restate obvious code.

Use comments and documentation when they explain information that the
implementation cannot make obvious, especially:

-   why a non-obvious domain rule exists;
-   security or trust-boundary assumptions;
-   important database or concurrency invariants;
-   API contracts and externally observable behaviour;
-   historical-data or migration constraints;
-   portability boundaries and provider-specific decisions;
-   deliberately deferred decisions or known limitations.

> **Readable code explains what. Documentation explains why.**

### Engineering priority over UI polish

Backend and domain correctness take priority over visual completeness
during implementation.

A feature is not complete merely because its UI works. The authoritative
domain rule, database integrity, API behaviour, authorization,
concurrency semantics, historical behaviour, focused verification, and
relevant documentation must be correct first.

Early UI may be intentionally minimal and exists primarily to exercise
and validate real domain/API workflows.

**Engineering discipline:** Ponytail full mode

------------------------------------------------------------------------

# 1. Product definition

## 1.1 What is NOVA?

NOVA is a **People + Work Operations System** for service, creative,
technology, marketing, production and similar organisations.

It connects:

-   people;
-   organisation structure;
-   offices and geographic rules;
-   roles and permissions;
-   attendance and availability;
-   leave and holidays;
-   client work;
-   internal organisation work;
-   tasks and assignments;
-   work sessions and time;
-   daily work timelines;
-   reviews and approvals;
-   onboarding and offboarding;
-   payroll preparation;
-   operational reporting.

The central promise is:

> A person should be able to understand their day, availability,
> responsibilities, tasks and recorded work from one place, while
> managers and administrators can understand the same underlying facts
> without maintaining parallel spreadsheets or systems.

------------------------------------------------------------------------

# 2. Core product philosophy

## 2.1 One system, one visible timeline

NOVA should feel like one system.

The user should not have to mentally maintain:

``` text
Attendance System
        +
Task Timer
        +
Timesheet
        +
Manual Correction Sheet
```

Instead, the primary employee experience is:

``` text
                 MY DAY

09:00 ┃ Attendance begins
      ┃
09:00 ┃ Task A ━━━━━━━━━━━
      ┃
11:00 ┃ Break
      ┃
11:20 ┃ Task B ━━━━━━━━━━━
      ┃
13:00 ┃ Lunch
      ┃
14:00 ┃ Task A ━━━━━━━━━━━━━
      ┃
17:30 ┃ Attendance ends
```

This is a **unified visual timeline**.

However, the underlying records still have clear ownership:

``` text
Attendance
    ↓
presence / availability

Work sessions
    ↓
productive time against assignments

Timeline adjustments
    ↓
audited correction of historical work-time records

Leave / holidays
    ↓
availability rules
```

The concepts are not collapsed into one database record merely because
they are displayed together.

## 2.2 Domain naming and context discipline

NOVA must use names that describe what a record actually means.
Generic names such as `Department`, `Project`, `Team`, `Category`, or
`Context` must not be reused for different concepts.

### Canonical concepts

-   **Organisation Department**: the functional department a person
    primarily belongs to inside the organisation.
-   **Client Workstream**: the functional area through which work is
    delivered for one specific client. Examples include Creative,
    Development, Marketing and Production.
-   **Organisation Workstream**: the functional area through which
    internal organisation work is organised.
-   **Group/Campaign**: an optional grouping of related work inside a
    workstream.
-   **Task**: an executable unit of work.
-   **Work Assignment**: the relationship between a person and a task.
-   **Work Session**: the actual productive-time record created from an
    assignment.

The word **Department** is reserved for organisation-level employee
membership. Client-specific work areas must be called **Client
Workstreams**.

### Person membership versus work context

A person has a primary organisation department, but their work is not
restricted to that department.

``` text
Person
  -> Primary Organisation Department
  -> Role / permissions
  -> Work Assignments

Client
  -> Client Workstream
     -> optional Group/Campaign
        -> Task
           -> Assignment
              -> Work Session

Organisation
  -> Organisation Workstream
     -> optional Group
        -> Task
           -> Assignment
              -> Work Session
```

A person may therefore belong primarily to Creative while performing
work for Development, Marketing and Production.

Changing a person's work assignment must never silently change their
primary organisation department.

### Explicit context rule

Every task must have exactly one unambiguous work context:

``` text
CLIENT WORK
  Client
  -> Client Workstream
  -> optional Group/Campaign
  -> Task

ORGANISATION WORK
  Organisation
  -> Organisation Workstream
  -> optional Group
  -> Task
```

A task context must not be guessed from the assignee's department, role,
task title, previous task, or free-form labels.

If required context is missing, task creation must request the minimum
missing information rather than silently guessing.

Assignments inherit the task's context. Work sessions inherit the
assignment/task context for reporting and timeline display.

### Context visibility

Whenever a record is shown outside its immediate creation form, enough
context must be visible to distinguish it from similarly named records.

For example:

``` text
Tata Motors / Creative
Vossé & Co / Creative
Organisation / Development
```

The UI must not rely on a bare `Creative` label when multiple Creative
records can exist.

### Naming rules

Every persistent domain entity must have:

1.  a stable technical identifier;
2.  a human-readable name;
3.  a defined entity type;
4.  a defined scope/parent where applicable.

Names are labels, not identifiers.

Duplicate names are valid when they exist in different scopes:

``` text
Tata Motors / Creative
Vossé & Co / Creative
```

These are different Client Workstream records.

A rename must not change the identity of an entity or silently rewrite
historical relationships.

If a record moves to another client/workstream, the move must be
explicit, permission-controlled and audited. Historical work sessions
retain the context under which they were recorded.

### No blind creation

Before introducing a new domain entity or terminology, implementation
must be able to answer:

-   What does it represent?
-   What is its parent?
-   What is its scope?
-   Which records can reference it?
-   What records inherit its context?
-   Is its name unique globally or only within a parent?
-   Can it be renamed?
-   Can it be archived?
-   What historical records must retain it?
-   What permissions govern creation and modification?

These answers belong in the canonical PRD/domain model rather than only
in the memory of one implementation session.

### Canonical glossary discipline

NOVA maintains one canonical vocabulary across database, API,
frontend, documentation and implementation sessions.

If terminology changes, record:

``` text
Old term
New term
Meaning
Scope
Reason
Migration impact
```

An implementation session must consult the current PRD/domain glossary
before introducing a new term or interpreting an existing ambiguous
term.

This is intentionally lightweight. NOVA does not need a large
knowledge management system. A maintained PRD, domain model and glossary
are enough to prevent sessions from going blind.

## 2.3 Attendance mode does not create a second timeline

NOVA supports two attendance modes:

1.  **Hour-based attendance**
    -   The organisation defines a required duration, for example 8
        hours.
    -   Attendance is evaluated primarily by actual duration.
    -   There is no fixed scheduled start or end unless the organisation
        is using scheduled attendance.
    -   NOVA must not invent lateness or early-departure states from
        an hour-only requirement.
2.  **Scheduled attendance**
    -   The organisation defines an expected start and end, for example
        09:00-18:30, with configured break rules.
    -   NOVA can derive schedule-relative states such as late arrival,
        early departure, scheduled end and after-hours time.

These are two configurations of the same attendance experience. They are
**not two different timelines**.

The employee must always see **one chronological Daily Work Timeline**
that combines attendance and task/work activity.

The task timeline and attendance timeline are therefore the **same
user-facing timeline**, regardless of which attendance mode the
organisation selects.

The selected attendance mode only changes how the attendance portion of
that timeline is interpreted.

### Scheduled attendance example

``` text
08:45 | Before scheduled start
09:00 | Scheduled start
09:17 | Checked in - Late by 17m
09:17 | Task A ----------------
11:20 | Task B ---------------
13:00 | Break
14:00 | Task B ---------------
18:30 | Scheduled end
18:42 | Checked out - After-hours 12m
```

### Hour-based attendance example

``` text
10:14 | Checked in
10:14 | Task A --------------
12:00 | Task B ------------
13:00 | Break
14:00 | Task B --------------
19:02 | Checked out
      | Attendance 8h48m, Required 8h
```

The UI surface remains the same:

``` text
                 DAILY WORK TIMELINE
                         |
          +--------------+--------------+
          |                             |
   Hour-based mode                Scheduled mode
          |                             |
   duration rules                 schedule rules
          |                             |
          +--------------+--------------+
                         |
                  task/work events
                         |
                  SAME TIMELINE UI
```

The underlying records remain separate sources of truth:

``` text
Attendance records
        +
Work sessions / accepted work blocks
        +
Breaks / leave / holidays / schedule context
        |
        v
One chronological timeline projection
```

This is an intentional separation:

-   Attendance remains the source of truth for presence/availability.
-   Work sessions remain the source of truth for productive task time.
-   Leave and holidays remain availability rules.
-   Schedule configuration provides schedule-relative interpretation
    when scheduled attendance is selected.
-   The Daily Work Timeline is a user-facing projection of those
    records.

A different role may see more fields, filters or administrative
controls, but it must not introduce a second source of truth or force
users to reconcile separate attendance and task timelines.

**Timeline correction also happens on this same timeline.** If a user
has permission to adjust their own historical work, an eligible
untracked gap is corrected directly from the gap shown in the Daily Work
Timeline. The correction does not move the user into a separate
timesheet workflow.

------------------------------------------------------------------------

# 3. One source of truth

Every important fact has one authoritative home.

  Fact                     Source of truth
  ------------------------ ----------------------------------------------
  Person identity          Person/member record
  Employment               Employment record
  Role                     Role assignment
  Permission               Role + permission configuration
  Operational capability   Role/person policy
  Office rules             Office configuration
  Presence                 Attendance
  Absence                  Leave
  Holiday                  Office calendar
  Executable work          Task
  Responsibility           Assignment
  Productive time          Work sessions / audited timeline work blocks
  Review history           Review records
  Payroll result           Locked payrun
  Calendar                 Read-only projection
  Analytics                Queries/projections over canonical records

Never create a second authoritative ledger just because another screen
needs different data.

------------------------------------------------------------------------

# 4. Attendance and productive work

## 4.1 Conceptual distinction

Attendance answers:

> Was this person present/available for the organisation during this
> period?

Productive work answers:

> What executable work did this person record time against?

These remain distinct concepts.

## 4.2 User experience

The employee should normally experience both through one **Daily Work
Timeline**, regardless of whether the organisation uses hour-based or
scheduled attendance.

There is no separate attendance timeline and task timeline in the
primary employee experience.

The timeline may contain:

-   attendance boundaries;
-   active task work;
-   completed work sessions;
-   breaks;
-   approved non-work blocks where supported;
-   unallocated time;
-   warnings;
-   correction opportunities.

Example:

``` text
09:00 ┃ ● Attendance
      ┃
09:00 ┃ ⚠ Untracked time
      ┃
09:30 ┃ Task A ━━━━━━━━━━━━━
      ┃
11:00 ┃ Break
      ┃
11:15 ┃ Task B ━━━━━━━━━
      ┃
13:00 ┃ Lunch
      ┃
14:00 ┃ Task A ━━━━━━━━━━━━━━━
      ┃
18:00 ┃ ● Attendance ends
```

This prevents users from having to compare separate screens to
understand their day.

------------------------------------------------------------------------

# 5. Timeline integrity and exceptions

The timeline exists partly because real people make mistakes.

Examples:

-   employee arrived early but forgot to start the task timer;
-   employee started the wrong task;
-   employee forgot to resume after a break;
-   employee stopped the timer too early;
-   attendance exists but work was not recorded;
-   work appears outside attendance;
-   two work segments overlap;
-   a role is allowed to work without attendance;
-   a holiday or leave decision changes the day's validity.

NOVA must make these conditions **visible**, not silently hide them.

## 5.1 Timeline states

A timeline segment may be:

-   Recorded
-   Untracked
-   Invalid
-   Needs correction
-   Corrected
-   Locked

The exact state model should be kept minimal and only expanded when a
real distinction is needed.

------------------------------------------------------------------------

# 6. Work Timeline Adjustment

## 6.1 Purpose

NOVA must support controlled correction of historical work time
without turning time records into freely editable numbers.

The core use case:

> A person worked during a period but forgot to start the task timer.

Example:

``` text
Attendance
09:00 ━━━━━━━━━━━━━━━━━━━━━━━━━ 18:00

Work
09:00 ┃ ⚠ Untracked
09:40 ┃ Task A ━━━━━━━━━━━━━━━
```

If the person has the appropriate capability, they can correct the
historical gap:

``` text
09:00 ┃ Task A ━━━━━━━━━━━━━━━━━
09:40 ┃ Task A continues
```

## 6.2 Permission-controlled UI

The employee does **not** automatically receive this UI.

Super Admin can grant a capability such as:

``` text
work.timeline_adjust_own
```

or an equivalent final permission name.

When the capability is active:

``` text
⚠ Untracked time
[ Adjust ]
```

appears on eligible historical segments.

When the capability is not active:

``` text
⚠ Untracked time
```

is visible, but the correction control is absent.

## 6.3 The employee performs the correction

The Super Admin grants authority.

The employee performs the correction themselves.

The system records:

-   who made the adjustment;
-   when it was made;
-   original state;
-   new state;
-   affected assignment;
-   affected time range;
-   reason;
-   permission used;
-   resulting timeline.

This avoids forcing an administrator to manually edit every employee's
timeline.

## 6.4 Adjustment constraints

Initial rules:

-   only past time may be adjusted;
-   future time cannot be created;
-   the user may only adjust their own timeline unless a separate
    administrative capability exists;
-   the adjustment must reference a valid assignment;
-   the assignment must have been valid for the relevant period;
-   overlapping work must be rejected;
-   the same time cannot be allocated twice;
-   an adjustment cannot silently overwrite existing timer-backed
    evidence;
-   adjustments must be auditable;
-   adjustment boundaries must respect the applicable business date;
-   adjustment rules must respect attendance requirements where the
    person's role requires attendance;
-   a correction should not silently change historical task ownership;
-   corrected segments should stop exposing the same correction action
    again unless a separately authorized reversal workflow exists.

## 6.5 Past only

The UI must not provide a generic draggable timeline extending into
future time.

Allowed:

``` text
09:00 ← adjust historical gap → 09:30
```

Not allowed:

``` text
18:00 → 19:00 future work
```

The backend must enforce this. The frontend hiding future controls is
not sufficient.

## 6.6 Audit example

``` text
Original:
09:40 → 11:20
Task A

Adjusted:
09:00 → 11:20
Task A

Actor:
Employee

Reason:
Forgot to start timer

Timestamp:
2026-09-17 18:42 Asia/Kolkata
```

The audit history remains available even though the timeline now
displays the corrected state.

------------------------------------------------------------------------

# 7. Time relationship rules

NOVA should not assume that:

``` text
Attendance time = Work time
```

Instead it should calculate and display relationships.

Example:

``` text
Attendance:        8h 30m
Productive work:   6h 45m
Untracked/non-work: 1h 45m
```

Possible exceptions:

``` text
WORK_WITHOUT_ATTENDANCE
WORK_OUTSIDE_ATTENDANCE
UNTRACKED_ATTENDANCE
OVERLAPPING_WORK
INVALID_TIMELINE
```

However, not every exception is an error.

For a role where attendance is not required:

``` text
Work: 6h
Attendance: none
```

can be completely valid.

The system therefore evaluates the relationship using the person's role
and operational policy.

------------------------------------------------------------------------

# 8. Ponytail engineering policy

The rebuild follows **Ponytail full mode**.

For every feature:

1.  Does this need to exist?
2.  Can existing code solve it?
3.  Can the standard library solve it?
4.  Can the native browser/database/platform solve it?
5.  Can an already-installed dependency solve it?
6.  Can the solution be made smaller?
7.  Only then add minimum custom code.

Ponytail does not remove:

-   security;
-   authorization;
-   validation;
-   accessibility;
-   transaction integrity;
-   concurrency protection;
-   audit;
-   correctness;
-   data-loss protection.

### 8.0.1 Implementation context ledger

Ponytail is also a discipline for preventing context loss between
implementation sessions.

Before a non-trivial domain change, consult the canonical PRD and
establish the relevant current model:

``` text
Term
Meaning
Parent/context
Known references
Allowed relationships
Permission implications
Historical-data implications
Open decision, if any
```

When a session discovers a new domain fact, relationship, naming
decision, or constraint that changes the model, update the canonical
PRD/domain documentation instead of leaving the knowledge only in chat
or code.

Do not rely on a previous session knowing what an ambiguous name means.

Do not create local synonyms for domain entities without recording the
canonical term.

When investigating an existing codebase, first map the existing names
and relationships before changing them. In particular, do not
mechanically rename `department_id` until each usage has been classified
as:

-   Organisation Department membership;
-   Client Workstream;
-   Organisation Workstream;
-   or another explicitly documented concept.

New domain facts and implementation decisions must be written back to
the canonical PRD before the session ends.

## 8.1 NOVA implementation rules

Do not introduce:

-   microservices at launch;
-   event bus at launch;
-   generic workflow engine;
-   generic CRUD framework;
-   repository/service/factory layers with one consumer;
-   giant permission framework before permissions are understood;
-   custom UI components when native controls work;
-   duplicated time calculations;
-   duplicate task systems;
-   speculative infrastructure;
-   features solely because they may be useful later.

Prefer deletion over addition.

## 8.2 Shortcut ceiling

When taking a deliberate shortcut, document:

``` text
ponytail: <shortcut>
ceiling: <known limitation>
upgrade: <measured trigger>
```

------------------------------------------------------------------------

# 9. Target organisations

Primary target:

-   15--50 employees.

Scalable target:

-   approximately 50--200 employees.

Typical characteristics:

-   multiple offices;
-   different timezones;
-   different departments;
-   client-facing work;
-   internal work;
-   employees and interns;
-   managers and reviewers;
-   different attendance requirements;
-   configurable calendars;
-   configurable leave;
-   payroll preparation.

Do not assume:

-   one office;
-   one timezone;
-   Sunday as the only holiday;
-   one monthly cycle;
-   everyone checks in;
-   everyone is payroll eligible;
-   every task has a due date;
-   every task has one assignee;
-   every client has the same departments.

------------------------------------------------------------------------

# 10. Core organisation model

``` text
ORGANISATION
│
├── CLIENT
│   │
│   ├── CLIENT DEPARTMENT
│   │   ├── GROUP / CAMPAIGN
│   │   │   ├── TASK
│   │   │   └── TASK
│   │   └── TASK
│   │
│   └── CLIENT DEPARTMENT
│       └── TASK
│
└── ORGANISATION WORK
    │
    ├── GROUP
    │   └── TASK
    │
    └── TASK
```

There is **no separate Project entity beneath Client**.

## 10.1 Organisation

The company/workspace operating NOVA.

Contains:

-   people;
-   offices;
-   organisation departments;
-   roles;
-   permissions;
-   clients;
-   organisation work;
-   policies;
-   payroll configuration;
-   audit history.

V1 assumes one user belongs to one organisation.

------------------------------------------------------------------------

# 11. Offices, calendars and timezones

An organisation can have multiple offices.

Each office has:

-   name;
-   location;
-   timezone;
-   attendance geofence reference coordinates;
-   attendance geofence radius;
-   working calendar;
-   shift configuration;
-   holiday rules;
-   attendance rules.

Example:

``` text
Kochi
Asia/Kolkata

Dubai
Asia/Dubai
```

Store authoritative timestamps in UTC.

Resolve:

-   office;
-   timezone;
-   local business date

at authoritative write boundaries.

Never allow browser formatting to decide the authoritative business
date.

### Office attendance geofence

An office may define an attendance geofence as a latitude/longitude reference
point plus a radius in metres. When office attendance is used, the server
must evaluate the submitted device location against the effective office
geofence. The browser may provide location and accuracy data, but it never
decides whether the check-in is valid.

The geofence is resolved from the person's effective office assignment for
the server-resolved business date. Different offices may therefore have
different coordinates, radii and timezones without creating separate
organisations or separate collaboration spaces.

The server must retain the minimum location evidence needed to explain the
attendance decision (verification result, measured distance and reported
accuracy). Exact location data must not be used as a general employee
tracking stream. WFH attendance is authorised by the approved WFH request
rule in §42.1 and does not silently reuse an office geofence as a home
geofence.

Location evidence is retained for a default 90-day dispute window, is visible
only through authorised attendance/audit access, and is then removed by the
portable PostgreSQL maintenance function
`nova.purge_expired_attendance_location_evidence`. Deployments may shorten the
window through an approved retention policy, but must not turn check-in
location into continuous tracking. Browser geolocation is a decision signal
and can be spoofed; high-assurance device attestation is not assumed by V1.

------------------------------------------------------------------------

# 12. Working calendars

Working calendars must be configurable.

Example:

``` text
Monday      Working
Tuesday     Working
Wednesday   Working
Thursday    Working
Friday      Working
Saturday    Conditional
Sunday      Holiday
```

Saturday patterns may include:

``` text
1st Saturday  Working
2nd Saturday Working
3rd Saturday Holiday
4th Saturday Holiday
5th Saturday Working
```

Different offices may have different calendars.

------------------------------------------------------------------------

# 13. Shifts

Initial shifts are simple fixed configurations.

Example:

``` text
Standard
Start: 09:30
End: 18:30
Break: 13:00–14:00
Expected: 8h
```

Possible configuration:

-   start;
-   end;
-   break policy;
-   grace;
-   overtime policy;
-   applicable working days.

Shifts may cross midnight when explicitly marked overnight. Their end is
resolved on the next local calendar date in the office timezone. Overnight
breaks are deferred in V1; daylight-saving transitions use PostgreSQL's
timezone rules and must not be calculated as a fixed 24-hour duration.

Do not build a universal workforce scheduling engine in V1.

------------------------------------------------------------------------

# 14. Holidays

Holidays belong to an office calendar.

They may be:

-   weekly;
-   Saturday-pattern based;
-   public;
-   organisation-specific;
-   office-specific.

## 14.1 Holiday transition

If HR changes a working day into a holiday after attendance has started:

1.  mark the date as a holiday;
2.  close affected open attendance according to policy;
3.  prevent further attendance;
4.  prevent new attendance-dependent work;
5.  preserve audit history;
6.  apply the explicitly defined policy for existing work sessions.

Never silently delete historical work.

The exact treatment of existing work sessions must be decided before
implementation.

------------------------------------------------------------------------

### Mid-day attendance mode changes

V1 uses one attendance state per person/business date. A person may move
between office and WFH during a business date only through an explicit
authorised mode change on that same attendance state, with a server
timestamp and audit record. V1 does not create two concurrent attendance
records for office + WFH. If organisational policy disallows mid-day
changes, the change is rejected.

Half-day leave is a leave-duration rule applied to the same
attendance/work timeline, not a second attendance ledger.

# 15. People

A person has:

-   identity;
-   account;
-   employment;
-   organisation department;
-   designation;
-   manager;
-   office;
-   role;
-   status;
-   work policies;
-   compensation configuration where applicable.

Minimum lifecycle:

``` text
Invited
Onboarding
Active
Notice
Offboarding
Frozen
Exited
```

Historical people records are retained.

------------------------------------------------------------------------

# 16. Roles and permissions

## 16.1 Super Admin

`super_admin` is the only protected system-level role.

Super Admin can:

-   create roles;
-   modify roles;
-   assign roles;
-   configure permissions;
-   manage organisation settings;
-   manage protected configuration;
-   administer the organisation.

Super Admin cannot be created, removed or delegated by ordinary
configurable roles.

The protected-role rule also applies to lifecycle commands: a configurable
role cannot freeze or offboard a person who currently holds the protected
`super_admin` role. A protected Super Admin may administer another protected
Super Admin; owner transfer remains the explicit path for changing the active
owner.

## 16.2 Custom roles

Roles can represent:

-   Admin;
-   HR;
-   Creative Lead;
-   Project Manager;
-   Designer;
-   Developer;
-   Intern;
-   Client Reviewer;
-   Finance;
-   any future organisation-specific role.

These are configuration, not fixed product enums.

### Optional role starter profiles

NOVA may offer editable starter profiles for common roles such as Employee,
HR, Supervisor, Admin and Client Coordinator. A profile is only a convenience
for filling the new-role form; it is not a database role, permission grant,
role assignment or authorization shortcut.

- Applying a profile copies a snapshot of its permission grants, scopes and
  operational-policy choices into the unsaved custom-role form.
- The Super Admin reviews and may edit the role key, name, every permission,
  scope, target and operational setting before saving. Target-specific grants
  never infer a department, office, client, workstream or group; the operator
  must choose the exact target.
- A permission or scope unavailable in the installed canonical permission
  catalogue is omitted and disclosed. A profile never widens a requested scope
  to make it fit.
- Saving uses the ordinary role command, current revision rules and permission
  delegation checks. A profile cannot grant a permission the actor is not
  authorized to delegate.
- Profiles are versioned product defaults, not live templates attached to
  roles. Editing a profile later does not change an existing role, its
  assignments, or a person's access. Selecting a profile while editing an
  existing role is not an implicit migration.

The optional Admin starter deliberately omits payroll administration, manual
authentication recovery, public-origin/deployment control, billable-task
authority and task-catalog management. Those high-impact grants require
deliberate configuration. Every starter remains editable and is not a
compliance recommendation.

## 16.3 Three dimensions of role configuration

A role defines:

### Access

What can be seen.

### Actions

What can be done.

### Collaboration orchestration

Collaboration is organisation-scoped and is orchestrated through explicit
work-context records, not through office membership:

``` text
Better Auth session
  -> authenticated NOVA person + organisation context
  -> API command
  -> permission grant + applicable scope
  -> client/workstream or organisation-workstream context
  -> task
  -> work assignment
  -> work session / review / timeline
  -> transaction + audit event
```

The employee's office, timezone and attendance geofence affect attendance
eligibility only. They do not silently remove the employee from organisation,
client or task collaboration. A task always carries its explicit client or
organisation workstream context; assignments inherit that context, and work
sessions retain it for reporting.

Every collaboration command is permission-checked at the API/domain boundary:

- `clients.view/create/edit` controls client records;
- workstream permissions control the applicable client or organisation
  workstream scope;
- `tasks.view/create/edit/assign/reassign/start/submit/review` controls task
  and assignment actions;
- `work.timeline.view` and timeline-adjustment permissions control timeline
  visibility and historical correction.

Visibility does not imply mutation. A person may see a task through a granted
scope without being allowed to edit, assign, start, submit or review it. Scope
is evaluated against the target work context and assignment, never guessed
from the actor's department or current office.

People visibility follows the same scope rule: `people.view` is evaluated per
target person, so organisation, office, department and own-record grants expose
only the matching records. Administrative settings and protected configuration
remain organisation-scoped commands.

For effective-dated office or department scopes on a person-targeted command,
the actor's role assignment is evaluated on the actor's current business date,
while the target's office/department membership is evaluated on that target
person's own office-local business date. This keeps permission decisions
consistent when collaborators are on different sides of local midnight.

### Role-management permissions

Role administration is itself permission-controlled and auditable:

- `roles.view` reads role and grant configuration;
- `roles.create` creates a custom role;
- `roles.edit` changes a custom role's grants and operational policy;
- `roles.assign` assigns an existing role to a person.

Only the protected Super Admin may manage protected configuration. A custom
role can be given any non-protected collaboration permissions by selecting
the permission and allowed scope; it cannot create, delegate, remove or
rewrite the protected Super Admin role. A delegated role manager may grant
only permissions it already holds at organisation scope; this prevents
`roles.create` or `roles.edit` from becoming a privilege-escalation path.

Role edits use optimistic revision checks: each role read includes its current
revision, and an edit must submit the revision it was based on. If another
administrator has already saved a newer revision, the stale edit returns a
conflict and applies none of its grants or operational-policy changes. The
administrator must reopen the latest role and deliberately reapply any desired
changes. A successful edit updates the role, grants, policy and audit record as
one transaction.

### Operational capabilities

How the person operates.

------------------------------------------------------------------------

# 17. Operational role policy

### Payroll-related configuration in V1

Payroll execution is deferred, but payroll-relevant role and policy
configuration is **not** deferred.

V1 may configure and preserve:

-   `payroll.applicable`;
-   `payroll.attendance_contributes`;
-   `payroll.overtime_applicable`;
-   `payroll.view`;
-   `payroll.manage`;
-   `payroll.lock`.

These describe intended payroll applicability and access. They do not
require a V1 payrun or payroll UI.

A person can therefore have payroll-relevant configuration from day one
even though the later Payroll module has not yet been implemented.

These values must be effective-dated/auditable where their historical
meaning matters. A future Payroll module must not reconstruct historical
payroll semantics from today's role or policy configuration.

Payroll permissions may exist before payruns exist. They become
operational when the Payroll module is enabled.

## Attendance

A role may define:

-   can check in/out;
-   attendance required;
-   WFH allowed;
-   can work without attendance;
-   can adjust own historical attendance if explicitly granted.

## Work

A role may define:

-   can receive assignments;
-   can start work;
-   can create tasks;
-   can assign;
-   can reassign;
-   can pause/resume;
-   can submit;
-   can review;
-   can adjust own historical work timeline if explicitly granted.

## Leave

-   request;
-   review;
-   modify approved leave.

## Payroll

-   payroll applicable;
-   attendance contributes;
-   overtime applicable;
-   view payroll;
-   manage payroll;
-   lock payroll.

## People

-   invite;
-   edit;
-   freeze;
-   offboard;
-   handover.

------------------------------------------------------------------------

# 18. Role combinations

These combinations must be valid:

``` text
Can work: YES
Check in/out: NO
Attendance required: NO
Payroll: NO
```

Or:

``` text
Can work: YES
Check in/out: YES
Attendance required: YES
Payroll: YES
```

Or:

``` text
Can review: YES
Can start work: NO
```

The permission model must not assume that all operational capabilities
always appear together.

------------------------------------------------------------------------

# 19. Permission model

Permissions are explicit.

Examples:

``` text
people.view
people.create
people.edit
people.freeze
people.offboard

clients.view
clients.create
clients.edit

tasks.view
tasks.create
tasks.edit
tasks.assign
tasks.reassign
tasks.start
tasks.submit
tasks.review
tasks.reviewer_request
tasks.handover_request
tasks.handover_accept

attendance.view
attendance.check_in
attendance.check_out
attendance.change_mode
attendance.recover

availability.wfh.request
availability.wfh.review
availability.office_geofence.manage

work.timeline.view
work.timeline_adjust_own
work.timeline_adjust_others

leave.request
leave.review

payroll.view
payroll.manage
payroll.lock
```

Final permissions must be derived from actual workflows.

## 19.1 Permission scopes

Potential scopes:

-   organisation;
-   office;
-   department;
-   client;
-   client department;
-   group;
-   own records;
-   assigned work.

Do not build arbitrary permission expressions initially.

------------------------------------------------------------------------

## 19.2 Permission scope and precedence

Permission scopes are additive for visibility unless an explicit deny or
immutable state applies.

For an action, the server evaluates:

``` text
permission
+ applicable scope
+ operational capability
+ target-state rule
+ policy
= allowed action
```

Precedence:

``` text
1. System safety / protected Super Admin rules
2. Explicit deny or locked/finalized state
3. Required action permission
4. Scope eligibility
5. Operational capability/policy
6. Person-level override, if explicitly permitted
```

A broader view permission never implies write permission. V1 does not
support arbitrary permission expression trees.

### Concrete examples

**Own records + department view-only**: a person may edit their own
permitted record, but may only view another person's record in the same
department.

**Broad edit + locked state**: a user with edit permission is still
rejected when the target payrun or record is locked/finalized.

**Assigned-work scope**: a reviewer may review assigned work, but cannot
modify unrelated work merely because they can view the surrounding
department or client.

These examples are implementation tests of the general precedence rule.

# 20. Work eligibility

Conceptually:

``` text
Active account
+
Role permits work
+
Valid assignment
+
Current policy permits work
+
Attendance requirement satisfied if applicable
=
Work eligible
```

If attendance is not required:

``` text
Attendance required = NO
→ attendance is not required for work eligibility
```

Never globally enforce:

``` text
No check-in = no work
```

------------------------------------------------------------------------

# 21. Person-level overrides

Roles define defaults.

A person may receive controlled overrides where genuinely necessary.

Example:

``` text
Role
 ↓
Default policy
 ↓
Person override
```

Overrides must be:

-   explicit;
-   narrow;
-   auditable.

Do not build a universal policy language.

------------------------------------------------------------------------

# 22. Clients

A Client is the project/workspace container.

Example:

``` text
Tata Motors
```

Inside:

``` text
Tata Motors
├── Creative
├── Development
├── Marketing
└── Production
```

There is no mandatory Project entity below Client.

------------------------------------------------------------------------

# 23. Client workstreams

Client departments belong to a specific client.

``` text
Tata Motors
└── Creative

Vossé & Co
└── Creative
```

These are different records.

Organisation departments are separate.

------------------------------------------------------------------------

# 24. Organisation work

Internal work is separate from client work.

Examples:

``` text
Organisation Work
├── HRMS
├── Hiring
├── Internal Marketing
├── Office Operations
└── R&D
```

An organisation task may optionally reference a client as a tag/context.

It remains organisation work.

------------------------------------------------------------------------

# 25. Groups / campaigns

Groups are optional.

Example:

``` text
Onam Campaign
├── Task A
├── Task B
└── Task C
```

A task can exist directly under a department without a group.

Do not force groups on every task.

------------------------------------------------------------------------

## 25.1 Multi-workstream people

Small organisations may have employees who perform work across several
functional areas.

NOVA must support this without forcing department changes.

Example:

``` text
Person: Anu
Primary Organisation Department: Creative

Work participation:
- Creative
- Development
- Marketing
- Production
```

The person's primary department answers:

> Where does this person primarily belong?

The task/work context answers:

> For which functional area and client/work context did this work
> happen?

These are different relationships.

Reporting must support both views independently, including work
distribution by workstream.

# 26. Tasks

Minimum fields:

-   title;
-   description;
-   client or organisation-work scope;
-   department;
-   optional group;
-   status;
-   priority;
-   optional due date;
-   creator;
-   assignments;
-   timestamps.

Due date is optional.

A task due date is a calendar `DATE`, not midnight UTC or a browser-local
timestamp. Preserve and display the date without converting it through a
JavaScript `Date`. Overdue state and per-person reminders use the assignee's
effective office business date; people in different office timezones may
therefore receive the same date's reminder at different UTC instants. A past
due date remains valid for backlog work. A permitted edit compares the due date
and revision the editor read, writes and audits atomically, expires old in-app
reminders, and cancels unsent email reminders. Current assignees receive an
in-app change notice; email is staged only when their email preference is on.
The reminder tick locks candidate tasks and reminder keys include the due-date
revision, so a concurrent edit cannot make an obsolete due date look current
or prevent a later return to an earlier date from receiving a fresh reminder.
The worker checks its lease immediately before sending; as with any SMTP
system, a message already in flight cannot be recalled.

Migration 0066 and the task API implement this edit path. Only a current
`tasks.edit` grant at the task's scope can change the date; the write compares
`due_date` and `due_date_revision`, rejects stale revisions and terminal tasks,
and returns a conflict rather than silently overwriting another editor. The
read models expose the revision and whether the current actor may edit; the
server remains authoritative. Local PostgreSQL/API coverage includes a
locked-task scheduler overlap, stale and invalid dates, no-op edits, role grant
changes, reminder/outbox invalidation, audit, and notification behavior.

### Task classification, correction tasks and reusable task definitions

Every task has exactly one billing class: `billable` or `non_billable`.
Correction is a work-purpose/link, not a third class or a billing subtype.
NOVA must assign the class automatically from an authoritative, versioned
backend billing policy. Neither task creators nor reusable-task-definition
authors may choose or override a task's class. There is no billing-class field
in the task-creation UI/API, catalog-entry UI/API, or catalog proposal UI/API.
The resolved class may be shown read-only on task details and work records so
people can understand the result; that display is not a selector or an
authorization grant. Only an actor with the dedicated policy permission can
change the backend policy through its administrative control.

The classifier uses explicit work context and never guesses from task text,
creator role, reviewer outcome, timer, correction link, catalog definition, or
client name. Organisation-workstream tasks are always automatically
`non_billable`. Each client workstream has an administrative default, required
before task creation. One-off tasks use that default. When a task uses an active
reusable definition, NOVA applies that definition's optional workstream-specific
rule; when no rule is set, it uses the same workstream default. Thus one
reusable definition may be billable in one client workstream and non-billable
or inherited in another, without making the employee choose a class.

An actor with the separately grantable `workstreams.billing_policy.manage`
permission sets the workstream default and may set or reset the classification
rule for each predefined task in that workstream. Setting a rule to inherit
uses the current workstream default. These are restricted administrative
controls with a required reason, optimistic revision, and audit event. The
default applies to one-off tasks; a definition rule applies only when that
definition is selected in that workstream. A definition's content revision and
its separate billing-rule revision are independent: editing its title,
description, or priority cannot silently change its classification. The same
definition ID receives distinct rules by workstream, so different client
agreements do not leak into one another.

Neither task creators nor reusable-task authors/reviewers select, set, or
override a class. Task-creation and catalog-entry/proposal APIs reject billing
class input. Catalog create/manage/propose/review permissions govern reusable
content only; they do not grant `workstreams.billing_policy.manage`. The
definition-rule control additionally requires catalog visibility so the
authorized policy manager can identify the definition being configured.
Task screens show the resulting class and provenance read-only. NOVA does not
infer billability from a task title or description. A workstream default is
still available for free-form tasks and for definitions explicitly set to
inherit.

A client workstream starts without a default and fails closed for task creation
until an authorized administrator sets one. Existing client workstreams remain
unconfigured after upgrade and must be reviewed/configured before creating new
tasks. Existing tasks keep their prior class as `legacy_snapshot` provenance.
Task groups inherit the classification rule of their parent workstream and
selected task definition. Changing the default affects future one-off tasks and
future definitions set to inherit; changing one definition rule affects only
future tasks created from that definition in that workstream. Neither edit
changes existing task or work-session snapshots. Different billability within
one client engagement may be represented through separate workstreams or
authorized per-definition rules; NOVA never infers it from task text.

If the classifier returns `billable`, the actor must independently have the
existing `tasks.create.billable` capability in addition to ordinary scoped
`tasks.create`. Catalog management or proposal/review authority does not grant
billable task-creation authority. `tasks.catalog.manage` and
`tasks.catalog.propose` govern reusable content only; task catalog entries
contain title, description, priority and revision, not billing class. A
separate workstream rule stores classification policy and provenance. Catalog
content updates affect only later task content defaults; they do not alter a
rule or any existing task. The existing role system remains the place where
these capabilities and scopes are assigned.

The classifier and task write run atomically against one policy revision. NOVA
stores the class, source, and applicable default or definition-rule revision
on the task. Policy edits use expected revisions, require an audit reason, and
affect future tasks only. They never rewrite existing tasks or work-session
snapshots. Every work session retains an immutable snapshot of its task's
class. Default and definition-rule edits lock the PostgreSQL workstream row
against task creation, producing one coherent class/source/revision pair.
Migration 0074 restores the latest active per-definition rules and
reset-to-inherit revisions from migration 0073's audit evidence; it does not
rewrite any existing task or session snapshot. The class is a work
classification, not a rate, invoice,
payment, payroll, or proof that a client was charged. Any future billing or
payroll module must consume the immutable work/session evidence through its
own rules and must not reinterpret historical policy edits. Any historical
reclassification is a separately authorized, audited amendment; it is never
represented as a correction task.

A correction task is a separate work item linked to an already-approved or
completed original so the required repair/correction work can be assigned,
reviewed, timed and audited. It is not a billing category, a billing
adjustment, or an edit/reopen of the original. An unfinished task uses the
existing `Changes Requested`/resubmission path instead. The correction
link/reason never selects, overrides, or copies the source task's class. A
correction is classified like any new task: its own selected predefined-task
rule in that workstream applies when present; otherwise it uses the one-off
workstream default. It has no correction-only class, billability toggle, or
permission. A correction can therefore differ from its source without
changing or inheriting the source's classification. Both snapshots remain
immutable and the relationship must remain visible in reports. The correction
link itself never changes the class: NOVA applies the ordinary automatic
classifier to the new correction task, while the source task keeps its
historical class and work evidence.

The correction task has its own assignment, reviewer, due date, timers, review
cycles, work history, audit events, and class snapshot. Creating it never
changes the original's status, assignments, timers, submissions, decisions,
class, or evidence. An unfinished task remains in the existing `Changes
Requested`/resubmission flow; a correction task is for additional work against
already-approved/done work. Correction links must be visible and auditable;
multiple legitimate correction tasks may link to one original, but exact
retries must not duplicate one. A correction cannot target another correction,
an incomplete task, a task in another organisation/workstream, or a source the
actor cannot view. A missing source and a source outside the actor's view return
the same not-found response so correction creation cannot enumerate hidden
tasks. Normal task-creation scope and billable-task authorization are checked
independently. Reports may group linked corrections for context,
but keep assignments, sessions, classes, and totals distinct and state whether
correction work is included.

The predefined-task catalog remains a reusable-default mechanism with
permission-controlled proposals/review. `tasks.catalog.manage` creates, edits
and archives definitions; `tasks.catalog.propose` suggests content changes;
`tasks.catalog.review` approves or rejects them, and a proposer cannot approve
their own proposal. These workflow permissions do not classify work. Catalog
definitions may fill ordinary task defaults but cannot carry or imply billable
status. Only `workstreams.billing_policy.manage` can configure a client
workstream default or its per-definition rules; catalog create/propose/review
permissions alone do not grant that capability. NOVA resolves the active
workstream and selected definition rule on the server, then stores a
class/source/revision snapshot. Catalog visibility is not authorization to
create billable work.

Migrations 0071–0074 implement the V1 policy: task catalog entries/proposals
do not store a class; task and definition API inputs reject class selection;
PostgreSQL applies the default or authorized per-definition rule on task
insert; a missing client default blocks creation; the API checks the
independent `tasks.create.billable` permission; and task/session snapshots
remain immutable. The admin UI manages defaults and per-definition rules with
revision and reason, while task screens show the resulting class and
provenance read-only. Migration 0073 recorded previous active definition rules
and reset-to-inherit state; migration 0074 restores the latest state from that
audit evidence and preserves all task/session snapshots. Local PostgreSQL/API smoke covers
missing-policy no-partial-write, role denial, policy edits and stale conflicts,
concurrent policy-edit/task-create snapshots, catalog/task class injection,
historical snapshots, correction classification, and role authorization. This
local proof does not by itself prove a hosted-provider migration or deployment.
This classification metadata does not add invoice rates, invoice generation,
payroll calculation, or a billing-correction pseudo-class.

Reviewer is explicitly selected **per assignment**, not per Task; see
§27.

Do not infer reviewer from manager, creator or department head.

A task may have multiple assignees. Task-level approval is an aggregate
projection of assignment-level review outcomes; it must not replace the
assignment-level approval records.

### Task approval aggregation

The authoritative approval decision is made on each assignment. The Task
may expose an aggregate approval state for operational visibility.

For V1:

-   a task is **Approved** only when every active assignment that
    requires review has reached Approved;
-   one approved assignment never approves another assignment;
-   assignments that are Cancelled do not block task approval, but their
    cancellation and prior history remain visible;
-   a task with no assignments requiring approval cannot be treated as
    Approved merely because it has no pending reviews. Organisation
    assignments that explicitly use the no-review policy resolve with
    `resolution_source = policy` and contribute to the task's **Done**
    aggregate only after submission;
-   if any active assignment is Awaiting Review, the task is not
    Approved;
-   if any active assignment has Changes Requested, the task is not
    Approved;
-   if any active assignment is still working, the task is not Approved;
-   task approval must be derived from current assignment states and
    must not be independently edited into contradiction with them.

The exact presentation of aggregate task state may remain a UI concern,
but the underlying rule is authoritative and must be enforced at the
appropriate domain boundary.

------------------------------------------------------------------------

# 27. Assignments

A task can have multiple assignees.

Each assignment is an independent unit of responsibility, productive
work history, submission history and review history.

``` text
Task A

Person 1
-> Assignment
-> Work sessions
-> Submissions
-> Review cycles

Person 2
-> Assignment
-> Work sessions
-> Submissions
-> Review cycles
```

### Assignment reviewer

The reviewer belongs to the **assignment**, not the task.

This is the authoritative V1 rule because different assignees can
require different reviewers even when they work on the same task.

``` text
Task
├── Assignment A
│   └── Reviewer A
│
└── Assignment B
    └── Reviewer B
```

A task may optionally have a **default reviewer suggestion**, but that
is only a convenience for creating assignments. It is not the
authoritative reviewer and must not control review routing after the
assignment exists.

The assignment stores the current reviewer. Each review cycle stores a
snapshot of the reviewer who made that review decision.

Reviewer changes apply only to the relevant assignment and future review
action. They do not rewrite completed review history.

### Assignment integrity

An assignment must have:

-   a valid task;
-   a person;
-   a defined work context inherited from the task;
-   a reviewer before submission when `review_required` is true, unless an
    explicit reviewer exception is approved; organisation work may use the
    explicit no-review policy;
-   an auditable lifecycle.

One person's approval never approves another person's assignment.

### Reviewer exception persistence

A Super Admin reviewer exception remains the reviewer for that
assignment until an authorised actor explicitly changes the assignment
reviewer. The system does not automatically replace an exception
reviewer merely because an eligible reviewer becomes available later. A
later change is a new audited assignment-level decision.

------------------------------------------------------------------------

# 28. Task lifecycle

Initial states:

``` text
Backlog
Ready
In Progress
Submitted
Approved
Done
Blocked
Returned
Cancelled
```

Do not add states without a real business distinction.

Task lifecycle state and assignment approval state are related but not
identical. Multiple assignments can be at different lifecycle/review
states at the same time.

For V1, task-level **Approved** is an aggregate condition, not an
independent approval action.

------------------------------------------------------------------------

# 29. Assignment and review lifecycle

Typical:

``` text
Assigned
   ↓
In Progress
   ↓
Submitted
   ↓
Awaiting Review
   ↓
Approved
```

Returned:

``` text
Awaiting Review
   ↓
Changes Requested
   ↓
In Progress
   ↓
Submitted
```

Every submission creates a review cycle when review is required. Every
review decision belongs to exactly one review cycle.

A review cycle records the submission being reviewed and the eventual
review decision. A return never overwrites the previous cycle; the next
submission creates the next cycle.

### Review cycle timing

Each review cycle must preserve enough timestamps to distinguish work
time from review/approval elapsed time. At minimum, the cycle should
record:

-   submitted_at;
-   decision_at, when a decision is made;
-   reviewer snapshot at the time of the decision;
-   decision;
-   feedback/reason where applicable;
-   cycle number.

For V1, **review wait time / approval elapsed time** is:

``` text
approval_elapsed_time = decision_at - submitted_at
```

For a Changes Requested decision, the same interval is the elapsed time
for that review cycle. It is not productive work time for the assignee.

NOVA must not infer reviewer processing time from UI page-open events.
If a future requirement introduces an explicit `start review` action,
that action may provide a separate reviewer-processing duration, but V1
does not need a second timer merely to report approval elapsed time.

The system must preserve the distinction between:

``` text
Assignee productive work
        ≠
Time waiting for review
        ≠
Reviewer processing time
```

### Multiple assignees

Each assignee progresses independently through their own assignment and
review cycles.

Example:

``` text
Task A
├── Aman
│   └── Approved
├── Alex
│   └── Approved
└── Neha
    └── Changes Requested
```

The task is not Approved because Neha's active assignment is unresolved.
Aman and Alex do not need to be resubmitted merely because Neha requires
changes.

If an assignment is approved, that approval remains approved unless an
authorised action explicitly reopens or otherwise changes that
assignment according to a defined state transition. Another assignment's
return does not silently reopen it.

### Concurrent assignment review

Assignments on the same task may be submitted and reviewed concurrently.
There is no task-level review lock that serialises independent
assignments.

A review decision must atomically validate that:

-   the review cycle is still open;
-   the reviewer is still authorised to perform the decision;
-   the decision has not already been recorded;
-   the assignment is still in the expected review state.

Two concurrent decisions against the same review cycle must produce one
authoritative outcome. The losing request must receive a deterministic
state/conflict response and must not create a second decision.

### Review waiting and overdue handling

An assignment may remain Awaiting Review for an extended period. Time
waiting for review does not automatically change the assignment to
Approved, Returned or Cancelled.

If NOVA later supports review SLAs, an overdue indicator may be
derived from policy and timestamps. An overdue review must never
auto-approve the assignment merely because the SLA expired.

The underlying timestamps must remain valid even when no SLA is
configured.

### Reviewer changes during review

Changing the assignment reviewer does not rewrite completed review
history.

If the reviewer changes while an assignment is Awaiting Review, the new
reviewer becomes authoritative for the open review cycle, subject to
normal write-time eligibility checks.

If a future implementation introduces an explicit active review state,
changing the reviewer while that active review is in progress must close
the old review attempt and create a new review attempt for the new
reviewer rather than attributing one decision to two reviewers.

V1 does not require an explicit `start review` state or timer.

### Reviewer becomes unavailable

If the current reviewer becomes inactive, frozen, exited or otherwise
ineligible before a decision is made:

-   completed review history remains unchanged;
-   the open assignment remains unapproved;
-   NOVA must not silently self-approve or select an arbitrary
    replacement;
-   an authorised actor may explicitly change the assignment reviewer or
    grant the documented reviewer exception;
-   the change is audited.

### Assignment cancellation during review

If an assignment is cancelled while Awaiting Review, its open review no
longer accepts a normal approval/return decision after the cancellation
becomes effective.

Any prior submissions/review cycles remain historical records. A running
work session is closed through the same canonical server-authoritative
cancellation/session-closure operation defined in the work-session
rules.

Cancellation does not turn a historical approved decision into a
successful approval of the cancelled assignment.

### Task cancellation with multiple assignments

Cancelling a task must resolve its active assignments through the
canonical cancellation operation rather than silently deleting them.

Previously completed review decisions remain historical. Active
assignments stop accepting normal work/review transitions after the
cancellation becomes effective.

### Reassignment after approval

Reassignment creates a new assignment. It never transfers the previous
assignee's work, submission or approval history to the new person.

Example:

``` text
Aman assignment
└── Approved

Aman removed

Alex assignment
└── New assignment
```

Alex must follow the new assignment's own lifecycle and review cycle.

### Assignment-level submission is the review boundary

A submission belongs to exactly one assignment and one review cycle. A
task-level "submit all" operation, if ever introduced, is only a
convenience that submits eligible assignments individually through the
same canonical submission rule; it must not create one shared review
record for multiple assignees.

------------------------------------------------------------------------

# 30. Reviewers

Review is evaluated per assignment.

The default rule is:

-   reviewer must have the required review permission;
-   reviewer must be eligible for the assignment's work scope;
-   reviewer cannot be the assignee;
-   reviewer must be active and able to perform the review;
-   reviewer selection and changes are auditable.

The reviewer must be revalidated at the time of the review mutation.
Opening a review queue or viewing an assignment does not reserve
approval authority.

### Review decision rules

A review decision is one of the explicit V1 outcomes:

``` text
Approved
Changes Requested
```

`Changes Requested` returns the assignment to work/submission flow. It
must preserve the submitted work and the completed review cycle.

V1 does not use a reviewer decision to mean that the entire Task is
approved. Task approval is derived from assignment outcomes under §26.

A reviewer cannot approve an assignment that is no longer in a
reviewable state, including after cancellation, completed prior
decision, or other state transition that removes review eligibility.

### Approval timing and historical integrity

Approval timestamps are server-authoritative. The client cannot supply
an arbitrary `decision_at` value through the normal review API.

The audit/history must preserve at least:

-   assignment;
-   review cycle;
-   submitted timestamp;
-   decision timestamp;
-   reviewer snapshot;
-   decision;
-   feedback/reason where applicable;
-   actor performing the decision.

A later reviewer change, reassignment, role change, department transfer,
archive or rename must not rewrite historical review records.

### No eligible reviewer

### Exception audit requirements

A reviewer exception must explain why the normal reviewer path could not
be satisfied.

The audit record must capture:

-   assignment;
-   person being reviewed;
-   actor granting the exception;
-   selected exception reviewer;
-   timestamp;
-   failed reviewer eligibility condition or missing capability/scope;
-   why no eligible reviewer was available;
-   mandatory reason supplied by the Super Admin;
-   resulting reviewer assignment.

The reason is mandatory. An empty or generic "No reviewer" reason is not
sufficient.

NOVA must not block a valid submission indefinitely merely because a
small organisation has no eligible reviewer.

If no eligible reviewer exists:

1.  submission may still be created as **Awaiting Review**;
2.  the assignment is marked **Review Blocked: No Eligible Reviewer**;
3.  the system identifies the missing reviewer capability/scope;
4.  an authorised Super Admin can assign an exception reviewer;
5.  the exception is explicitly audited with actor, reason and reviewer;
6.  **self-review is never allowed in V1**, even as an exception.

The open review cycle may therefore have a null reviewer until the authorised
reviewer or exception is selected. The assignment retains an explicit
`NO_ELIGIBLE_REVIEWER` blocked marker and timestamp; it must not appear in the
normal reviewer queue while blocked. Selecting a reviewer updates only the
open cycle snapshot. Decided cycles remain immutable, and completed or
cancelled assignments cannot have their reviewer rewritten.

The exception reviewer may be outside the normal scope only when the
Super Admin explicitly authorises the exception.

A task must not silently fall back to its creator, manager or department
head.

The exception reviewer remains the reviewer for that assignment until an
authorised actor explicitly changes the assignment reviewer. A later
eligible reviewer does not automatically replace an existing exception
reviewer.

### Reviewer requests and unavailable reviewers

An assignee may request an initial reviewer or a replacement reviewer when
the assignment is still active. The candidate must be operational and have
the effective `tasks.review` permission for the assignment's client,
workstream, group or organisation scope. The candidate explicitly accepts or
declines; self-review is never allowed. Only one pending reviewer request is
allowed per assignment. Expiry is processed by the canonical background tick,
removes request-based task visibility, notifies the requester, and is audited;
an expired row must never continue to behave as pending.

If a selected reviewer becomes ineligible before review, NOVA clears the
current reviewer, marks the assignment `REVIEWER_UNAVAILABLE`, leaves the
open cycle awaiting review, and requires an explicit replacement or approved
exception. It never self-approves or silently picks a reviewer.

### Self-assignment and assignment handover

Task creation may atomically create the creator's assignment. Client work
always keeps the review-required policy; organisation work may complete under
the explicit no-review policy. An assignee may request a handover to another
operational person with assignment capability. The target explicitly accepts
or declines. Acceptance closes the old person's running sessions at one
server timestamp, cancels the old assignment, creates a new assignment, and
preserves all historical ownership and review records. Handover requests are
single-pending, auditable and permission-controlled (`tasks.handover_request`
and `tasks.handover_accept`).

# 31. Work sessions

A work session is an authoritative recorded productive-time segment.

``` text
started_at
ended_at
assignment
actor
state
```

A running session is always attached to a valid assignment.

### Lifecycle race rules

### Server-authoritative effective timestamps

Automatic lifecycle closures are system-generated state transitions, not
user timeline adjustments.

When a freeze, offboarding, cancellation or other administrative state
change closes a running session:

-   the effective timestamp is generated or validated by the server;
-   the client cannot supply an arbitrary historical timestamp to close
    the session;
-   the server records the actor, action, effective timestamp and
    reason;
-   the recorded end time is capped at the applicable office-local business
    boundary, even if the administrative action is performed later;
-   normal APIs do not permit backdating an automatic closure;
-   an authorised historical correction is a separate explicit audited
    adjustment governed by the correction rules;
-   a genuine historical correction cannot masquerade as an automatic
    lifecycle closure.

The resulting closure timestamp is authoritative for the timeline.

Freeze, offboarding, task/assignment cancellation and other lifecycle
paths must use the same canonical session-closure operation. Callers
must not independently calculate or accept a closure timestamp.

Task cancellation and reassignment use the canonical PostgreSQL
assignment-scoped closure operation; user pause/stop remains a separate
explicit session command.

NOVA must handle administrative state changes atomically.

If an account is frozen or offboarded while a work session is running:

-   the session is automatically closed at the effective policy-change
    timestamp;
-   the closure reason is recorded, such as `ACCOUNT_FROZEN` or
    `OFFBOARDING`;
-   already recorded time is preserved;
-   no new work can start after the effective timestamp;
-   the session is never silently deleted or reassigned to another
    person.

If a task or assignment is cancelled while a session is running:

-   the session is closed at the cancellation effective timestamp;
-   recorded productive time remains attached to the original
    assignment;
-   the cancellation does not rewrite historical ownership;
-   future work requires a new valid assignment.

If an assignment is reassigned:

-   existing sessions remain owned by the original person and
    assignment;
-   the new person receives a new assignment;
-   no historical session is transferred.

Attendance-required policy adds one further interlock: checking out closes
the person's running productive session at the same server-authoritative
timestamp. Starting work is rejected on an approved leave date, and leave
approval is rejected while a current-day productive session is running. These
rules apply in both hour-based and scheduled attendance modes; the mode only
changes attendance interpretation, not assignment/session ownership.

All of these transitions must be transactionally safe against concurrent
timer requests.

### Permission timing

Permissions and policy are authoritative at **write time**.

A permission cached in an already-open browser session does not grant
authority after that permission has been revoked.

The backend must re-authorise every sensitive mutation, including:

-   starting/pausing/resuming work;
-   timeline adjustments;
-   attendance recovery;
-   assignment/reviewer changes;
-   payroll actions.

A stale UI may display an action that the server then rejects. That is
acceptable. A stale permission must never permit the mutation.

# 32. Work timer

Start requires:

-   active person;
-   valid assignment;
-   work permission;
-   work eligibility;
-   valid attendance if required;
-   no conflicting running session;
-   task state permitting work.

The operation must be atomic.

Pause ends the current session.

Resume creates a new session.

Do not unnecessarily mutate completed historical sessions.

Example:

``` text
Task A

Session 1
09:30 → 11:00

Session 2
14:00 → 16:30
```

Productive time:

``` text
4h
```

------------------------------------------------------------------------

### 33.0.1 Context shown on the unified timeline

When work is shown on the Daily Work Timeline, its work context should
be available without requiring the user to open every task.

Example:

``` text
09:17  Tata Motors / Creative
       Onam storyboard

11:20  Organisation / Development
       Fix attendance API

14:00  Vossé & Co / Marketing
       Campaign analytics
```

This is especially important for people who work across multiple
workstreams during one day.

# 33. Unified Daily Work Timeline

This is a primary NOVA experience.

The timeline composes authoritative records into one chronological view.

Example:

``` text
09:00 ┃ Attendance START
      ┃
09:00 ┃ ⚠ Untracked
      ┃
09:30 ┃ Task A ━━━━━━━━━━━━━
      ┃
11:00 ┃ Break
      ┃
11:15 ┃ Task B ━━━━━━━━━━━
      ┃
13:00 ┃ Lunch
      ┃
14:00 ┃ Task A ━━━━━━━━━━━━━━━
      ┃
17:30 ┃ ⚠ Untracked
      ┃
18:00 ┃ Attendance END
```

The timeline should answer:

-   when the person was present;
-   what they worked on;
-   what time is recorded;
-   where gaps exist;
-   whether a gap is actionable;
-   whether the day contains a rule violation;
-   whether correction is permitted.

The timeline is a **projection**, not a replacement for the underlying
records.

------------------------------------------------------------------------

# 34. Timeline correction workflow

Example:

``` text
09:00 Attendance
09:00–09:40 Untracked
09:40–11:20 Task A
```

If `work.timeline_adjust_own` is granted:

``` text
09:00–09:40 Untracked
[ Adjust ]
```

The user chooses:

``` text
Assignment: Task A
Start: 09:00
End: 09:40
Reason: Forgot to start timer
```

Backend validates.

If accepted:

``` text
09:00–11:20 Task A
```

The correction action disappears for that same corrected gap.

Audit remains.

------------------------------------------------------------------------

# 35. Correction safety

The backend must reject:

-   future adjustments;
-   overlapping adjustments;
-   invalid assignments;
-   assignments outside the user's permitted scope;
-   adjustments after a lock/finalization boundary;
-   adjustments that violate attendance-required rules;
-   adjustments against frozen/exited users;
-   attempts to impersonate another user;
-   client-supplied organisation or permission claims.

If the product later needs reversal, implement an explicit audited
reversal rather than allowing silent mutation.

------------------------------------------------------------------------

# 36. Midnight and business-day boundary

Open work sessions must not silently cross business dates.

At the configured business-day boundary:

``` text
Open session
    ↓
System closes/pauses session
    ↓
Recorded time preserved
    ↓
Assignment remains active
    ↓
User can resume later
```

The user does not need to manually clock out because midnight occurred.

The same principle applies to office-local business dates.

------------------------------------------------------------------------

# 37. Multi-day work

A task can remain active across days.

Example:

``` text
Monday
09:00–12:00

Tuesday
10:00–13:00

Thursday
15:00–17:00
```

The assignment remains the same.

Productive time is the sum of valid completed sessions/accepted
historical work blocks.

------------------------------------------------------------------------

# 38. Time calculations

Do not calculate productive time as:

``` text
clock-out - clock-in
```

Instead:

``` text
productive time =
sum(valid productive work segments)
```

Attendance duration is separately available.

The UI may show them together.

Example:

``` text
Today

Attendance      8h 30m
Productive      6h 45m
Untracked       0h 30m
Break/non-work  1h 15m
```

Exact displayed categories should be derived from the final timeline
model.

------------------------------------------------------------------------

# 39. Overtime

Overtime is policy-driven.

Potential inputs:

-   expected shift;
-   attendance duration;
-   productive work;
-   approved overtime rules.

Do not assume every extra hour is overtime.

Do not build a jurisdiction-universal overtime engine in V1.

------------------------------------------------------------------------

# 40. Department monthly cycles

Departments can have different monthly cycles.

Example:

``` text
Creative
26th → 25th

Development
1st → last day
```

NOVA distinguishes:

-   calendar month;
-   department work cycle;
-   business date.

Tasks can be associated with the applicable department cycle.

Do not silently move tasks between cycles.

------------------------------------------------------------------------

# 41. Leave

Leave statuses:

``` text
Requested
Pending
Approved
Rejected
Cancelled
```

A leave request contains:

-   person;
-   leave type;
-   start date;
-   end date;
-   reason where required;
-   reviewer;
-   decision;
-   decision timestamp.

Approved leave affects attendance eligibility.

If leave is approved after attendance/work exists, apply explicit
recovery rules.

Do not silently rewrite history.

Once attendance exists on any requested leave date, the requester cannot
self-cancel that leave record. Historical facts remain authoritative and any
correction follows the explicit recovery/exception path.

V1 recovery is explicit: the normal approval command leaves the request
Pending and creates a Historical Exception when attendance already exists. An
authorised actor with both leave-review and attendance-recovery capability
must then choose one of two outcomes, with a required note:

-   approve the leave while preserving the attendance record;
-   reject the leave while preserving the attendance record.

Both outcomes resolve the exception and write an audit record. Neither outcome
deletes, rewrites or silently closes the original attendance fact.

------------------------------------------------------------------------

### 41.1 Leave granularity

V1 supports full-day and half-day leave. Leave is represented per
business date, allowing a request such as Monday 1.0 day, Tuesday 0.5
day, Wednesday 1.0 day. Arbitrary hourly leave is deferred.

Leave remains part of the same availability model as attendance, WFH and
calendar rules. Approval or later changes do not silently delete
historical attendance or work.

Leave and approved WFH are mutually exclusive for a business date. A WFH
request cannot be approved when approved leave covers any requested date, and
a leave request cannot be approved when an approved WFH request covers any of
its days. The conflict is returned as an actionable domain error; neither
record is silently cancelled. An already-approved WFH request is grandfathered
for its dates if a later policy change removes eligibility, while new requests
and pending approvals use the effective policy at command time.

Availability commands serialize the person/business-date decision boundary with
the same PostgreSQL transaction advisory key used by the leave-overlap guard.
Leave approval, WFH approval/cancellation, and attendance check-in, checkout or
mode change therefore cannot pass each other's conflict checks concurrently.

# 42. WFH

WFH is an attendance mode/policy, not a separate attendance ledger.

Eligibility can depend on:

``` text
Role policy
+
Office/department rule
+
Person override
=
WFH eligibility
```

The V1 resolution order is deterministic and most-specific-wins:

1. person override;
2. current Organisation Department override;
3. current Office override;
4. effective role operational policy.

Each override is effective-dated, auditable, organisation-scoped and may
explicitly allow or deny WFH. If no override applies, the role policy is the
fallback. Overlapping overrides for the same target and effective period are
rejected. A WFH override changes eligibility only; it does not create a
second attendance ledger or silently change an existing attendance state.

The eligibility policy is not itself approval. A person may request WFH only
when the effective policy permits it, and an authorised reviewer must approve
the requested business dates before WFH attendance can start. The reviewer
is selected by permission and scope, not by a hard-coded HR role name.

### 42.1 WFH requests and approval

WFH requests are date-range records with a reason, status, reviewer and
decision audit. V1 statuses are Pending, Approved, Rejected and Cancelled.

Normal employee-created requests cannot be backdated. Past attendance or WFH
facts use the explicit historical-recovery path. A pending request may have
provisional evidence for that same request; it is not a conflicting attendance
fact and becomes creditable only after approval. Approval must still reject or
surface conflicting office attendance, approved leave or another attendance
fact through the explicit conflict/exception flow.

A pending WFH decision must not erase or prevent genuine task work. A person
may record task work while a permitted WFH request is pending. If their role
normally requires attendance, starting a timer still requires an open
provisional WFH attendance interval linked to that same pending request; this
is the narrow way to satisfy the existing attendance-required gate, not a
general attendance bypass. Provisional evidence is not present/approved
attendance and does not contribute to attendance compliance or payroll while
pending. A role explicitly allowed to work without attendance keeps using that
existing policy.
Approval promotes only the conflict-free provisional evidence after the
effective WFH policy, active employment, leave, office attendance and business
date are rechecked atomically. Rejection or cancellation makes that evidence
non-creditable and preserves its decision/audit history. It must not delete or
rewrite genuine task sessions, submissions or review history. Any resulting
attendance exception is visible and resolved through the existing explicit
recovery/exception path; it is never silently counted as approved attendance.

WFH review, provisional attendance, office check-in/out, leave decisions,
attendance-mode changes, employee status changes and work-session start/stop
must serialize on the same person/business-date boundary. A concurrent office
check-in or approved leave must never create duplicate/conflicting attendance
credit. Rejection closes only the provisional attendance interval at a
server-authoritative timestamp; if the role requires attendance, an open work
timer is also paused at that same timestamp and cannot resume until valid
attendance is present. Already recorded task work remains intact. Same-day
office check-in is blocked while a WFH request is pending, so the employee must
cancel that request first. Employee checkout closes the linked timer but leaves
the evidence pending and non-creditable until a reviewer decides. The shared
business-boundary tick closes an open provisional interval and its linked timer
at the saved office-local midnight; the request remains reviewable.
Freeze/offboarding closes linked timers and discards provisional attendance
without creating official attendance or deleting task history. A late approval
may promote only the preserved provisional interval after eligibility and
conflict checks pass. These transitions are implemented locally through
migration 0064 and verified against PostgreSQL 17; see the Phase 9 evidence
snapshot and verification matrix for the exact test boundary.

-   the requester needs `availability.wfh.request` for their own record;
-   the reviewer needs `availability.wfh.review` for the target person's
    applicable scope;
-   approval rechecks the effective WFH policy for every requested date;
-   a denied policy, inactive person or invalid office assignment blocks
    approval;
-   an approved request authorises WFH attendance for those dates only;
-   cancellation and review decisions are audited and do not rewrite prior
    attendance;
-   overlapping pending or approved WFH requests for one person are rejected;
-   a reviewer cannot approve their own request unless a future explicit
    exception rule is added.
-   approved leave and approved WFH cannot overlap for the same person and
    business date; the second approval attempt is rejected explicitly;
-   policy changes do not invalidate an already-approved WFH date, but they do
    block new requests and pending approvals.
-   cancellation cannot silently rewrite a completed past business date.
-   cancellation is also blocked when an attendance fact already exists for
    any requested date; historical facts remain authoritative.

WFH requests are organisation records, not office-bound collaboration
boundaries. The effective office and timezone are resolved for each attendance
command, so employees in different offices can collaborate on the same
organisation/client work without changing task ownership or visibility.

------------------------------------------------------------------------

### Shared availability reconciliation

Attendance, leave, WFH and holiday/calendar changes use one
reconciliation policy. When availability changes affect existing
activity, the server determines the effective date/time, preserves
existing records, closes or invalidates only affected active state,
prevents new invalid activity, creates a Historical Exception when human
review is required, audits the change, and never silently deletes
historical work.

Historical timeline interpretation uses the configuration effective for
the relevant period. A leave/attendance conflict follows the explicit V1
recovery rule in §41; it is never auto-approved or auto-rejected.

For V1, the safe reconciliation boundary is explicit: new attendance checks
and mode changes use the effective rules at command time; existing attendance
and work records are preserved. Holiday/calendar changes close only affected
open attendance at the server-authoritative effective timestamp and create a
Historical Exception when the existing record now needs human review. Leave
approval refuses to silently rewrite an existing attendance record and returns
an actionable conflict for the future recovery command.

# 43. Onboarding

Initial flow:

``` text
Invited
  ↓
Account created
  ↓
Profile
  ↓
Employment
  ↓
Office
  ↓
Department
  ↓
Role
  ↓
Policies
  ↓
Active
```

Authentication alone must not make a person operational.

The standard account flow is:

``` text
HR/Admin creates an Invited person
  ↓
NOVA sends a one-time invitation
  ↓
Person creates their own password and verifies the invited email
  ↓
NOVA links the verified authentication identity and moves the person to Onboarding
  ↓
Required profile, employment, office, department, role and policy setup
  ↓
Active
```

The deployment setup wizard also records the organisation's effective-dated
attendance interpretation before the first office is configured:

-   **Hour-based:** measure actual attendance duration against the configured
    required minutes; do not invent late or early states.
-   **Scheduled:** interpret attendance against the shift attached to the
    person's office calendar and derive schedule-relative states where the
    shift exists.

The wizard may use a safe default for required minutes, but the value must be
explicitly visible and changeable through the protected organisation-settings
command. Attendance-policy changes are effective-dated so historical timeline
interpretation is never rewritten. WFH is not a third attendance mode: it
remains a role/policy-controlled, approval-gated mode on the same attendance
state.

NOVA never sends normal temporary passwords or gives HR a person's password.
An invitation secret is single-use, expires, is revocable, and is stored only
as a hash. Its URL must avoid routine server-log/referrer exposure. Resending
must invalidate the prior invitation rather than reusing its secret.

Better Auth owns credentials, sessions, verification and password reset. NOVA
owns the invitation, person identity link, lifecycle state, role, permission,
scope and operational access decision. Direct public account creation is not a
normal NOVA path: the founding account is a deployment-token-controlled
one-time exception, and every employee account originates from an invitation.
An Onboarding person may use only onboarding-specific functionality; normal
work access requires an eligible operational state and current NOVA
authorization.

Email is a delivery adapter, not an authentication dependency. When no email
connection is active, a signed-in person may change their own password directly
through Better Auth, while an authorised role may generate a short-lived,
one-time NOVA system handoff for an invitation, email verification or password
reset. The handoff URL is encrypted at rest, revealed once through the
permission-controlled Admin surface, never logged, and audited. It lets an
operator hand the link to the person without creating or seeing a password;
it does not create a second identity or authorization system. The
organisation-scoped `auth.manual_recovery` permission controls verification
and password-recovery handoffs; the existing `people.invite` permission
controls invitation handoffs. A Super Admin may explicitly deactivate email
delivery, after which normal NOVA activity and in-app notifications continue
while transactional email uses the same secure handoff path.

During the one-time founder bootstrap, if email is not configured, the
unverified founding Super Admin may use the still-held deployment setup token
to reveal only their own verification handoff. This is a bootstrap escape from
the normal verified-actor gate, limited to the protected founding role and the
verification purpose; it cannot reveal invitations, password-reset links, or
another person's handoff. Once verification completes, normal permission and
operational gates apply.

Better Auth applies origin/CSRF protection to its authentication endpoints.
NOVA's separate cookie-authenticated state-changing command endpoints apply the
same-origin boundary too: browser mutations with a session cookie must carry a
trusted Origin or Referer, cross-site Fetch Metadata is rejected, and
non-browser operator/API requests without browser credentials remain usable.
This is request-forgery protection only; it does not replace write-time NOVA
authorization or PostgreSQL RLS.

Privileged asynchronous callbacks are write commands too. A one-time OAuth
state/PKCE proof may identify the initiating account, but the callback must
recheck that the initiator is still an operational Super Admin at the final
credential write; freezing, offboarding or role revocation must prevent the
pending callback from changing deployment email configuration.

------------------------------------------------------------------------

# 44. Offboarding and handover

Offboarding includes:

-   notice;
-   active work review;
-   assignment handoff;
-   pending reviews;
-   account freeze;
-   exit.

Handover:

``` text
Leaving employee
      ↓
Find active assignments
      ↓
Choose eligible replacement
      ↓
Create replacement assignment
      ↓
Preserve old history
      ↓
Freeze old account
```

Do not rewrite history to make the replacement appear to have performed
previous work.

------------------------------------------------------------------------

# 45. Frozen accounts

Frozen accounts cannot:

-   authenticate for normal work;
-   start new work;
-   receive new assignments;
-   modify operational records.

Freezing must revoke existing sessions and block new normal sessions. Every
normal API command rechecks the resolved person lifecycle state; a stale
session never overrides a Frozen, Offboarding or Exited domain state.

Historical records remain.

------------------------------------------------------------------------

# 46. Payroll

### 46.0 Payroll module boundary

Payroll is a **separate later module**.

Deferred to that module:

-   payrun creation;
-   Draft -\> Validate -\> Calculate -\> Review Exceptions -\> Lock;
-   payroll calculation;
-   compensation proration;
-   statutory deductions and tax;
-   payslips;
-   payment/export execution;
-   country-specific payroll rules.

Core NOVA still preserves all source data required by that future
module.

The `payrun` object itself does not need to exist in V1. Therefore,
"locked payruns are immutable" is a future Payroll-module invariant, not
a V1 implementation requirement.

Payroll consumes canonical NOVA records and does not own attendance,
work, leave or employment history.

Do not move payment logic into attendance, leave, work sessions or the
people lifecycle merely because those records will eventually feed
payroll.

### 46.1 Compensation effective dates

When compensation terms are promoted into the Payroll input contract, every
term must have an explicit effective date. Editing the current profile does
not determine historical compensation. The current V1 schema deliberately
does not invent salary components or currency/period semantics before that
contract is frozen.

The compensation term effective for a period is selected using the
effective date. Overlapping terms for the same scope are invalid.

Proration of a non-overlapping mid-period change is deliberately
deferred to the Payroll module.

### 46.2 Department transfer during a payroll cycle

Organisation Department history is effective-dated.

Activity before a department transfer retains the old department
context. Activity after the effective transfer uses the new context.

A future Payroll module must consume this historical context rather than
using the person's current department to reconstruct the past.

### 46.3 Payroll eligibility

Payroll is not implied by employee status.

A person/role can explicitly have:

``` text
Payroll applicable = YES/NO
```

If attendance contributes to payroll, the person must have a valid
applicable attendance source.

Invalid configurations must be rejected.

### 46.4 Payroll lifecycle

The following lifecycle describes the **future Payroll module** and is
not part of the V1 build:

``` text
Draft
  ↓
Validate
  ↓
Calculate
  ↓
Review exceptions
  ↓
Lock
  ↓
Export / payslip data
```

When that future module exists, locked payruns are immutable.

# 47. Audit

Sensitive actions produce audit records.

At minimum:

-   role changes;
-   permission changes;
-   person changes;
-   account freeze;
-   offboarding;
-   attendance recovery;
-   work timeline adjustments;
-   leave decisions;
-   assignment changes where sensitive;
-   review decisions;
-   payroll actions;
-   configuration changes.

Audit record:

``` text
actor
action
target
timestamp
structured details
```

Do not store secrets.

Audit history is append-only.

------------------------------------------------------------------------

### Historical Exceptions

When a later administrative change makes a historical record
operationally inconsistent, NOVA preserves the record and creates a
**Historical Exception**.

The exception records the affected record, original
person/assignment/context, later change causing it, actor, timestamp,
reason and resolution state.

Unresolved Historical Exceptions have an operational surface in the
Dashboard for authorised users. The Audit area remains the detailed
audit trail. An authorised user can inspect the original/current context
and follow the defined resolution action.

A Historical Exception never silently rewrites the historical record.

# 48. Dashboard model

Dashboards are projections of canonical data.

## Employee / My Day

-   attendance;
-   unified daily timeline;
-   current work;
-   tracked time;
-   untracked time;
-   tasks;
-   reviews;
-   leave;
-   calendar;
-   actionable timeline corrections when permitted.

## Manager

-   team availability;
-   active work;
-   overdue tasks;
-   review queue;
-   capacity;
-   attendance exceptions;
-   timeline exceptions where permitted.

## HR

-   people;
-   onboarding;
-   offboarding;
-   attendance;
-   leave;
-   holidays;
-   recovery.

## Admin / Super Admin

-   organisation overview;
-   people;
-   work;
-   configuration;
-   payroll;
-   reports;
-   audit;
-   permission configuration.

No dashboard gets its own authoritative data store.

------------------------------------------------------------------------

# 49. Calendar

Calendar is a read-only projection of:

-   holidays;
-   attendance;
-   leave;
-   task due dates;
-   reviews;
-   supported meetings.

Calendar does not become another task database.

------------------------------------------------------------------------

# 50. Notifications

Initial notifications:

-   task assignment;
-   reassignment;
-   review request;
-   return;
-   approval;
-   leave decision;
-   attendance issue;
-   approaching due date;
-   onboarding/offboarding action;
-   timeline correction requirement.

Do not build a general event bus.

A small notification/outbox mechanism is sufficient initially.

The implementation plan is maintained in `docs/notification-module-plan.md`.
Notifications are a separate provider-neutral module: domain commands enqueue
an idempotent intent in the same transaction, and a worker later delivers it
through a configurable channel adapter. The first module must remain a small
outbox/worker slice, not a general event bus.

Each intent's idempotency key must identify the authoritative source mutation
(preferably its immutable audit or domain-record identifier), not merely a
repeated display value. Repeating a later role/policy edit must therefore
produce a new notification while retries of the same mutation remain safe.

Cross-recipient fan-out uses only a narrow request-context-checked PostgreSQL
enqueue operation; recipient-scoped RLS remains effective for inbox reads and
normal row access. This is an explicit domain operation, not a general RLS
bypass.

The initial integration slice also emits in-app events for leave/WFH
cancellation, leave-attendance conflict and recovery, rejected office
locations, effective WFH policy changes, office calendar/holiday changes, role
permission changes, and both sides of task reassignment. These remain event
intents, not permission grants; the underlying command authorization is
evaluated independently.

The authenticated UI notification page/inbox is the default destination for
supported NOVA events. A bell/unread count may open a compact modal, but the
page remains the durable source. Notification email is an optional channel and
is disabled by default; enabling it uses the configured provider-neutral email
adapter. Missing or disabled email delivery must never block the domain
transaction or in-app notification. Invitation, email verification and
password reset remain separate transactional account email and are not
controlled by notification preferences.

An active person can always read their own inbox and manage their own optional
notification-channel preferences. Organisation-wide notification defaults,
suppression, replay and delivery inspection remain configurable permission
surfaces (for example `notifications.manage` and
`notifications.delivery.view`) and never replace the underlying domain
permission check.

Transactional account email is a separate, narrow delivery capability, not a
general event bus. Initial uses are invitation, email verification and password
reset. The invitation record commits before delivery; if delivery fails, NOVA
retains a recoverable invitation and audits the failure. A resend creates a new
secret. The notification module now persists the in-app inbox, optional email
outbox staging, bounded provider retries, and idempotent due/overdue task
reminders for leave/WFH decisions, task assignment/reviewer events, onboarding,
and freeze/offboarding lifecycle notices. Broader policy recipient resolvers
remain additive work.

------------------------------------------------------------------------

# 51. Architecture

Primary stack:

``` text
Frontend
React + TypeScript

Application
NOVA API

Database
PostgreSQL

Convenient deployment
Supabase

Self-hosted deployment
Docker + PostgreSQL + NOVA services
```

NOVA is:

> **PostgreSQL-native and deployment-portable, not backend-agnostic at
> every line of code.**

## Architecture priorities

The initial implementation must optimise for **correctness, backend
robustness, API clarity, data integrity, portability and
maintainability** before UI breadth or visual polish.

The UI is a client of the domain. It must not become the place where
NOVA's business rules live. A workflow is considered real only when
its authoritative database, domain/API command, authorization,
concurrency behaviour, audit/history requirements and focused
verification are correct.

Implementation priority:

``` text
Product rule
    ↓
Canonical domain behaviour
    ↓
PostgreSQL data integrity / transaction
    ↓
NOVA command/API
    ↓
Authorization + policy enforcement
    ↓
Focused verification
    ↓
Documentation
    ↓
UI
```

Do not build large amounts of UI to discover or compensate for an
undefined backend contract. UI can remain minimal while backend/domain
work is being stabilised.

Authorization and database access are deliberately layered rather than
duplicated:

-   the NOVA API/domain layer evaluates the complete business decision:
    permission + applicable scope + operational capability + target-state
    rule + policy = allowed action;
-   PostgreSQL constraints enforce invariants that are representable at
    the database boundary;
-   transactions and locking make state transitions and concurrency
    behaviour atomic where required;
-   PostgreSQL Row Level Security (RLS), where it applies, enforces the
    row-access boundary as defence in depth.

RLS is not NOVA's primary domain authorization engine. A row being
visible through RLS never means that an actor may perform an action on
it. Sensitive writes and domain transitions still perform NOVA
authorization against authoritative current state at write time.

### Backend-first engineering requirements

For each non-trivial feature, establish before broad UI work:

-   canonical data model and ownership;
-   authoritative state transitions;
-   command/API contract;
-   authorization and operational-policy checks;
-   transaction and concurrency behaviour;
-   error semantics;
-   audit/history requirements;
-   idempotency requirements where applicable;
-   focused verification;
-   documentation of the resulting contract.

The frontend must consume these contracts rather than reimplementing
them.

### No redundant source of truth

Do not create multiple fields, tables, services, handlers or frontend
state machines that independently represent the same business fact.

Before introducing a new implementation, locate the existing canonical
rule and extend it when possible. If two representations are genuinely
required, document which one is authoritative and why.

A convenience projection, cache, UI state or reporting view must not
become an accidental second source of truth.

### Code and API quality

NOVA code must be:

-   explicit about domain boundaries;
-   small enough to understand locally;
-   deterministic where business rules require determinism;
-   defensive at trust boundaries;
-   safe under retries and concurrent requests where applicable;
-   free of hidden side effects where practical;
-   documented at the boundary where another developer must understand
    the contract;
-   easy to replace or move without rewriting unrelated domain logic.

Prefer a small number of clear commands over generic framework
machinery. Prefer domain-specific errors over ambiguous generic
failures. Do not introduce abstraction solely to make the architecture
look scalable.

### Documentation as part of implementation

Documentation is not a final polish step. When implementation
establishes or changes a domain rule, API contract, invariant, lifecycle
transition, permission implication or portability constraint, the
canonical documentation must be updated in the same change.

Code comments should explain non-obvious **why**, invariants or
constraints. They must not become the only place where a product rule is
defined.

------------------------------------------------------------------------

# 52. NOVA API boundary

The NOVA API is the primary application boundary and must remain
usable independently of the React frontend.

Frontend communicates through explicit application commands.

Examples:

``` text
POST /api/attendance/check-in
POST /api/attendance/check-out
POST /api/attendance/recover

POST /api/work-sessions/start
POST /api/work-sessions/:id/pause
POST /api/work-sessions/:id/stop
(`resume` is the same start command and creates a new session.)

POST /api/work/timeline-adjustments
GET  /api/work/assignments/mine
GET  /api/work/timeline

POST /api/tasks
GET  /api/tasks
POST /api/tasks/:id/cancel
POST /api/tasks/:id/assignments
POST /api/task-assignments/:id/submit
POST /api/task-assignments/:id/reassign
POST /api/task-assignments/:id/reviewer-exception
POST /api/task-assignments/:id/reviewer-requests
POST /api/task-assignments/:id/handover-requests
GET  /api/task-assignments/:id/candidates
GET  /api/task-reviewer-requests
POST /api/task-reviewer-requests/:id/accept|decline|withdraw
GET  /api/task-handover-requests
POST /api/task-handover-requests/:id/accept|decline|withdraw
GET  /api/reviews/pending

POST /api/task-assignments/:id/review
(`decision` is `approved` or `changes_requested`.)

POST /api/leave
POST /api/leave/:id/review
POST /api/leave/:id/resolve-conflict

POST /api/availability/wfh-policies
POST /api/availability/wfh
GET  /api/availability/wfh/mine
GET  /api/availability/wfh/pending
POST /api/availability/wfh/:id/review
POST /api/availability/wfh/:id/cancel
PATCH /api/offices/:id/geofence
POST /api/historical-exceptions/:id/resolve
GET  /api/work-context
POST /api/clients
POST /api/workstreams/client
POST /api/workstreams/organisation
POST /api/work-groups
POST /api/tasks
POST /api/tasks/:id/assignments
PATCH /api/task-assignments/:id/reviewer
GET  /api/notifications
GET  /api/notifications/unread-count
POST /api/notifications/:id/read
POST /api/notifications/read-all
GET  /api/notification-preferences
PATCH /api/notification-preferences
GET  /api/notifications/delivery
POST /api/notifications/delivery/:id/requeue
```

Date-only command fields are validated as real Gregorian calendar dates at the
API boundary before database casting. A value matching `YYYY-MM-DD` is not
accepted when that day does not exist; the command returns its normal input
error rather than relying on a provider-specific PostgreSQL cast failure.

Implemented availability command contracts:

- `POST /api/availability/wfh` accepts `{ startDate, endDate, reason? }` and
  requires `availability.wfh.request`; it creates a pending, non-overlapping
  date-range request after server-side policy and assignment checks.
- `GET /api/availability/wfh/mine` returns the actor's request state;
  `GET /api/availability/wfh/pending` returns requests visible through the
  actor's `availability.wfh.review` scope.
- `POST /api/availability/wfh/:id/review` accepts `{ decision, reason? }`,
  rechecks eligibility on approval, prevents self-review, and audits the
  decision. `POST /api/availability/wfh/:id/cancel` cancels the requester's
  pending or approved request.
- `PATCH /api/offices/:id/geofence` accepts `{ latitude, longitude,
  geofenceRadiusMeters }` and requires `availability.office_geofence.manage`.
- Office attendance commands accept `{ mode: "office" | "wfh" }`; office mode
  additionally requires browser-provided `latitude`, `longitude`, and
  `accuracyMeters`. The server computes distance against the effective
  office's timezone/geofence and stores minimum decision evidence.
- `POST /api/attendance/recover` accepts a target person, business date,
  corrected mode/timestamps and a mandatory reason. It requires
  `attendance.recover` for the target scope, is limited to the previous 31
  days, preserves the before/after state in `attendance_corrections`, and
  never fabricates location evidence.
- The collaboration commands create organisation/client workstreams, groups,
  tasks and assignments. Their permission scopes are organisation, client,
  client-workstream, group or assigned-work; database triggers reject
  cross-organisation context and self-review assignments.

Other API design remains deferred until its product rules are frozen. Once a
command is implemented, its contract must be explicit and documented:
request shape, authoritative inputs, permission requirements, state
preconditions, success result, domain errors, idempotency/concurrency
semantics and audit effects where applicable.

Do not make frontend-specific endpoints the canonical API merely because
they are convenient for one screen. API commands should represent domain
operations and remain usable by another client or deployment.

------------------------------------------------------------------------

# 53. Command contract

Every important command should:

1.  authenticate actor;
2.  resolve organisation;
3.  establish the provider-neutral, transaction-local database request
    context required for applicable RLS policies;
4.  validate input;
5.  validate current state;
6.  validate permission;
7.  validate operational policy;
8.  perform transaction;
9.  write audit data where required;
10. return resulting state.

The authentication adapter resolves the principal and organisation
before the database request. PostgreSQL receives only the verified
context it needs for access control, conceptually including `user_id`,
`organisation_id` and any narrowly required request attributes. A
portable deployment may expose this through transaction-local PostgreSQL
settings or an equivalent database boundary; these values must never be
accepted from the client as authoritative claims.

Do not trust:

-   client-sent role;
-   client-sent organisation;
-   client-sent timezone;
-   client-sent business date;
-   client-sent permission;
-   client-sent authoritative timestamp.

The initial organisation bootstrap is a one-time setup operation, not a
normal permission grant. The API must first authenticate the initial
actor and verify a deployment-only bootstrap token that is never stored
in NOVA records or exposed to a client bundle. A narrowly scoped,
migration-owned PostgreSQL operation may then create the first
organisation, protected Super Admin, identity mapping, role grants and
audit record atomically only while no organisation exists. This is an
explicit bootstrap exception to normal RLS request access; it must not
become a general privileged API path.

------------------------------------------------------------------------

# 54. PostgreSQL functions

PostgreSQL functions may be used where transactional atomicity is
valuable. They are part of the persistence implementation, not a second
application API.

Use one canonical operation for a business transition. If a transition
needs a PostgreSQL function for atomicity, the NOVA API/domain command
should invoke that canonical operation rather than maintaining a second
independent implementation in application code.

Examples:

``` text
clock_in
clock_out

start_work
pause_work
resume_work
stop_work

adjust_work_timeline

approve_leave

submit_assignment
approve_review
return_review

freeze_person
lock_payrun
```

The business operation belongs to NOVA.

Supabase RPC is only one way to expose a PostgreSQL function.

Do not scatter direct Supabase RPC calls throughout the frontend.

------------------------------------------------------------------------

# 55. Supabase boundary

Supabase is a deployment/infrastructure choice, not the NOVA domain
model. The product must be able to leave Supabase without redesigning
core business rules.

Keep Supabase-specific functionality at the infrastructure edge:

-   Auth;
-   Storage;
-   Realtime;
-   Supabase client calls;
-   Edge Functions.

The core domain must not depend on Supabase-specific concepts.

In particular, do not make domain code depend directly on:

-   Supabase client objects;
-   Supabase-specific request/response shapes;
-   Supabase Auth user objects;
-   Supabase Storage paths as domain identifiers;
-   Supabase Realtime semantics;
-   frontend-only Supabase RPC conventions.

Supabase adapters may translate between infrastructure representations
and NOVA's canonical domain/API contracts.

RLS is PostgreSQL-native and therefore works across Supabase Cloud,
local/self-hosted Supabase and direct/self-hosted PostgreSQL. RLS
policies belong in PostgreSQL migrations/schema as part of NOVA's
canonical database definition.

The deployment invariant is:

``` text
Same NOVA domain/security semantics
        ↓
PostgreSQL + constraints + transactions + RLS
        ↓
Deployment-specific infrastructure
├── Supabase Cloud
├── Local/self-hosted Supabase
└── Direct/self-hosted PostgreSQL
```

The authentication adapter resolves a provider-neutral request context for
the database (`user_id`, `organisation_id`, and only the narrowly required
request context). Supabase Cloud may populate it through Supabase
infrastructure; a direct deployment supplies the equivalent context without
requiring Supabase.

Supabase deployments may populate the verified request context through
Supabase infrastructure. Direct deployments must supply the equivalent
provider-neutral context through their authentication adapter. Do not
scatter Supabase-specific identity functions, JWT claims, client APIs or
SDK behaviour—such as `auth.uid()`—through domain logic or portable RLS
policies. A compatibility layer is acceptable only when it preserves the
same provider-neutral contract.

The shared RLS actor-context check must also require the resolved person to be
operational (`active` or `notice`) at statement time. This closes the race
between an initial session check and a later freeze/offboarding commit; it does
not replace the API/domain permission and target-state checks.

External I/O may use separate runtimes for:

-   email;
-   webhooks;
-   third-party APIs.

Core HR/work state transitions remain in NOVA/PostgreSQL.

Email delivery is provider-neutral. A deployment has one explicitly selected
active connection, configurable only by a protected Super Admin after setup:

-   local console output for development;
-   standard SMTP for company/VPS mail infrastructure;
-   Gmail OAuth through Google's HTTPS Gmail API using a customer-controlled
    Google OAuth client and refresh token, requesting only the `gmail.send`
    scope;
-   an HTTP provider adapter such as Resend;
-   future reviewed adapters for providers whose normal SMTP interface is not
    suitable.

The Gmail adapter composes standards-compliant MIME with Nodemailer, then sends
through Google's HTTPS Gmail API. It therefore works on both Node runtimes and
HTTPS-only runtimes such as Cloudflare Workers. Ordinary SMTP remains a
Node-runtime adapter. Gmail API use requires the customer to enable Gmail API
for its Google Cloud OAuth client; Google's consent-screen and verification
requirements remain controlled by Google and that customer project. Google
classifies `gmail.send` as a sensitive scope, so public OAuth apps may need
Google verification before unrestricted use.

External email delivery is at-least-once, not exactly-once: PostgreSQL outbox
leases prevent duplicate NOVA intent rows, but a provider may accept a message
and lose its response before NOVA records success. Adapters should forward the
stable message identifier and use provider idempotency when available. SMTP and
Gmail API delivery can still duplicate a message after an ambiguous timeout;
one-time invitation, verification and reset tokens keep such a duplicate from
granting additional access. The in-app event/domain transition remains
transactional and idempotent independently of external delivery.

NOVA never returns or exposes provider credentials, OAuth client secrets or
refresh tokens to a browser/client after submission, and never stores them as
plaintext. A protected Super Admin may enter a new credential only in the
authenticated connection-setup screen; it travels only in that one TLS request
to the NOVA API and the client must not persist, log or render it again. NOVA
encrypts it with a deployment-only key before PostgreSQL storage. Super Admins
may test a draft connection and atomically activate a different tested
connection; NOVA does not silently fail over to a different sender. Generic
SMTP covers most free or existing mail services. Arbitrary user-entered
provider code or webhook URLs are not a supported configuration surface.

Email delivery may also be explicitly deactivated. This does not disable
Better Auth, sessions, normal sign-in, or the in-app notification inbox. It
only means that invitation, verification and password-reset delivery uses the
NOVA system-handoff path when an authorised administrator reveals a single-use
link. No password is displayed or set by the administrator, and a missing
email provider never grants additional domain access.

V1 sender ownership is customer-owned in every deployment shape, including
Netlify/Vercel with Supabase Cloud. NOVA does not promise a shared platform
sender, domain reputation, quotas or deliverability service; a future hosted
sender would be a separately contracted infrastructure adapter.

------------------------------------------------------------------------

# 56. Deployment and portability

The first operational hosted deployment target is GitHub -> Cloudflare Worker
with Supabase Cloud PostgreSQL. Netlify and Vercel Functions must be able to run the
same NOVA API contract with the same Supabase database configuration.
Direct/self-hosted PostgreSQL + NOVA services on a VPS remains a
first-class portability target for a later deployment, not a future
rewrite. These paths run the same canonical domain rules, PostgreSQL
schema semantics, RLS policies and NOVA API contracts.

## 56.1 Customer/deployment provisioning and first-run onboarding

NOVA has two separate onboarding layers that must not be conflated:

1. **Customer/deployment onboarding**: the operator or optional hosted-service process
   that provisions a NOVA deployment for a customer.
2. **Organisation/person onboarding**: the in-product process that creates
   the customer's organisation and invites its people.

Optional hosted-service payment, licensing and provisioning are deployment
concerns. They must not become hidden dependencies of the NOVA organisation,
permission, attendance, payroll or RLS domain model.

### Hosted open-source path

The hosted open-source path is:

``` text
Customer or operator obtains the open-source repository
        ↓
Customer chooses runtime host, intended public URL and scheduler recipe
        ↓
Operator creates/selects Supabase Cloud and runs the database bootstrap on a trusted computer
        ↓
Customer connects GitHub and copies only runtime values into the hosting provider's private settings
        ↓
Connected provider publishes the configured production API/static adapter and selected native-scheduler configuration
        ↓
Public health/readiness checks pass; if Supabase Cron was selected, the operator creates its job now
        ↓
Exactly one scheduler is verified with a successful protected tick
        ↓
Expiring founder setup handoff
        ↓
Customer creates the organisation owner account
        ↓
Customer selects the approved public origin in guided setup
        ↓
Customer configures email delivery and organisation settings
        ↓
Customer invites people through the normal NOVA onboarding flow
```

These steps have separate owners and apply in the named system: GitHub supplies
source; Cloudflare/Netlify/Vercel deploy code and hold server-side runtime
secrets; Supabase Cloud stores PostgreSQL data and migrations; the public-domain
provider owns DNS/HTTPS; NOVA first-run stores the approved origin and creates
the organisation. `bun run setup:supabase` applies migrations and runs
application-role preflight from a trusted operator computer, but does not
deploy or start the API. Its management token and migration-owner credentials
must never be copied to GitHub, the browser or an application host.

For Cloudflare Workers connected to Supabase Cloud, configure Hyperdrive with
the Supabase Direct database endpoint and NOVA's restricted `nova_app`
credentials. Do not use the transaction-pooler `DATABASE_URL` generated by
`bun run setup:supabase` as the Hyperdrive origin: Hyperdrive connects directly
and supplies its own pooling. Netlify/Vercel Node runtimes use the generated
transaction-pooler URL. The runtime role, RLS, migration ownership and NOVA
domain semantics stay the same; only the provider-specific connection route
changes. Cloudflare Worker invocations use request-scoped PostgreSQL clients
for both NOVA domain access and Better Auth; Hyperdrive owns cross-request
connection pooling. They must not retain a process-global `pg.Pool` across
Worker invocations. Node-based hosts keep their bounded application/auth pools.
The Cloudflare adapter requires its Hyperdrive binding and must fail
closed when it is absent; it must not silently fall back to a raw
`DATABASE_URL`. See Cloudflare's [Supabase Hyperdrive guide](https://developers.cloudflare.com/hyperdrive/examples/connect-to-postgres/postgres-database-providers/supabase/).

The scheduler radio choice in NOVA's deployment guide is an instruction
selector, not a remote provider write. Native Cloudflare/Netlify/Vercel
schedules are activated or removed by deploying the matching repository
configuration. A GitHub import may publish an initial bootstrap build before
the database and runtime settings are ready; it must not be treated as a
production-ready handoff, and employees must not be invited until the final
configured build passes health/readiness. Supabase `pg_cron`/`pg_net` is
created separately by the trusted operator command only after the deployed API
is ready, and stores its URL/secret in Supabase Vault. A deployment must
disable the previous provider trigger, apply the new provider/runtime
selection, then inspect that provider's invocation history and verify a
successful protected NOVA tick. The VPS/local path runs the same NOVA tick via
one local maintenance worker. Email is configured later inside NOVA by an
authorized Super Admin; provider credentials are encrypted in PostgreSQL and
the encryption key stays with the API runtime.

The deployment guide must make the ownership and activation point of every
infrastructure choice visible: GitHub supplies code; the selected host runs the
UI/API and holds runtime secrets; PostgreSQL stores canonical NOVA data; the
domain provider owns DNS/HTTPS; Better Auth runs inside NOVA; email is
configured in NOVA; and one selected scheduler invokes the same protected
background endpoint. Its scheduler instructions must separate pre-deployment
configuration from post-readiness activation. The Supabase job-creation command
must not be shown as an action to run before the production API passes
`/api/ready`; native schedules are registered by their configured production
deploy, while direct-PostgreSQL deployments start one supervised VPS/local
maintenance worker. A selected radio option or checked box is never evidence
that a third-party resource changed or ran.

NOVA is open source and does not require checkout, a trial, a subscription,
license activation or an always-online entitlement service. Optional hosted
support or managed infrastructure may exist outside the core repository, but
it must not be required for a deployment to start or keep operating. A
customer must never receive a raw Supabase management token, migration-owner
credential or secret environment value.

### Direct/self-hosted customer path

The self-hosted open-source path is:

``` text
Customer receives the repository/package and deployment instructions
        ↓
Operator runs the guided setup wrapper (or provisions PostgreSQL and NOVA services)
        ↓
The wrapper generates local-only secrets, or the operator supplies external secrets,
then runs migrations and readiness checks
        ↓
Operator performs the health/readiness check
        ↓
Deployment owner uses the one-time setup handoff
        ↓
Customer creates the organisation and Super Admin
        ↓
Customer selects the approved public origin in guided setup
        ↓
Customer configures email, availability and people
```

The direct deployment is fully self-contained. It must remain useful without
Supabase, Netlify, Vercel, a billing provider or any mandatory call-home
service. `bun run setup` is the canonical guided local path: it creates `.env`
only when absent, starts Docker Compose, waits for API health, runs the
provider-neutral preflight and prints the one-time setup handoff. The external
mode runs the same migration/preflight sequence against already-provisioned
Supabase Cloud or direct PostgreSQL. Neither mode creates provider identity,
billing or license state. Operators can run NOVA locally, on a private server
or on a VPS using the same migrations and API.

## 56.2 Canonical public origin and custom domains

Every deployment has a canonical public origin: the exact `http`/`https`
origin at which the NOVA web/API surface is reachable. It is not inferred from
an arbitrary request host and it is not supplied by Supabase. DNS, HTTPS and
host mapping are deployment responsibilities handled by Cloudflare, Netlify,
Vercel or a
VPS reverse proxy.

The deployment operator configures `BETTER_AUTH_URL` as the safe fallback and
`NOVA_ALLOWED_ORIGINS` as a comma-separated allowlist of exact origins already
mapped to that deployment. The allowlist is the trust boundary and is required
for Better Auth trusted-origin/host checks. It must reject paths, credentials,
query strings and unowned wildcard hosts. The same variables work for
Supabase Cloud plus Netlify/Vercel and for direct PostgreSQL/VPS deployments.

During the first-run setup screen, the exact public origin is selected before
email delivery is configured. The unverified founding Super Admin may perform
this one selection only while presenting the one-time deployment bootstrap
token; this narrowly avoids a verification circular dependency. After that,
selection and changes use the protected `organisation.public_origin.manage`
permission. The selection is stored in PostgreSQL and audited. It may be
cleared for recovery only after the active email connection is deactivated,
but NOVA then blocks new invitations, authentication links, callbacks and
notification email until an approved origin is selected again. A database
setting can never add an origin outside the operator allowlist.

The effective origin resolver is the only source for absolute NOVA links. It
must be used for newly generated invitation links, Better Auth verification and
password-reset links, secure system handoffs, Gmail OAuth callbacks, browser
redirects and notification email deep links. Existing one-time credentials are
not rewritten after issuance; changing the setting affects links generated
after the change. Delivery paths fail closed rather than using the deployment
fallback when no organisation origin is explicitly selected. In-app navigation
may remain relative and uses the current browser origin.

The deployment sequence is:

```text
Connect custom domain + HTTPS at hosting/reverse proxy
        ↓
Set BETTER_AUTH_URL + NOVA_ALLOWED_ORIGINS and redeploy/restart
        ↓
Run canonical migrations and readiness checks
        ↓
Founder selects an approved origin in the guided setup screen
        ↓
Configure, test and activate one email adapter
        ↓
Test invitation, verification/reset, Gmail OAuth and notification links
```

NOVA must fail closed when the configured origin is malformed or not in the
deployment allowlist. This prevents an organisation setting, compromised
record, or forwarded host header from becoming an open redirect or an
authentication-link forgery boundary. Provider adapters remain responsible for
transport only; the domain and permission model are unchanged.

If every Super Admin is unavailable, ownership recovery is an operator-only
break-glass procedure: a verified temporary Better Auth identity is created
through the configured auth adapter, a reviewed migration-owner script requires
distinct two-person approval and an incident record, and the normal audited
owner-transfer command is used immediately afterward. The recovery asset must
never insert password hashes or expose a hidden database-owner login through
the product API.

### Optional hosted-service boundary

An optional hosted-service operator may integrate billing, support or managed
provisioning through a narrow adapter. That adapter may translate external
service state into a provider-neutral deployment capability, for example:

``` text
pending → active → suspended
```

If such an adapter is ever added, it must provide idempotent provisioning and
webhook handling, customer/deployment mapping and an auditable support
override. Provider customer IDs and webhook payloads remain infrastructure
records; they are not organisation or person identifiers.

Any hosted-service checks belong at the deployment/API boundary and must not
replace NOVA permissions, role scope, operational policy, target-state rules
or RLS. They must not silently delete or rewrite customer data. The core
open-source deployment has no entitlement gate.

The current NOVA foundation implements the deployment-token first-run path,
the guided attendance-policy choice and the `bun run setup` clone-to-ready
wrapper. Product checkout, billing, license
activation and plan enforcement are intentionally not part of the open-source
core. A future hosted operator may add its own provisioning/support adapter
without changing the NOVA domain schema.

The hosted deployment starts with only what a real workflow requires:

``` text
Cloudflare/Netlify static NOVA web build (when a workflow needs a client)
Cloudflare Worker or Netlify Function running NOVA API commands
Supabase Cloud PostgreSQL
NOVA authentication boundary
```

The later direct VPS shape is:

``` text
Docker Compose or equivalent

NOVA Web
NOVA API
PostgreSQL
NOVA authentication
Object Storage
Background worker/scheduler
Reverse proxy
```

Deployment safety requirements apply to both hosted and direct PostgreSQL
paths: the migration runner serializes concurrent upgrade attempts with a
PostgreSQL advisory lock and records each applied file in the canonical
migration ledger; the packaged API runtime runs as a non-root user and exposes
separate liveness and database-readiness checks. These are operational safety
properties, not a second application architecture. The portable
`deployment:preflight` command verifies the non-owner runtime role and schema;
when the migration-owner URL is supplied, it also verifies the expected latest
ledger entry without exposing either connection string.

Start both paths with the minimum required services.

`NOVA_SECRETS_ENCRYPTION_KEY` is required wherever provider credentials are
managed through NOVA. It belongs only in the deployment secret store: Netlify
or Vercel environment configuration for hosted installs, or the VPS secret
environment for direct PostgreSQL deployment. It is never a Supabase client,
browser, migration, or database secret.

Portability requirements:

-   PostgreSQL remains the canonical database;
-   application logic runs in NOVA-owned code;
-   the core API uses provider-neutral request/response and PostgreSQL
    interfaces, with thin Cloudflare, Netlify, Vercel or VPS adapters only at the
    runtime edge;
-   infrastructure adapters isolate Supabase-specific capabilities;
-   authentication has a replaceable boundary;
-   object storage has a replaceable boundary;
-   email/webhook/third-party integrations have explicit adapters;
-   migrations remain executable against standard PostgreSQL;
-   domain identifiers and records must not depend on provider-specific
    IDs where a NOVA-owned identifier is appropriate;
-   RLS policies, where used, remain part of the PostgreSQL migration
    set and consume the same provider-neutral request context in every
    deployment shape;
-   the API must not require Supabase Realtime to maintain correctness;
-   background processing must have a self-hostable implementation path;
-   Supabase Cloud scheduling may use `pg_cron`/`pg_net` with the managed
    `supabase_vault` extension, but this remains an infrastructure adapter;
    direct PostgreSQL deployments use the equivalent NOVA worker path;
-   no critical business invariant may depend on a Supabase-only
    feature.

The deployment principle is:

``` text
Same NOVA domain/security semantics
                ↓
PostgreSQL + constraints + transactions + RLS
                ↓
Deployment-specific infrastructure
├── Supabase Cloud + Cloudflare Worker (primary hosted target)
├── Supabase Cloud + Netlify/Vercel Functions (compatible hosted targets)
├── Direct/self-hosted PostgreSQL + NOVA services (VPS portability target)
└── Local/self-hosted Supabase (compatibility path, not a required deployment)
```

When RLS is the applicable row-access boundary, normal user-originated
API requests must use a database role subject to those policies. Any
system or maintenance access that can bypass RLS must be explicit,
narrowly scoped and separate from normal request handling. Deployment
configuration must account for PostgreSQL ownership and superuser bypass
semantics so an application path does not accidentally receive
unrestricted owner-style access.

Portability does **not** mean avoiding PostgreSQL-specific features.
PostgreSQL is an intentional canonical dependency. The portability
boundary is primarily the deployment/infrastructure layer, not an
obligation to support every database engine.

Do not add:

-   Redis;
-   queues;
-   Kubernetes;
-   microservices;
-   separate service fleet

without measured need.

------------------------------------------------------------------------

# 57. Database security

PostgreSQL must enforce:

-   organisation isolation;
-   applicable row-access boundaries through RLS;
-   important state constraints;
-   attendance uniqueness;
-   timer concurrency;
-   timeline overlap rules;
-   payroll locking;
-   foreign keys;
-   valid date ranges;
-   future-time restrictions;
-   adjustment authority.

The browser must not be able to bypass these by changing requests.

Frontend validation may improve feedback, but it is never authoritative.
Service/API checks must also be authoritative, and database constraints
or transactional enforcement must be used wherever the invariant is
representable at the database layer.

RLS is a row-access safety boundary and defence-in-depth mechanism, not
a substitute for NOVA's permission model. It works with constraints,
transactions and locking; it does not replace write-time business
authorization, operational-policy checks or target-state rules.

Availability conflict checks are also concurrency rules: leave, WFH and
attendance transitions use a shared person/date transaction lock before they
read or change the related state. This prevents two individually valid commands
from creating an invalid cross-module result between their reads and commits.

------------------------------------------------------------------------

# 58. Core database invariants

### Payroll-related invariants

Active in V1:

-   payroll applicability and related policy flags are explicit, not
    inferred;
-   compensation terms are effective-dated;
-   overlapping compensation terms for the same scope are rejected;
-   department/employment history is effective-dated;
-   historical attendance, leave, work and employment context are
    preserved;
-   current profile values cannot rewrite historical source data.

Deferred until the Payroll module exists:

-   payrun lifecycle;
-   locked payrun immutability;
-   payroll calculation correctness;
-   compensation proration;
-   statutory/tax correctness;
-   payment/export correctness.

Examples:

``` text
unique person + applicable business date for attendance

one running work session per person

ended_at >= started_at

no overlapping productive timeline blocks

no future timeline adjustment

leave end >= leave start

employment end >= employment start
```

Use transactions and row/advisory locking where concurrency requires it.

------------------------------------------------------------------------

## 58.1 Additional invariants

The database and service layer must enforce:

-   at most one active attendance state per person/business date;
-   effective-dated WFH overrides do not overlap for the same target;
-   WFH resolution uses person, department, office, then role precedence;
-   WFH attendance requires an approved request for the effective business
    date;
-   WFH request approval is permission/scope based and cannot self-approve;
-   office attendance requires a server-verified location within the
    effective office geofence and acceptable reported accuracy;
-   office geofences and timezones are resolved from the person's effective
    office assignment without changing organisation/client collaboration
    scope;
-   availability changes preserve source records and create unique historical exceptions;
-   at most one running work session per person;
-   reviewer belongs to the assignment, not the task;
-   each submission requiring review creates exactly one review cycle;
-   each review cycle can receive at most one authoritative decision;
-   one assignment approval never approves another assignment;
-   task-level Approved is derived from the required active assignment
    outcomes and is not an independent approval record;
-   approved assignments remain approved when another assignment on the
    same task is returned, unless explicitly reopened;
-   review/approval elapsed time is derived from server-authoritative
    submission and decision timestamps and is never productive work
    time;
-   an overdue or long-waiting review never auto-approves;
-   a submitted assignment has a valid reviewer or an explicit audited
    reviewer exception;
-   self-review is rejected;
-   permissions are rechecked at write time;
-   frozen/exited people cannot start new work;
-   administrative freeze/offboarding closes active work at the
    effective timestamp;
-   cancellation closes an active session without deleting recorded
    time;
-   reassignment never transfers historical work ownership;
-   historical records retain their original person, assignment and
    context;
-   compensation terms cannot overlap for the same effective scope;
-   locked payruns cannot be modified once the future Payroll module
    introduces payruns; this invariant is deferred until that module
    exists;
-   a task has exactly one client/organisation work context;
-   a person's primary organisation department is independent from task
    workstream context;
-   duplicate workstream names are allowed only when their parent scope
    makes them unambiguous;
-   no child context may silently contradict its parent context.
-   unresolved historical exceptions have an actionable operational
    surface for authorised users.

# 59. Historical data policy

Historical operational records normally remain:

-   former employees;
-   previous roles;
-   assignments;
-   work sessions;
-   timeline adjustments;
-   reviews;
-   attendance;
-   leave;
-   payroll;
-   audit.

Deletion is exceptional and policy-driven.

Use freezing/deactivation when future access needs to stop.

------------------------------------------------------------------------

# 60. V1 scope

## V1 scope boundary

### Payroll source data versus payroll execution

V1 **includes** payroll-relevant source data and configuration:

-   effective-dated employment history;
-   effective-dated Organisation Department history;
-   payroll applicability and related role/policy flags; effective-dated
    compensation terms remain gated until the first Payroll input contract is
    explicitly frozen;
-   attendance and leave history;
-   approved historical adjustments;
-   payroll applicability and related policy flags;
-   payroll permissions as capability configuration;
-   audit/history required to explain changes.

V1 **excludes** payroll execution:

-   payruns;
-   payroll calculations;
-   proration;
-   deductions/tax;
-   payslips;
-   payment/export execution.

The principle is simple: **preserve the facts now, build the consumer
later.**

The V1 product must solve the core small-company reality that one person
may perform work across multiple functional areas.

Therefore V1 includes:

-   Organisation Department as primary person membership;
-   Client Workstreams;
-   Organisation Workstreams;
-   explicit task context;
-   multi-workstream assignments;
-   per-assignment reviewers;
-   unified attendance/work timeline;
-   hour-based and scheduled attendance modes;
-   auditable timeline correction;
-   effective-dated employment and compensation history;
-   full-day and half-day leave;
-   concurrency-safe attendance and work timers;
-   lifecycle-safe freeze/offboarding/cancellation behaviour.

The V1 product does **not** attempt to model every possible organisation
structure. It uses explicit work contexts and assignments rather than a
generic hierarchy builder.

## Foundation

-   organisation;
-   authentication;
-   Super Admin bootstrap;
-   people;
-   offices;
-   organisation departments;
-   custom roles;
-   permissions;
-   audit.

## Availability

-   shifts;
-   working calendars;
-   holidays;
-   attendance;
-   WFH policy and approved WFH requests;
-   attendance geofencing;
-   leave.

## Work

-   clients;
-   client departments;
-   client membership;
-   organisation work;
-   groups;
-   tasks;
-   assignments;
-   reviewers;
-   work sessions;
-   unified daily timeline;
-   timeline exception detection;
-   controlled historical work adjustment;
-   review cycles.

## People lifecycle

-   onboarding;
-   notice;
-   offboarding;
-   handover;
-   freezing;
-   historical preservation.

## Operations

-   My Day;
-   Team;
-   People;
-   Client Work;
-   Review Queue;
-   calendar projection;
-   basic reports.

## Payroll

-   organisation-specific payrun;
-   deterministic calculation;
-   exceptions;
-   adjustments;
-   lock;
-   export.

------------------------------------------------------------------------

### Payroll boundary

V1 includes the HR/work records required by the future Payroll module,
but not payment calculation or payment execution. Employment history,
payroll policy flags, attendance, leave, approved adjustments and
historical context remain canonical NOVA data. Payment logic,
statutory payroll, tax handling, payslips and payment execution are
deferred to the separate Payroll module.

# 61. Explicitly deferred

Do not build initially:

-   AI assistant;
-   AI employee scoring;
-   gamification;
-   social feed;
-   chat;
-   universal CRM;
-   ATS;
-   expense suite;
-   asset management;
-   universal workflow builder;
-   custom scripting;
-   microservices;
-   event bus;
-   Kubernetes;
-   mobile app;
-   universal payroll engine;
-   statutory payroll integrations;
-   multi-currency payroll;
-   advanced recurring task engine;
-   arbitrary permission expression language;
-   realtime everywhere;
-   materialized analytics without query evidence.

------------------------------------------------------------------------

# 62. Build strategy

Build vertical slices, with a **backend/domain-first bias**.

The first implementation effort should stabilise the canonical backend,
database invariants and API contracts. UI is deliberately the last and
smallest part of each slice unless UI is required to validate a real
workflow.

Do not:

``` text
50 tables
↓
50 APIs
↓
UI
↓
hope everything connects
```

Instead:

``` text
Business rule
      ↓
Canonical domain behaviour
      ↓
Database model / invariant
      ↓
Command / API contract
      ↓
Permission + policy + concurrency
      ↓
Focused verification
      ↓
Documentation
      ↓
Minimal UI
      ↓
Real workflow
      ↓
Inspect actual edge cases
```

A feature is not complete until the full slice works.

------------------------------------------------------------------------

# 63. Build phases

## Phase 0 --- Product rules

Freeze:

-   terminology;
-   actors;
-   roles;
-   permissions;
-   operational capabilities;
-   attendance policy;
-   work eligibility;
-   timeline model;
-   timeline adjustment;
-   WFH;
-   leave;
-   holidays;
-   tasks;
-   assignments;
-   reviewers;
-   midnight behaviour;
-   offboarding;
-   payroll boundary.

**Exit condition:**

No important state has an undefined owner.

------------------------------------------------------------------------

## Phase 1 --- Organisation + identity

Build:

-   organisation;
-   Super Admin;
-   authentication;
-   people;
-   offices;
-   organisation departments;
-   roles;
-   permissions;
-   account states;
-   audit.

Acceptance:

Super Admin can:

-   create organisation;
-   create role;
-   configure permissions;
-   invite person;
-   assign office;
-   assign department;
-   assign role;
-   freeze account.

------------------------------------------------------------------------

## Phase 2 --- Availability

Build:

-   shifts;
-   calendars;
-   holidays;
-   attendance;
-   WFH policy and approved WFH requests;
-   attendance geofencing;
-   leave.

Acceptance:

Person can:

-   see today's rules;
-   check in;
-   check out;
-   request WFH and see its approval state;
-   request leave.

An actor with the corresponding configurable permission can:

-   review leave;
-   manage holidays;
-   review WFH requests;
-   recover attendance.

------------------------------------------------------------------------

## Phase 3 --- Client work

Backend/domain work is primary in this phase. Build and verify the
canonical client/work/task/assignment model and API before expanding the
client-work UI.

Foundation status: the client/work foundation is implemented through migration
0041 and the API. It includes clients, client departments, effective-dated
client membership, client and organisation workstreams, groups, tasks,
assignments, reviewer selection, review submission/decision cycles, a
permission-scoped pending-review queue, targetable role scopes, RLS,
organisation checks, concurrency locks, task/assignment cancellation and
reassignment, protected reviewer exceptions, atomic self-assignment,
reviewer requests/replacement, two-sided assignment handover, explicit
review-vs-policy resolution provenance, work sessions and audit events.
The Admin console provides a small operational Client Work slice for creating
contexts, tasks and assignments. The employee Work page now also presents only
task-creation targets allowed by the actor's effective `tasks.create` and
`tasks.view` grants/scopes, with task creation and creator self-assignment
performed through the existing authorized API path; client review requirements
remain in force. This slice has an isolated PostgreSQL/API lifecycle smoke, but
is not yet a broad visual/UI implementation. Broader Team, People, Calendar and
reporting surfaces remain additive.

Build:

-   clients;
-   client departments;
-   client membership;
-   groups;
-   tasks;
-   assignments;
-   reviewers.

Acceptance:

Authorised user can:

-   create client;
-   create client department;
-   create group;
-   create task;
-   assign people;
-   select reviewer.

------------------------------------------------------------------------

### Phase 4 attendance-mode requirement

The unified timeline implementation must work with both supported
attendance modes:

-   hour-based attendance;
-   scheduled attendance.

Both modes use the same timeline component and the same chronological
projection of attendance and work records.

Mode-specific behaviour belongs to attendance interpretation:

-   scheduled mode may show late arrival, early departure, scheduled end
    and after-hours states;
-   hour-based mode shows actual duration and required duration without
    deriving schedule-relative lateness;
-   task/work events are rendered in the same timeline in both modes;
-   timeline correction is performed from the same timeline in both
    modes.

Do not build separate attendance-timeline and task-timeline components
that users must reconcile.

## Phase 4 --- Work timer + unified timeline

Foundation status: productive work-session start/pause/stop/resume, overlap
protection, lifecycle/business-boundary closure, attendance/leave timer
interlocks, server timestamp precision, auditable past-only self
timeline adjustment, untracked-gap/outside-attendance exception projection
and the unified timeline read projection are implemented through migration
0035 and the API. Authorised administrative adjustments are available through
the same command boundary; the Work page now exposes the timer, review,
timeline and permitted correction slice.

Build only the smallest complete slice:

1.  work eligibility;
2.  start;
3.  pause;
4.  resume;
5.  stop;
6.  concurrency protection;
7.  business-day boundary;
8.  unified timeline;
9.  gap detection;
10. timeline adjustment permission;
11. self-adjustment UI;
12. audit.

Acceptance tests:

-   hour-based attendance + unified timeline;
-   scheduled attendance + unified timeline;
-   attendance and task events remain one chronological timeline in both
    modes;
-   scheduled lateness appears only when scheduled attendance is
    configured;
-   hour-based attendance does not invent lateness or early departure;
-   timeline correction works from an untracked gap in both modes;
-   duplicate start;
-   two tabs;
-   attendance-required employee;
-   attendance-independent employee;
-   frozen employee;
-   leave;
-   holiday;
-   multi-day task;
-   midnight;
-   untracked gap;
-   past-only adjustment;
-   future adjustment rejection;
-   overlapping adjustment rejection;
-   adjustment audit;
-   adjustment UI disappearing after correction.

------------------------------------------------------------------------

## Phase 5 --- Reviews

Foundation status: assignment submission, approve, changes-requested,
immutable review-cycle history, the permission-scoped pending-review queue,
reviewer request/replacement and unavailable-reviewer handling, explicit
policy completion provenance and the protected reviewer-exception workflow are
implemented through migrations 0034, 0037, 0038 and 0051 and the API. The Work
page exposes the first review queue and decision slice; dedicated review
reporting remains additive.

Build and verify the review domain/API before building a broad review
UI.

Build:

-   submission;
-   queue/query contract;
-   approve;
-   return / Changes Requested;
-   review cycles;
-   reviewer permissions;
-   approval timing;
-   multiple-assignee aggregation;
-   concurrency protection;
-   reviewer-change behaviour;
-   cancellation/reassignment edge cases;
-   audit/history.

Acceptance:

-   reviewer cannot approve own assignment;
-   return preserves history;
-   approval preserves sessions;
-   assignment lifecycle remains correct.

------------------------------------------------------------------------

## Phase 6 --- People lifecycle

Foundation status: onboarding, freezing, offboarding, two-sided assignment
handover and history-preserving reassignment are implemented. Offboarding is
handover-first: unresolved
active task assignments must be reassigned or closed before the lifecycle
transition can commit.

Permission-window checks now resolve through the actor or target person's
effective office business date rather than database-server `current_date`.

Build:

-   onboarding;
-   notice;
-   offboarding;
-   handover;
-   freezing;
-   historical preservation.

Acceptance:

An exiting person's active work can be handed to another eligible person
without rewriting historical ownership.

------------------------------------------------------------------------

## Phase 7 --- Operations UI

Foundation status: the authenticated Operations surface now exposes a
permission-filtered Team/People detail view, Client Work and review queue
detail, calendar/holiday detail, basic counts and CSV exports. It remains a
read/presentation layer over canonical backend state; it does not create a
second reporting source of truth.

Build:

-   My Day;
-   Team;
-   People;
-   Client Work;
-   Review Queue;
-   Calendar;
-   basic reporting and permission-filtered CSV export.

All screens use canonical backend state.

------------------------------------------------------------------------

## Phase 8 --- Payroll

Build only after attendance, leave and time are stable.

Build:

-   employment terms;
-   compensation;
-   payrun;
-   deterministic calculation;
-   exceptions;
-   permitted adjustments;
-   lock;
-   export.

------------------------------------------------------------------------

## Phase 9 --- Deployment hardening

The initial verification snapshot below is archival and predates the follow-up
portability correction; its test counts, load measurements and HTTPS email
capability are superseded by the latest evidence in `docs/runtime-smoke.md`.
The updated provider model is:
HTTPS runtimes use Gmail's send-only API adapter and Resend; SMTP and console
remain Node-only. Synthetic delivery and OAuth setup checks are recorded in the
verification matrix. Live Google consent and message delivery remain unverified.
The repeat PostgreSQL gate then passed all 74 migrations, 53 rollback/RLS
fixtures, 604 lifecycle assertions by default and 2,414 in the 100-employee
burst; latest burst p95 measurements are maintained in `docs/runtime-smoke.md`.

Local foundation status (verification snapshot 2026-09-26): the repeatable QA
profile passed end to end on PostgreSQL 17 in WSL Docker. It applied migrations
0001–0074, passed all 53 rollback/RLS fixtures and 604 authenticated lifecycle
assertions, including creation/readback of an Employee starter role with exact
grants and operational policy, rejection of a targetless HR starter without a
partial role, synthetic Gmail OAuth PKCE/replay/expiry and credential
preservation checks, concurrent role-revision edits, due-date reminder
invalidation, role revocation/regrant, WFH provisional-timer freeze and
approval/cancellation races, archived-context filtering and rejection of new
group/task writes and billing-policy reads/writes beneath archived clients,
workstreams or groups without partial policy changes, automatic workstream-default and per-definition
classification, independent billable-action authorization, correction/source
independence and immutable billing provenance. Specialized WFH,
attendance/leave/geofence smoke passed as well. The 100-employee one-shot burst
passed with 2,414 lifecycle assertions; latest p95 values were 2,577.7 ms for
work-context reads, 531.1 ms for task creation/self-assignment, 664.2 ms for
timer start, 324.1 ms for timer stop, and 289.1 ms for assignment reads. The
HTTPS email runtime advertises Resend only and rejects unsupported Gmail setup
before persistence; Node runtime provider choices include Console, SMTP, Gmail
OAuth2 and Resend. The burst verified 100 tasks, assignments and closed timers
with zero open timers. This
does not establish sustained multi-office capacity or an SLA.
Preflight returned `ready`; it verified all 74 migrations and that `nova_app`
owns no NOVA objects and cannot assume object-owner or privileged roles.
Migration 0062 preserves cancelled
assignment history while allowing an explicit A→B→A return handover to create
a new record; a partial unique index and API conflict handling prevent two
active assignments for the same person/task under concurrent handovers. The
`bun run qa:postgres` entry point uses a unique Compose project and private
QA-only PostgreSQL service; the passing run removed only its generated database
and label-matched resources, leaving the shared `nova` database and volume
untouched. A separate customer-style full Compose deployment against an
isolated direct-PostgreSQL volume applied all 74 migrations; health/readiness,
the home page and shared `app.js` returned 200. `nova_app` was neither
superuser nor `BYPASSRLS`, and also lacked `CREATEDB`/`CREATEROLE`; invalid and
unselected-provider tick requests returned 401/409, while the selected local
`vps` tick returned 200. The browser completed synthetic founder setup,
public-origin capture, verification request and one-time handoff reveal. The
browser client blocked opening the verification API URL, so browser callback
completion is not claimed; the authenticated API lifecycle covers it. The
synthetic account, container, network and volume were removed. These are local
direct-DB tests, not an internet-facing VPS deployment. The designated
disposable Supabase Cloud project passed transaction-pooler app-role login,
migration-ledger preflight through 0074, API health/readiness and
database-backed Better Auth throttling; its full authenticated domain
lifecycle and a live scheduler were not tested. Live Cloudflare/Netlify/Vercel
deployments, sustained load, native-Windows PostgreSQL, VPS
installation/recovery and full authenticated browser/accessibility testing
remain release gates. API health/readiness and public secret-free
deployment/entry screens were checked locally. Authenticated browser evidence
also includes manual invitation, handoff and onboarding, role create/edit,
billing-policy/task administration, eligible assignment with a distinct
reviewer, and due-date editing; complete employee-originated Work/HR/task
journeys are not claimed. See the verification matrix for
exact evidence boundaries.

Support:

``` text
Supabase Cloud + Cloudflare Worker (primary)
+
Supabase Cloud + Netlify/Vercel Functions (compatible)
+
Direct/self-hosted PostgreSQL + NOVA VPS deployment (portable later path)
```

The same domain rules must operate in both.

------------------------------------------------------------------------

# 64. Testing strategy

Testing is risk-weighted.

Do not build a giant test framework before it is needed.

Every sensitive state machine gets focused runnable checks.

## Backend / API

-   command contract validation;
-   direct API invocation without the frontend;
-   authorization at write time;
-   deterministic domain errors;
-   retry/idempotency behaviour where applicable;
-   concurrent mutation behaviour;
-   canonical state transition enforcement;
-   no duplicate source of truth for the tested rule.

## Portability

-   core domain does not require Supabase client objects;
-   critical invariants do not depend on Supabase Realtime;
-   migrations work against the supported PostgreSQL target;
-   RLS policies are exercised against PostgreSQL independently of
    Supabase wherever practical;
-   each supported deployment can supply the same provider-neutral
    database request context required by applicable RLS policies;
-   provider-specific identifiers do not leak into canonical domain
    semantics;
-   infrastructure adapters can be replaced without rewriting the domain
    rule being tested;
-   the same API/domain workflow can run in the VPS deployment shape.

## Security

-   cross-organisation access;
-   authentication throttling uses Better Auth's database-backed PostgreSQL
    rate-limit store so sign-in, registration, verification and password
    recovery limits remain consistent across serverless instances;
-   RLS row visibility and denial for the applicable database role;
-   a row visible through RLS but rejected by NOVA action authorization;
-   accidental RLS bypass through an owner/superuser-style application
    role;
-   permission bypass;
-   frozen account;
-   impersonation attempts.

## Attendance

-   duplicate attendance;
-   holiday;
-   leave;
-   WFH;
-   recovery;
-   timezone boundary.

## Work

-   duplicate timer;
-   concurrent tabs;
-   invalid assignment;
-   attendance required;
-   attendance not required;
-   midnight;
-   multi-day work.

## Timeline

-   gap detection;
-   overlapping sessions;
-   overlapping adjustment;
-   future adjustment;
-   invalid assignment;
-   unauthorized adjustment;
-   correction audit;
-   corrected gap no longer actionable;
-   timeline projection matches canonical records;
-   attendance and task records are not duplicated merely for timeline
    display;
-   the same timeline remains valid under both attendance modes.

## Reviews

-   self-review;
-   unauthorized reviewer;
-   returned cycle;
-   approved cycle;
-   multiple assignees with independent reviewers and outcomes;
-   one assignment approved while another is still awaiting review;
-   one assignment approved while another receives Changes Requested;
-   approved assignment remains approved when another assignment is
    returned;
-   approval elapsed time is calculated from server submission/decision
    timestamps;
-   review waiting time is not added to productive work time;
-   duplicate concurrent review decisions produce one authoritative
    result;
-   stale reviewer permission/state is rejected at write time;
-   reviewer becomes unavailable before decision and cannot silently
    self-approve or auto-replace;
-   assignment cancellation during review prevents a later normal
    decision;
-   task cancellation resolves active assignments without deleting
    historical reviews;
-   reassignment after approval creates a new assignment without
    transferring approval history;
-   long-waiting or overdue review does not auto-approve.

## Payroll

-   invalid input;
-   deterministic calculation;
-   historical snapshot;
-   locked payrun mutation.

------------------------------------------------------------------------

# 65. Definition of done

A feature is complete when:

-   the business rule is documented;
-   the canonical domain owner is clear;
-   the database state and applicable invariants are correct;
-   permissions are enforced server-side at write time;
-   transaction/concurrency behaviour is correct;
-   the API/command contract is explicit and documented;
-   domain errors are deterministic and actionable;
-   focused verification exists where logic is non-trivial;
-   audit/history requirements are satisfied;
-   portability boundaries remain intact;
-   no duplicate source of truth or parallel business-rule
    implementation was introduced;
-   the UI consumes the canonical backend rather than reimplementing its
    rules;
-   UI works sufficiently to exercise the real workflow;
-   documentation is updated in the same change;
-   the feature works through the real user workflow.

UI polish, comprehensive visual systems and broad screen coverage are
not required for backend/domain completion unless they are necessary to
validate the workflow.

------------------------------------------------------------------------

# 66. Repository shape

Start small.

``` text
/
├── web/
│   └── src/
│       ├── app/
│       ├── features/
│       │   ├── people/
│       │   ├── attendance/
│       │   ├── leave/
│       │   ├── clients/
│       │   ├── work/
│       │   ├── reviews/
│       │   └── payroll/
│       └── lib/
│
├── server/
│   └── src/
│       ├── commands/
│       ├── auth/
│       └── integrations/
│
├── database/
│   ├── migrations/
│   └── tests/
│
├── docs/
│   ├── PRD.md
│   ├── product-rules.md
│   ├── api-contract.md
│   └── decisions/
│
├── docker/
└── README.md
```

Do not create global:

``` text
services/
repositories/
factories/
managers/
utils/
```

unless real reuse proves the abstraction useful.

------------------------------------------------------------------------

# 67. Error philosophy

Errors must be explicit and actionable.

Examples:

``` text
ATTENDANCE_REQUIRED
WFH_NOT_ALLOWED
LEAVE_WFH_CONFLICT
ATTENDANCE_RECOVERY_WINDOW_INVALID
ATTENDANCE_RECOVERY_INPUT_INVALID
HOLIDAY
LEAVE_APPROVED
ACCOUNT_FROZEN
WORK_NOT_ASSIGNED
REVIEWER_NOT_ELIGIBLE
SELF_REVIEW_NOT_ALLOWED
SESSION_ALREADY_RUNNING
TIMELINE_OVERLAP
FUTURE_ADJUSTMENT_NOT_ALLOWED
TIMELINE_ADJUSTMENT_NOT_PERMITTED
PAYRUN_LOCKED
```

Do not expose raw database errors.

Do not make the frontend infer business rules from generic failures.

------------------------------------------------------------------------

# 68. Analytics

Start with queries over canonical records.

Initial metrics:

-   people count;
-   working now;
-   WFH;
-   leave;
-   attendance exceptions;
-   active tasks;
-   overdue tasks;
-   awaiting reviews;
-   productive time;
-   expected time;
-   untracked time;
-   timeline exceptions;
-   department capacity.

Only add materialized views when actual query performance demonstrates
the need.

------------------------------------------------------------------------

# 69. Realtime

Do not make everything realtime.

Start with:

-   command response;
-   explicit refetch;
-   polling only where justified.

Add realtime only where a measured workflow benefits materially.

------------------------------------------------------------------------

# 70. Background jobs

The canonical scheduled contract is `POST /api/internal/background/tick`,
protected by the deployment-only `NOVA_BACKGROUND_JOB_SECRET`. Every adapter
invokes this same tick; no provider owns separate domain logic. It performs
office-local attendance closure before work-session closure, then reminder,
notification and retention maintenance. Only add scheduled execution for
concrete requirements:

-   office-local midnight attendance and work-session closure;
-   expiry of reviewer/handover requests and unavailable-reviewer
    reconciliation;
-   notifications;
-   recurring maintenance;
-   payroll jobs.

Critical scheduled maintenance must not depend on a page being open.

------------------------------------------------------------------------

# 71. Migration strategy

The existing implementation is a reference.

Migration:

1.  define the new model;
2.  map legacy fields;
3.  dry-run;
4.  validate;
5.  import only required active data initially.

Do not automatically carry forward:

-   legacy project/task structures;
-   duplicate timesheet systems;
-   old calendar engines;
-   compatibility RPC aliases;
-   client-side workflow orchestration;
-   dynamic SQL patches.

Historical migration happens only when a concrete legal, business or
reporting requirement justifies it.

------------------------------------------------------------------------

# 72. Decisions and implementation gates

The original unresolved list is replaced by explicit product decisions
where a safe V1 rule can already be established. Remaining decisions are
classified by when they are actually needed.

## 72.1 Resolved before schema

### Payroll boundary decision

The product decision is:

> Preserve payroll-relevant facts, configuration and historical context
> in core NOVA from V1, but implement payroll calculation and payment
> as a separate later module.

The boundary must be testable: a future Payroll module should be able to
consume the canonical historical records without requiring changes to
the core schema.

Example boundary test:

``` text
Person
  -> Department transfer mid-period
  -> Compensation change with effective date mid-period
  -> Attendance / leave / approved adjustments
  -> Payroll-relevant role and policy configuration
        |
        v
Future Payroll module
        |
        v
Period-specific payroll inputs
```

The future module may add its own payrun/payroll tables and logic. It
must not need to alter the meaning of core historical records.

These are now product rules and must not be reopened casually during
implementation:

1.  Reviewer is per assignment, not per task.
2.  Each submission requiring review creates one review cycle, and each
    review cycle can receive at most one authoritative decision.
3.  Task-level Approved is an aggregate condition over required active
    assignments, not an independent approval record.
4.  One assignment's approval never approves another assignment.
5.  Approved assignments remain approved when another assignment on the
    same task is returned, unless explicitly reopened.
6.  Review/approval elapsed time is calculated from server-authoritative
    submission and decision timestamps and is not productive work time.
7.  A long-waiting or overdue review never auto-approves.
8.  Reviewer authority is revalidated at write time, and concurrent
    review decisions on one cycle resolve to one authoritative outcome.
9.  A task may provide a default reviewer suggestion, but assignment
    reviewer is authoritative.
10. Review history snapshots the reviewer for each review cycle.
11. If no eligible reviewer exists, submission is allowed but review is
    blocked until an authorised Super Admin assigns an exception
    reviewer.
12. Self-review is not allowed in V1.
13. Permissions are evaluated at write time.
14. A running work session is closed at the effective timestamp when an
    account is frozen/offboarded or its assignment is cancelled.
15. Reassignment creates a new assignment and never transfers historical
    work ownership.
16. Historical adjustments retain immutable references to their original
    assignment/person/context.
17. Leave supports full-day and half-day entries in V1; arbitrary hourly
    leave is deferred.
18. Compensation uses explicit effective dates.
19. Payroll follows effective-dated historical employment/department
    context rather than the person's current department.
20. Attendance has a database-enforced single active record/state per
    person and business date.
21. Permission composition uses explicit precedence and does not use
    arbitrary expression trees.
22. Attendance, leave, WFH and calendar changes use one shared
    availability reconciliation policy.
23. Client Workstream and Organisation Department are distinct domain
    concepts and must not share ambiguous semantics.

## 72.2 Resolve before V1 feature implementation

### Required implementation tests for the resolved rules

Before the relevant features are considered complete, test at least:

1.  A client attempts to backdate an automatic freeze closure and the
    server rejects the supplied timestamp.
2.  A freeze occurs while a timer is running and the server closes the
    session using the authoritative effective timestamp.
3.  A Super Admin grants an exception reviewer and the audit contains
    both the failed eligibility condition and the mandatory reason.
4.  A user with own-record edit plus department view-only can edit only
    records permitted by the own-record action scope.
5.  A user with broad edit permission is still rejected when attempting
    to mutate a locked/finalized record.
6.  A reviewer with assigned-work scope cannot mutate unrelated work
    merely because they can view the surrounding department/client.

These are bounded product details that must be specified before the
corresponding feature is built, but do not block the entire domain
schema:

Current NOVA V1 decisions (implemented where the corresponding slice exists):

-   historical attendance recovery is limited to 31 prior business days;
-   automatic lifecycle closures use server timestamps only and cannot be
    backdated by clients;
-   work sessions may be corrected only through a separate future audited
    timeline-adjustment command; timer-backed records are never silently
    edited;
-   a role requiring attendance must have an open attendance record before
    productive work can start;
-   location evidence is retained for 90 days by default and then purged by
    the portable maintenance function; audit history is retained separately;
-   the current V1 role catalogue and allowed scope catalogue are canonical
    in PostgreSQL and exposed to the role editor.

1.  exact permission catalogue;
2.  exact role capability matrix;
3.  person-level override cases;
4.  maximum historical adjustment window;
5.  adjustment rules after clock-out;
6.  exact treatment of adjusted work when attendance is required;
7.  WFH policy eligibility and WFH approval are separate: effective-dated
    person/department/office overrides plus role policy determine eligibility,
    and an approved date-range request is required before WFH attendance;
8.  attendance geofencing is office-specific, server-checked and stores only
    minimum decision evidence; WFH does not silently use an office geofence;
9.  holiday/calendar transitions close only affected open attendance,
    preserve the source row, and expose an actionable Historical Exception;
10. leave/attendance recovery is explicit: approve or reject the leave while
    preserving attendance, requiring a note and audit record;
11. exact overtime calculation rules (deferred to the Payroll module);
12. department-specific payroll period configuration (deferred to the Payroll
    module);
13. first V1 payroll formula and supported compensation components (deferred
    to the Payroll module);
14. offboarding-specific handover checklist and any required approvals beyond
    the implemented assignment handover request/acceptance flow (the
    status/session closure path is implemented; policy-specific offboarding
    orchestration remains a later slice);
15. organisation-specific retention periods beyond the documented 90-day
    location-evidence default.

Each item must be recorded as a product decision before its
implementation phase starts. It must not become an accidental default in
code.

## 72.3 Explicitly deferred

These are intentionally outside the initial implementation unless a
concrete requirement promotes them:

-   arbitrary hourly leave;
-   universal statutory/multicountry payroll;
-   arbitrary permission expression languages;
-   microservices/event-bus architecture;
-   generic workflow engines;
-   automatic reviewer assignment based on opaque heuristics;
-   historical rewriting of assignments or work ownership;
-   cross-company shared client workstreams;
-   complex resource-capacity planning;
-   unrestricted custom entity builders.

## 72.4 Schema-readiness gate

### Additional schema-readiness checks

The schema must provide enough structure to support:

-   server-generated effective timestamps for automatic lifecycle
    events;
-   audit records explaining reviewer exceptions, including failed
    eligibility context and reason;
-   write-time permission evaluation rather than reliance on
    client-cached role state;
-   immutable/locked-state enforcement;
-   explicit scope relationships for own-record, department, client and
    assigned-work permissions.

Before creating the first production schema, the implementation must be
able to produce a compact domain map showing:

``` text
Entity
Purpose
Parent/scope
Canonical name
References
Inherited context
Permissions
Historical behaviour
Lifecycle
```

For every foreign key, the implementation must be able to state why the
relationship exists.

For every ambiguous legacy name, such as `department_id`, the actual
domain meaning must be identified before the column is reused.

The schema must not be designed from UI labels alone.

# 73. Initial success criteria

NOVA is successful when:

-   a new engineer can understand the domain quickly;
-   there is one canonical model for client work;
-   organisation work remains separate from client work;
-   people have configurable operational roles;
-   attendance and work are shown together without falsely treating them
    as identical;
-   the unified timeline makes the day understandable;
-   real timeline gaps and exceptions are visible;
-   authorized employees can correct eligible past work themselves;
-   Super Admin controls whether that correction capability exists;
-   corrections are past-only and audited;
-   work eligibility handles attendance-dependent and independent roles;
-   multi-day work behaves correctly;
-   midnight does not create invalid time;
-   reviewers are explicitly selected;
-   review history is preserved;
-   holidays and leave correctly affect availability;
-   offboarding preserves history;
-   payroll consumes trusted historical inputs;
-   Supabase Cloud is the first hosted database path without entering
    canonical domain semantics;
-   the same system can run on a VPS with direct PostgreSQL;
-   the product remains understandable without a large abstraction
    framework.

### Implementation guardrails

The implementation must preserve the same canonical discipline used by
the product rules. These guardrails describe how the building agent must
implement the frozen product rules without silently creating competing
behaviour.

#### Single canonical implementation

Before adding logic that resembles an existing business rule, locate the
existing implementation and reuse or extend it. Do not create a parallel
implementation merely because a new caller has a slightly different
workflow.

A business rule should have one canonical implementation path. Callers
should invoke that path rather than independently re-deriving the rule.

Examples include:

-   lifecycle-driven work-session closure;
-   reviewer eligibility and assignment;
-   permission evaluation at write time;
-   historical timeline correction;
-   availability reconciliation.

At the end of every implementation session, check whether a newly
implemented rule now exists in more than one place. If so, consolidate
it unless the different paths are intentionally different and that
distinction is explicitly documented.

#### Authoritative invariant enforcement

Frontend validation and service-layer checks may provide early feedback,
but they are never the sole enforcement mechanism for a listed
invariant.

Each invariant must be enforced at the appropriate authoritative trust
boundary. Where an invariant is representable as a database constraint
or transactional database rule, PostgreSQL must enforce it. Server-side
authorization and domain rules remain authoritative where they cannot be
expressed as database constraints.

Concurrent requests and direct API calls must not be able to bypass an
invariant by skipping frontend checks.

#### Server-authoritative lifecycle operations

Automatic lifecycle transitions must use the canonical operation for the
transition rather than allowing each caller to calculate its own result.

Freeze, offboarding, task/assignment cancellation and other lifecycle
paths must use the same canonical work-session closure operation defined
by §31. Callers must not supply an arbitrary historical closure
timestamp.

#### Assignment-owned reviewer authority

Reviewer authority belongs to the assignment.

A task-level reviewer, if present, is a creation-time suggestion only.
It must not be read later as the authoritative reviewer for submission
or review decisions.

Reviewer eligibility must be evaluated against the assignment, current
permissions, applicable scope and current state.

#### Write-time authorization

Permissions and operational policy are evaluated against authoritative
server state at the moment of the mutation.

Do not treat a permission set cached at login or in an already-open
browser session as authoritative for later writes. A revoked permission
must stop authorizing the next sensitive mutation without requiring a
new login.

#### Decisions are implementation gates

§72 is a live implementation checklist.

-   §72.1 decisions are frozen and must be implemented as written.
-   §72.2 decisions must be explicitly resolved before the corresponding
    implementation begins.
-   Do not silently choose a default when a §72.2 decision has not been
    resolved.
-   §72.2 required implementation tests are part of feature completion.
-   §72.3 items are explicitly deferred and must not be built merely
    because they appear small or convenient.
-   §72.4 schema-readiness checks must be satisfied before schema work
    is treated as complete.

### Database and function design follow the same engineering law

The **smallest correct implementation** rule applies equally to
PostgreSQL schema design, database functions, SQL queries, API/domain
functions, and other backend primitives.

Database design must optimize for correctness, integrity, security,
maintainability, portability, and minimal unnecessary complexity
together.

Rules:

-   Keep one authoritative source of truth for each domain fact.
-   Prefer database-enforced constraints for invariants naturally
    representable at the database boundary.
-   Prefer atomic database transactions/functions for state transitions
    that must be indivisible.
-   Keep database functions focused on real domain operations; do not
    create functions for trivial CRUD without a concrete reason.
-   Do not duplicate the same business rule across SQL functions,
    triggers, API handlers, and frontend code.
-   Use triggers only when the invariant or side effect genuinely
    belongs at the database boundary; do not turn triggers into a
    general workflow engine.
-   Prefer simple relational structures over premature generic or
    EAV-style designs.
-   Avoid unnecessary tables, columns, indexes, views, materialized
    views, triggers, stored procedures, and dependencies.
-   Add indexes when query/write behaviour or an established access
    pattern justifies them; do not index everything speculatively.
-   Use foreign keys, unique/check constraints, exclusion constraints,
    and transactional locking where they provide meaningful integrity
    guarantees.
-   Never rely on frontend validation for database integrity.
-   Do not rely solely on application checks for invariants PostgreSQL
    can safely enforce.
-   Keep authorization and sensitive action checks at the authoritative
    API/domain boundary, with database enforcement where appropriate.
-   Sensitive state-transition functions must behave safely under
    realistic retries and concurrency.
-   Prefer idempotent commands where duplicate delivery or retry is a
    realistic operational possibility.
-   Do not hide important domain behaviour inside opaque SQL that future
    maintainers cannot reasonably understand.
-   Do not move domain logic into PostgreSQL merely to reduce
    application LOC; choose the boundary that gives the clearest and
    safest overall design.
-   Conversely, do not move database integrity rules into application
    code merely for convenience when PostgreSQL can enforce them
    reliably.
-   Schema names, function names, parameters, return values, and error
    semantics must use canonical NOVA terminology.
-   PostgreSQL capabilities are acceptable even when Supabase is the
    first deployment target; avoid unnecessary dependence on
    Supabase-only behaviour.
-   Supabase RPC is an exposure/adapter mechanism, not the definition of
    NOVA's domain semantics.
-   Every schema/function decision must consider self-hosted PostgreSQL
    portability without requiring a domain rewrite.
-   Prefer reversible/additive migrations when practical; destructive
    changes require explicit migration planning and historical-data
    consideration.
-   Remove dead schema, duplicate columns, obsolete compatibility
    layers, and unused abstractions deliberately once their dependencies
    are understood.
-   Schema changes must preserve historical integrity and existing
    invariants. A migration is incomplete if it leaves historical
    records ambiguous, orphaned, or silently reinterpreted.

The target is:

> **The smallest database and backend design that enforces the required
> rules correctly and remains understandable, secure, maintainable, and
> portable.**

#### Session-to-session context discipline

At the start of every implementation session:

1.  Read the current schema/model before modifying it.
2.  Check the canonical glossary before introducing or reusing domain
    terms.
3.  Map existing names and relationships before changing them.
4.  Do not infer the meaning of an existing field from its name alone.
5.  Treat ambiguous fields such as `department_id` as requiring explicit
    classification before use.
6.  Re-read the relevant frozen decisions and invariants before changing
    a sensitive domain area.

At the end of every implementation session:

1.  Record any newly established domain decision in this PRD.
2.  Record any new constraint or edge-case resolution that changes
    product behaviour.
3.  Do not leave domain knowledge only in code comments or commit
    messages.
4.  Check for duplicate business logic introduced during the session.

The current PRD and canonical glossary remain the source of truth across
implementation sessions.

#### Vertical-slice implementation order

Build NOVA one real workflow at a time, with backend/domain work
completed before broad UI work:

1.  business rule;
2.  canonical domain behaviour;
3.  database model and invariant;
4.  command/API contract;
5.  authorization, policy and concurrency checks;
6.  focused verification;
7.  documentation;
8.  minimal UI;
9.  real workflow validation.

Do not create every database table before validating real workflows.

Do not build a generalized permission framework, abstraction layer or
other large infrastructure solely in anticipation of future workflows.
Extend the smallest structure that the validated workflow actually
requires.

#### Minimum custom code

Follow the Ponytail principle when implementing:

1.  ask whether the code needs to exist;
2.  reuse an existing implementation when appropriate;
3.  prefer the standard library or native platform capability;
4.  use an existing dependency when it genuinely fits;
5.  prefer the shortest implementation that remains correct and
    maintainable;
6.  add custom abstraction only when the real workflow demonstrates the
    need.

Do not simplify away trust-boundary validation, security, data-loss
handling, accessibility or correctness merely to reduce code.

#### Focused verification

For non-trivial domain logic, leave at least one runnable focused
verification for the rule being introduced or changed.

Tests must exercise the authoritative path, not merely the UI state that
is expected to appear.

Concurrency-sensitive rules must be tested against concurrent attempts
where the rule depends on atomicity.

Past-only, write-time authorization and lifecycle rules must be tested
at the server/transaction boundary, not only through frontend behaviour.

#### Portability guardrail

Keep the domain and API independent from deployment-provider details.
Supabase may provide authentication, storage, realtime and convenient
deployment capabilities, but those capabilities must enter NOVA
through replaceable infrastructure boundaries. PostgreSQL-specific
correctness is intentional; Supabase-specific correctness is not.

A portability check is required whenever a new dependency is introduced:

1.  Is this dependency a domain requirement or an infrastructure detail?
2.  If infrastructure, can the domain remain unchanged when the provider
    changes?
3.  Does the feature still preserve correctness on the VPS target?
4.  Does it introduce a provider-specific identifier or data model into
    canonical records?

Do not prematurely build abstractions for every theoretical provider.
Create only the boundary required to keep the actual domain portable.

#### Backend-first guardrail

Do not use UI state as proof that a feature works. Verify the
authoritative command/API, database transaction and invariant directly.
The frontend is a consumer and presentation layer, not the canonical
business-rule engine.

#### One-line building-agent rule

Implement each business rule once at the authoritative backend boundary,
verify it there, document the contract, keep provider-specific details
at the edge, stop at unresolved decisions instead of silently
defaulting, and build only the UI needed to exercise the real workflow.

------------------------------------------------------------------------

# 74. First implementation task

Do **not** start by creating every database table or building the UI.
Start by establishing the canonical backend/domain foundation and one
real vertical slice.

First create:

``` text
docs/product-rules.md
```

Freeze:

1.  actors;
2.  organisation vs client departments;
3.  role model;
4.  permission model;
5.  operational capabilities;
6.  attendance eligibility;
7.  work eligibility;
8.  unified timeline semantics;
9.  timeline exception types;
10. timeline adjustment permission;
11. historical adjustment rules;
12. WFH;
13. leave;
14. holidays;
15. task lifecycle;
16. assignment lifecycle;
17. reviewer rules;
18. midnight rules;
19. offboarding;
20. payroll boundary.

Only after these rules are accepted should the first schema slice be
implemented.

------------------------------------------------------------------------

# 75. Guiding principle

NOVA should feel like one system because it **is one system**.

People are connected to work.

Attendance is visible alongside work.

Leave affects availability.

Clients contain work.

Assignments connect people to tasks.

Reviews connect to assignments.

Payroll consumes trusted historical facts.

The user should not have to understand the database model to use the
product.

The architecture should remain disciplined underneath the simple
experience.

The goal is:

> **One understandable timeline. Few clear concepts. Strong invariants.
> Controlled correction. Small commands. Portable infrastructure.**

And the engineering rule remains:

> **Build the smallest thing that is actually correct. Then use it. Then
> learn from reality. Then build the next thing.**

------------------------------------------------------------------------

# Canonical Domain Glossary

  -----------------------------------------------------------------------
  Term                    Meaning                 Scope
  ----------------------- ----------------------- -----------------------
  Organisation Department Person's primary        Organisation
                          functional membership   

  Client Workstream       Functional work area    Client
                          belonging to one client 

  Organisation Workstream Functional work area    Organisation
                          for internal work       

  Group/Campaign          Optional grouping of    Workstream
                          related tasks           

  Task                    Executable unit of work Workstream

  Work Assignment         Person-to-task          Task + Person
                          relationship            

  Work Session            Productive-time record  Assignment
                          for an assignment       

  Primary Department      Person's primary        Person
                          organisation membership 

  Work Context            Client/organisation     Task
                          workstream plus         
                          optional group that     
                          gives a task meaning    

  Daily Work Timeline     Unified chronological   User/day
                          projection of           
                          attendance and work     
  -----------------------------------------------------------------------

### Migration note

Earlier PRD terminology that uses **Client Department** for a
client-specific functional area should now be interpreted as **Client
Workstream**.

Earlier uses of **Department** for actual employee organisational
membership remain **Organisation Department**.

No schema migration should be performed from the name alone. First map
every existing relationship to its actual domain meaning.

------------------------------------------------------------------------
