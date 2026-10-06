# NOVA UI revamp: screen, component, and implementation blueprint

> **Historical blueprint:** Its implementation and styling status predates the visual reset. The design authority is [`planbyaman.md`](planbyaman.md), and current decisions and rollout gates are in [`nova-ui-replan.md`](nova-ui-replan.md). Revalidate any capability claims against current API routes and commands before reuse.

Historical status: implementation blueprint, 2 October 2026. Its screen proposals can inform review, but its product, permission, responsive, customization, and implementation decisions have been superseded by [`nova-ui-replan.md`](nova-ui-replan.md). Revalidate capability claims against current route/command sources.

The requested direction is a NOVA workspace with the content-first organization of a mature work tool and the precision, restraint, and interaction quality associated with Apple interfaces. Those are design influences, not templates to copy. NOVA keeps its own brand, black/green and white/green defaults, terminology, role system, and portable native web stack.

### Screenshot references and interpretation

The two user-provided screenshots are visual references, not product requirements or trusted UI copy. The COVENA dashboard is useful for its persistent grouped navigation, strong attendance focus, clear feature launch area, and deliberate control spacing. The Notion board is useful for page identity, multiple collection views, grouped toolbar actions, status columns, and scannable task cards. Preserve NOVA's approved green themes and Apple-inspired restraint; do not copy COVENA's violet brand, Notion's logo/content, or assume every referenced feature exists for every customer. Any shortcut, view, action, or feature must trace to an implemented route and the current actor's usable capability, then be hidden when unavailable. The screenshot's tile-heavy overview also does not replace the documented My Day priority of attendance/current state, next valid action, work, and the daily timeline.

The current inspected My Day fixture showed two empty modules with warning-colored messaging, and the Work form showed compact actions and a native select arrow. This slice corrects those component-level defects: ordinary no-record states now read as neutral empty states; My Day modules have a purposeful surface; compact buttons meet the 40px visual-control token; select triggers receive a consistent NOVA chevron, focus, hover, disabled, and theme treatment while retaining native selection behavior. The authenticated shell now uses a full-height identity/navigation rail, an explicit customization entry, and a content canvas; wide My Day includes role-filtered route shortcuts from the shared destination registry and personal navigation order, while smaller widths move those shortcuts below the day modules. The operating system still owns the opened native option picker by design; a bespoke searchable listbox is reserved for large selectors only after its volume and accessible interaction contract are established.

## 1. Source audit and the real gap

The repository already has the right product and permission decisions documented. The remaining gap is translating those decisions into a coherent set of screen compositions, shared UI ownership, and a staged migration that does not leave the implementation as one growing renderer.

Observed implementation state before this responsive foundation slice:

- At the inspected baseline, `web/app.js` measured 7,797 lines and owned the shell, routing, large page renderers, form events, and many domain flows. It remains the application host and still needs staged route ownership extraction. `web/styles.css` now acts as a 10-file ordered import entry; its CSS rules are organized under `web/styles/` by tokens, shared shell/controls, feature families, preferences, responsive rules, and accessibility.
- Appearance and workspace customization are persisted per person. Theme, accent, density, type scale, font choice, contrast, motion, surface, content width, navigation order, pins, home choice, My Day modules, and task views have separate allowlisted storage contracts. Preferences control presentation only; they never grant access.
- `web/features/work/saved-task-views.js` is now imported by the application and owns the Work saved-view controls and Settings saved-view list, including their local pending and feedback states. `web/features/attendance/recovery.js` owns the Operations recovery queue and audited correction form. `web/features/availability/agenda.js` owns date-range validation, event presentation, and paging. `web/features/people/people-directory.js` owns the filtered directory and person history. Each receives permission-planned data and narrow host callbacks; `app.js` retains API transport, routing, and server-backed commands. Server-side authorization remains authoritative. These are bounded component integrations, not completion of their routes' ownership.
- Work has the strongest current collection recipe. Task detail, saved views, and All visible task rows now live under `web/features/work/`; task rows use labeled client/workstream context and status/priority/due/assignment facts. The application host still owns authorized endpoints, query state, paging, and route links; Work remains the quality and permission baseline for the next collection extraction.
- The Operations screen no longer renders generic count cards from bounded reads. Its report sections are flatter, but the report composition and data lifecycle still live in the monolithic renderer and need feature ownership, explicit scope/freshness, and authoritative pagination before claiming complete totals or exports.
- The stylesheet has a token foundation, but page and component rules remain uneven and largely global. Font controls currently switch between external Inter CSS and device type; the requested NOVA font asset and confirmed Fastly origin are not present.
- The feature capability map must include migration 0077 and the personal task-view service. Its older “recovery is blocked” sentence is superseded by the bounded candidate read and Operations queue described in the 2 October follow-up.

These are source observations. The local browser preview uses synthetic API data, not authenticated backend evidence. A rendered Work pass has now been checked at 390, 768, 1024, and 1440 CSS pixels; the preview reports no child overflow at each width. Its empty-state fixture does not verify a populated task collection, every interaction, or assistive technology, so those remain separate checks.

Current implementation progress: the ordered CSS split, Vercel stylesheet and nested feature-module asset rewrites/tests, flatter desktop rail, compact-width drawer behavior, 44px coarse-pointer compact actions, divider-based record/Operations sections, and Work pilot modules are in place. Saved-view presentation/action feedback, All visible task-row composition, attendance recovery, the Availability agenda, People directory/history, and the Operations People report now have feature-owned components with narrow host callbacks. Work prioritizes assignments and the task collection before secondary queues. Synthetic browser fixtures were inspected at 390, 768, and 1024 CSS pixels for Operations, at 390 and 768 for the populated Availability agenda, and at 390 and 768 for People history; the viewport diagnostic reported no child overflow. Work was checked at 390, 768, 1024, and 1440. The current 1280px Operations fixture shows its People rows in a labeled two-column layout without child overflow. A theme audit found no hard-coded product colors outside semantic tokens; compact-density styling, Work container-query ownership, and repeated touch-height values have been aligned with their owners/tokens. Fixtures still do not verify authenticated grants, assistive technology, populated Work records, or all theme/customization combinations. Other Operations report compositions and feature ownership remain unfinished. Phase 1 remains open, and the licensed-font/Fastly-origin gate is still unresolved.

## 2. Product screen composition

Every signed-in destination uses the same clear sequence: workspace context → page identity and one useful sentence → local navigation or collection controls → records/actions → concise outcome feedback. Page-level records stay in the content surface; settings, navigation, and system status do not compete with them. Feature sections may use a quiet divider or a purposeful surface when the content is a form or a distinct decision. Do not wrap each row in its own card or repeat the same explanation in a title, card, and helper paragraph.

| Destination | Primary screen arrangement | Supported component families and constraints |
| --- | --- | --- |
| My Day | Page title/date; one dominant attendance/current-state area; next action beside it when space permits; assignments and one chronological day timeline below. At wide widths only, place route-level Quick access beside daily content; collapse it after the day modules on narrower screens. Keep attendance, work sessions, leave, and WFH as separately owned facts. | Attendance state/action, active-work summary, request actions, timeline rows, permission-aware module reorder/hide, and route shortcuts from the already-filtered shared destination registry. Shortcuts do not fetch feature data or expose individual actions. Never create a second combined source of truth. |
| Work | Collection title; Mine/All visible only when usable; saved-view selector; scoped search/filters; result count only when authoritative; compact task rows with client/workstream, status, due date, assignment facts; full-page detail and create/edit flow. | Collection toolbar, filter form, responsive record list/table, task context, permission-derived action group, review/collaboration disclosure. Assigned-work-only users receive only the narrow projection and controls allowed by their own assignments. |
| Reviews | Queue title and optional supported queue choices; visible pending items; decision form in the selected row/detail; reviewer-only context and history near the decision. | Review queue row, cycle/status, inline required feedback, stale-cycle recovery, request/handover queue only when each read and action is available. No peer roster from an unrelated endpoint. |
| People | Search/directory toolbar; legible people rows; detail route for profile/history; lifecycle actions beside the affected person and only after target/scope checks. | People row, profile facts, effective-dated history, invite/onboard/freeze/offboard stages. Current unpaged directory is a data-contract gap before promising complete large-directory search. |
| Availability | Separate request queues, date-bounded agenda, and authorized configuration sections. Filters and date/time-zone context precede the list. Team schedule and personal request flows remain distinct. | Request/review forms, calendar/agenda rows, per-source legend, effective-date configuration, exception/recovery row. Each source is gated by its own read/action capability. |
| Work setup / context | Client/workstream/group context explorer and reusable task definitions; billing-policy editor located with the scope it governs. Daily work remains separate. | Context breadcrumb/row, membership editor, catalog proposal/review, versioned policy form. Do not imply rates, invoicing, or payroll. Unpaged context/search remains a known API constraint. |
| Operations | Short title and scoped query controls. Show only source-backed report sections with freshness, scope, and loaded/complete status. Export next to the specific report. Recovery stays a separate, auditable queue. | Report filters, source status, bounded result list, scoped CSV action, recovery form. Remove synthetic KPI tiles unless a future read contract supplies meaningful authoritative metrics. |
| Settings | Personal account and Appearance/Workspace first. Organization, access, provider, handoff, delivery, and audit groups follow only when independently authorized. Use a short in-page contents list only when the page length warrants it. | Appearance preview, accessible setting groups, navigation/module order, saved-view management, conflict/retry/reset status. Personal vs organization scope is visible and persisted separately. |
| Public setup/auth/deploy | One focused task per route, narrow readable form column, progress only for actual multi-step setup, precise recovery and exit links. Keep secrets/tokens out of durable UI state. | Persistent labeled fields, inline field errors, bounded dialog/disclosure, stage status. Preserve invite/reset context after recoverable errors. |

Page-specific text remains concise. Operational pages use a 26–30px title rather than a marketing hero, 18–20px section titles, 14–16px body, and readable 12–13px metadata. Wide content is for collections and comparisons; forms and dense narratives keep a comfortable measure.

## 3. Component contract and visual system

Build a small purposeful kit after a component has a real use case. Share mechanics and styling; keep domain composition and rules with the owning feature.

| Shared family | Owns | Required states |
| --- | --- | --- |
| Workspace shell and navigation | Brand/context, permission-filtered navigation groups, active destination, unread badge, mobile drawer, account actions | Active, unavailable/refreshing permission state, unread, open/closed drawer, short viewport, focus entry/return |
| Page header and section heading | Title, optional scope/date, one supporting line, right-aligned primary action | Narrow wrapping, long title, absent description/action |
| Action button | Primary/secondary/quiet/destructive tiers, icon alignment, loading and disabled reason | Default, hover, visible focus, pressed, disabled, pending, destructive confirmation |
| Fields and form sections | Persistent label, hint/error association, required state, control geometry | Default, focus, invalid, disabled, pending, long value, date/time, forced colors |
| Collection toolbar | Saved view, query, filters, supported view switch/pagination | Empty permission set, saved filters, filter applied, clear, async result, narrow wrapping |
| Record list/table row | Semantic reading order, selected/focused distinction, contextual metadata, row actions | Comfortable/compact, keyboard focus, touch, long text, partial/error/empty states |
| Status and feedback | Semantic state label, local/region-level outcome, retry and conflict language | Success, warning, error, loading, stale, denied, empty, filtered empty, partial, unknown write outcome |
| Dialog/disclosure | Short confirmations and secondary detail without losing list context | Entry/exit focus, Escape, nested close order, safe-area, internal scroll, reduced motion |
| Preference group | Scope label, control, immediate preview, save state, reset appropriate to its scope | Saved, pending, conflict, storage failure, reset, role changes, narrow layout |

Use shared components for buttons, controls, status, focus, and overlay behavior. Do not build a universal data-grid, arbitrary schema-to-page generator, generic workflow engine, or wrapper that merely renames browser APIs. No icon-only control without a stable accessible name. Use one verified small SVG set or labelled text actions; never emoji or platform-dependent glyphs as product icons.

### NOVA visual tokens

- Retain the approved light white/green and dark black/green defaults and current semantic status families. Accent choices may alter accent-derived roles only; success/warning/danger/information keep their meaning.
- Keep a neutral canvas, readable solid content surface, neutral dividers, and green for primary action, focus, and selected meaning. Use elevation for overlays; hover does not invent elevation. Surface customization may tint grouping lightly but cannot lower contrast.
- Consolidate current `--nova-*` tokens for text/surface/status pairs, type roles, spacing, geometry, controls, overlay elevation, and motion. Existing aliases are a time-limited migration bridge, not a second system.
- Reuse exact type/space/radius/height values from `ui-design-plan.md` section 4.3, then tune through a rendered specimen. Keep 40px standard visual controls and 44px coarse-pointer targets even under compact density. Compact layout reduces row/section gaps, not type legibility or focus space.
- Every control gets consistent rest, hover, focus, pressed, disabled, and pending feedback. Motion stays brief, state-led, cancelable, and absent when reduced motion is requested.
- Font choice is an infrastructure gate: confirm the licensed NOVA font and Fastly service/origin, serve static WOFF2 with `font-display: swap`, preload only the primary subset, preserve the system stack, and test CSP/cache/fallback. Do not offer arbitrary user-supplied font URLs. Until this gate is met, describe Inter as the current fallback/source, not the finished brand type system.

## 4. Responsive behavior

Use the content-fit breakpoints and device matrix in `ui-design-plan.md` section 5 and 12.1. Media queries adapt the workspace shell; container queries adapt collections according to the width actually assigned to them. Avoid separate fixed “desktop mockup” and “mobile mockup” implementations.

| Content width | Shell | Page and records |
| --- | --- | --- |
| 320–639px | Compact brand/context row and explicit menu trigger; full-height drawer owns its scroll; safe-area padding; 12–16px page inset according to actual fit. | One content column; toolbar controls wrap or move into a labelled filter sheet; actions remain visible; multi-fact records stack into labelled rows; details become page/sheet without losing source filters or Back context. |
| 640–1023px | Drawer stays available; tablet landscape can use a compact rail only if measured width leaves a useful content area. | One column by default; two columns only for short independent panels with adequate width; forms reflow field-by-field; no forced desktop table overflow except intentional comparison tables with local scroll. |
| 1024–1279px | Persistent navigation rail when content can still hold its minimum measure; maintain header and content alignment. | Single-page detail by default; medium-density rows; no split inspector unless both panes meet their minimum widths. |
| 1280px+ | Stable rail plus centered/flexible content; allow personal collapse only if chosen and persisted locally. | Collections use aligned columns; two-column My Day/overview composition; inspectors only when their width and task require them; content width never stretches paragraphs/forms. |

Required visual viewport set: 320×568, 360×800, 390×844, 430×932, 768×1024, 820×1180, 1024×768, 1180×820, 1280×800, 1440×900, and 1920×1080; add short landscape and split-window resize. Test 200% text size, 400% zoom equivalent, forced colors, keyboard, touch, system dark/high contrast, and reduced motion. Emulation does not replace physical iOS/Android testing for safe area and virtual keyboards.

## 5. Feature boundaries and access composition

Feature visibility is derived from current effective grants plus a usable route/read/action. Do not create a frontend role-name catalogue: customers define roles. The destination registry may show a destination if one useful capability exists; within it, each tab, data request, component, and action must be gated by its own relevant read/write/target scope. API checks remain authoritative.

For each feature, maintain this trace before UI work:

`database relation/read model → API route and DTO → permission key + accepted scopes → UI section/component → action command + validation → audit/result state → tests`.

Do not show mutation-only screens whose prerequisite selectors/read model are unavailable. Do not fetch hidden feature data. Distinguish permission denied, permitted empty, failed read, partial result, stale record, and filtered-empty. A 401/403 after initial visibility clears affected protected data and selection, then refreshes current access. Commands are never hidden solely by visual settings, and saved filters never widen read scope.

The capability plan is backend-first: only existing usable reads/actions enter the initial screens. Known limits remain visible: People/work-context are unpaged, some operational lists have caps, exports represent loaded records, review queue is bounded, and payrun/payroll, task artifacts/attachments, and live capacity analytics have no source contract. Add search, totals, extra views, or reports only with scoped backend support and truthful pagination/freshness metadata.

## 6. Frontend ownership plan

Keep browser-native ES modules, HTML semantics, and CSS. No framework migration is part of this plan. Extract by vertical slice and delete moved renderer/event ownership from `app.js` in the same change; copying a function into another file without transferring ownership is not completion.

### Browser UI and server authority

NOVA remains a browser-rendered, API-backed application; this plan does **not** move screen rendering to the server. The hosting target serves static HTML, CSS, and ES modules. Browser modules compose responsive screens, shared controls, focus/navigation behavior, and short-lived presentation state. They never connect directly to PostgreSQL.

Trusted product behavior stays server-side: session and actor resolution, effective grants, target and scope checks, business validation, protected reads, mutation commands, audit outcomes, and persistence. Each API request and command rechecks the current actor and target. The browser may use the server's effective-grant response and capability hints to hide irrelevant destinations/components and avoid unauthorized reads, but those hints are for presentation and are never authorization. Role names are customer data; UI code gates on permission keys and accepted scopes rather than assumed built-in roles.

Personal appearance and workspace preferences are stored by the server per person; the browser applies the saved values to its interface. Those preferences only affect presentation and never create access. Feature modules own screen composition and request orchestration; server command modules own the operation's authority and business rules. Shared UI components know neither database details nor domain permissions.

```text
web/
  app.js                         bootstrap, route dispatch, identity boundary
  app/                           route registry and persistent workspace shell
  platform/                      authenticated API errors, abort/lifetime, formatting
  ui/                            buttons, fields, status, collection toolbar, dialog
  features/
    my-day/                      daily composition and local interaction state
    work/                         collections, detail, create/edit, saved views
    reviews/                      queues, cycle decisions, reviewer context
    people/                       directory, person history, lifecycle
    availability/                 agenda, requests, config, conflict flows
    operations/                   scoped reports, export, recovery entry
    settings/                     account, appearance/workspace, authorized operator groups
    deployment/                   existing guide and stage behavior
  styles/
    tokens.css                    canonical semantic NOVA tokens
    base.css                      document/type/focus/reset
    controls.css                  common button/field/feedback/dialog recipes
    shell.css                     masthead, rail, drawer, page header
    patterns.css                  collections, rows, forms, settings groups
```

Feature CSS stays beside the feature once it has enough unique rules; do not create tiny empty files. `styles.css` remains the ordered entry during migration. Its current import ownership and responsive contract are documented in [`web/styles/README.md`](../web/styles/README.md). Static import paths must be mapped in all deployment adapters before modules are referenced; an HTML fallback must never answer a JavaScript/CSS/font request.

Boundary rules:

1. `app.js` reads session and actor grants, resolves a validated route, creates a page lifetime, mounts the shell, then calls exactly one feature page. It does not build domain forms/rows or issue every feature read on boot.
2. `app/` owns nav visibility/route entry, global shell and focus continuity; `platform/` owns transport/error/request lifetime only.
3. A feature owns its data plan, collection/detail composition, draft/selection, commands, recovery states, and local CSS. It exports a narrow mount/render contract with JSDoc types and a disposer for listeners/timers.
4. Shared UI owns stable visual mechanics, not permission/business rules. Pass a narrow capability predicate or feature-specific boolean contract rather than the entire app state and dozens of unrelated helpers.
5. Keep DOM writes safe (`textContent` for service/user strings), URL state limited to nonsensitive filters/record IDs, and preferences limited to versioned allowlists. No sensitive drafts in URLs/local storage by default.
6. Split `styles.css` by ownership with a deterministic source order; migrate real selectors in place and remove old definitions after verification. Do not add a final override pile or permanent old/new token vocabularies.
7. Build only components used by the Work pilot, then extract a primitive when at least a second real feature needs the same behavior. Reuse a tested control for consistency; retain distinct feature compositions.

## 7. Implementation sequence and exit gates

| Phase | Work | Exit evidence before next phase |
| --- | --- | --- |
| 0. Blueprint and baseline | This document; reconcile capability map through migration 0077; fixture matrix for employee, scoped manager, reviewer, invite-only, and Super Admin; capture real app at representative viewports; inventory CSS and static imports. | Each observation is labelled source, browser, fixture, or unverified. No customer/production DB mutation. |
| 1. Design foundation | Refine canonical tokens and control specimen in both themes; validate semantic contrast pairs; settle licensed typeface/Fastly source; split token/base/control/shell CSS; apply pressed/focus/disabled/pending state recipes; create asset graph test. | 320/768/1024/1440 specimen passes, system/green/custom accents readable, keyboard focus visible, reduced motion and forced-colors behavior tested, all assets resolve on every deployment adapter. |
| 2. Work vertical pilot | Move saved-view UI and Work collection/detail composition into `features/work`; preserve role-safe Mine/All-visible reads; polish filter/view toolbar, task row, detail, forms, error/conflict/retry and source-return context. | Tests cover permission × scope and no-fetch/no-render for inaccessible features; browser keyboard/touch workflows complete at 390/768/1024/1440; no migration to app-wide new framework. |
| 3. Persistent shell and personalization | Mount shell separately from route bodies; responsive nav/drawer, page header, focus and identity lifecycle; modularize Settings personal Appearance/Workspace and separate any authorized operator group. Build a real live preview of supported preferences. | Refresh, Back/Forward, long title, short landscape, preference conflict/reset, identity switch and unpermissioned direct route behave correctly. Customization preview matches saved state and cannot expose a feature. |
| 4. My Day and operations execution | Move attendance/assignment/timeline panels into owning modules; keep permission gates per module; organize Operations into named scoped reports and audited recovery rather than count tiles. | Data counts and exports label completeness; data sources stay independent; normal, partial, empty, denied, error, conflict, recovery states tested. |
| 5. People and Availability | Complete directory paging and lifecycle/detail compositions; verify agenda and recovery populated, denied, and failure states; finish request/calendar/configuration surfaces and address paging only with API contracts. | Multi-scope role fixtures, office timezone/effective-date boundary tests, target changes, read/action separation, RLS/Postgres tests where SQL changed. |
| 6. Admin/configuration/public routes | Break Admin into domain-owned sections and route/link compatibility; complete client/workstream/catalog/billing, auth, deployment, inbox, and operator flows using canonical shared controls. | No duplicate domain UI or orphan entry point, static/deep-link paths work on all hosts, permissions and audit outcomes intact. |
| 7. Stabilize and retire | Remove migrated renderer functions, dead CSS, obsolete app handlers, stale docs; verify preferences/views and release manifests; update contributor notes. | Browser/device/accessibility and server checks pass; no duplicate data source; rollback changes UI assets without undoing business data. |

Parallel work starts after phase 1 freezes the public token/control and module contracts. Then agents can own separate feature directories, but one integrator owns shell, shared CSS, static routes, and final cross-feature QA. Do not assign simultaneous edits to `app.js`, `styles.css`, or the same permission registry.

## 8. Definition of professional completion

- Screen hierarchy is recognizable at first glance and reflects the job; records lead, and panels/cards appear only where grouping or decision context benefits.
- Components have an owner, small documented contract, semantic states, and one source of visual truth; the feature owns its domain logic.
- Every visible feature/read/action traces to a permitted backend capability and hides safely when that capability disappears.
- Appearance/layout choices preview, persist, recover from conflict/failure, reset at the right scope, and stay distinct from roles and policy.
- Phone, tablet, desktop, long text, narrow splits, keyboard, touch, screen reader, high contrast, and reduced motion preserve usable workflows.
- Loading/empty/filtered/denied/partial/error/stale/pending/conflict/unknown write states reflect actual API guarantees; no fabricated totals or progress.
- Build, tests, asset maps, and browser evidence pass for the changed slice; SQL/RLS checks run against a verified disposable database when query/policy/migration work requires it.

No phase may be declared complete from CSS/source review alone. A screenshot checks visual output; integration tests check state flow; database tests check persistence and scope; each evidence type must be named honestly.
