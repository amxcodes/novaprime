# Product UI Design Playbook

**Purpose:** A transferable visual and interaction standard for the next COVENA-family product. Keep the recognizable product character, but build a clean, professional design system for the new application's domain, information architecture, stack, and backend.

**Audience:** Product designers, frontend engineers, and coding agents asked to design or implement a screen.

**Rule of interpretation:** The current HRMS is a visual reference, not an implementation template. Do not copy its route structure, data model, authorization rules, CSS accumulation, component internals, or dependency choices. Re-derive those from the new project's requirements.

## 1. Design Intent

The product should feel like a calm, capable operations workspace: clear enough for a first-time user, dense enough for daily expert use, and visually distinctive without decorative noise.

### Non-negotiables

- Start from the user's job, not a component library. Name the main question, next decision, primary action, and failure cost for each screen.
- Choose a visual form that fits the information: timeline for time, table for comparison, board for state movement, calendar for dates, map for geography, chart for trends, form for structured input, and detail inspector for focused edits.
- Cards are one framing option, not the default layout primitive. Prefer page bands, section headers, dividers, aligned columns, dense rows, and a single framed work area when they clarify hierarchy better.
- Keep one primary action per context. Secondary actions should be visually quieter and adjacent to the data they affect.
- Show the user's current scope (person, team, project, date range, status) near the content it scopes. Do not make them infer why the results changed.
- Every data-driven view must have intentional loading, empty, filtered-empty, partial, error, stale, permission-limited, and success states.
- Make permissions legible without exposing implementation jargon. A disabled action explains the required condition and, when possible, how to resolve it.
- Design for long labels, zero data, large data, keyboard, touch, zoom, localization, and light/dark modes from the first pass.

### What to carry forward from the current product

Source inspection found a neutral two-theme shell, near-black dark surfaces, violet/indigo primary actions, blue informational states, green success, amber warning, red error, compact uppercase metadata labels, rounded but restrained controls, role-aware navigation, a desktop action dock that becomes a mobile toolbar, and a vivid fuchsia work-timeline accent. Carry the intent, not every exact value or every current exception.

The current app has accumulated global overrides and screen-specific utility classes. The next app should have fewer, stronger semantic tokens, explicit variants, and feature-owned composition. Do not reproduce that CSS sprawl to achieve visual similarity.

### Product-specific lessons to keep in mind

These are implementation lessons from reviewing the existing source, not requirements to copy its behavior:

- Important actions should be visible on touch and keyboard, not revealed only by hover or a desktop-only gesture.
- A custom searchable select is not complete when it only filters and renders options. It also needs combobox/listbox semantics, arrow-key movement, active-option announcement, Home/End, Enter, Escape, typeahead behavior where appropriate, and correct focus restoration. Prefer a proven accessible primitive when available.
- A dialog needs dialog semantics, an accessible name, initial focus, contained tab order, Escape/backdrop policy, focus return, and a mobile layout. Scroll locking alone does not make a modal complete.
- Keep one deliberate scroll owner per complex surface. Avoid nested scrollbars and sticky footers that cover timeline lanes, fields, results, or the selected item.
- A large feature view should not own every query, policy rule, pointer handler, layout decision, and visual component in one file. Keep those concerns close enough to coordinate, but separable enough to test and change safely.
- Do not solve browser autofill/search styling with broad selectors that guess intent from placeholder text. Give each field a semantic class or variant and scope its styling.
- Never remove keyboard focus outlines globally for visual neatness. Replace browser-default appearance with a clear, theme-aware focus treatment instead.

## 2. Visual Foundation

### Reference palette

These values describe the inspected product's current light/dark direction. Treat them as starting points and re-check contrast with the new brand and content. Assign colors by semantic role; do not use color alone to communicate a state.

| Role | Light reference | Dark reference | Use |
| --- | --- | --- | --- |
| App canvas | `#f7f8fc` | `#000000` | Page background; dark reference may be lifted slightly in a new product to preserve surface separation |
| Subtle canvas | `#eef2f8` | `#050506` | Grouped work areas and quiet navigation regions |
| Surface | `#ffffff` | `#121212` / translucent neutral | Menus, panels, drawers, focused content |
| Raised surface | `#f1f3f8` to `#e9edf5` | `#171717` | Nested controls and grouped content, used sparingly |
| Primary | `#6750a4` | `#6366f1` family | Main action, selected navigation, focus accents |
| Primary container | `#eaddff` | `#4338ca` family | Soft selected state, never a large low-contrast wash behind all content |
| Informational | `#1976d2` | `#3b82f6` | Links and information only |
| Success | `#2e7d32` | `#22c55e` | Successful or healthy states |
| Warning | `#a46000` | `#f59e0b` family | Attention, pending, deadline risk |
| Danger | `#ba1a1a` | `#ef4444` family | Destructive or failed states |
| Work-timeline accent | Fuchsia / vivid magenta | Fuchsia / vivid magenta | Domain-specific time blocks, not generic primary buttons |

The current stylesheet also uses white/black variants and later theme overrides. Do not cargo-cult each value. Define one canonical palette per theme and map all components through semantic tokens.

### Token architecture

Keep raw palette values private to the theme layer. Components consume semantic roles so brand changes and dark mode do not require per-component overrides.

```css
:root {
  color-scheme: light;
  --color-canvas: #f7f8fc;
  --color-surface: #ffffff;
  --color-surface-raised: #f1f3f8;
  --color-border: #e4e7ef;
  --color-border-strong: #d8deea;
  --color-text: #1c1b1f;
  --color-text-muted: #5f6368;
  --color-text-subtle: #777b84;
  --color-primary: #6750a4;
  --color-primary-hover: #4f378b;
  --color-primary-soft: #eaddff;
  --color-info: #1976d2;
  --color-success: #2e7d32;
  --color-warning: #a46000;
  --color-danger: #ba1a1a;
  --color-work: #d946ef;
  --radius-control: 0.75rem;
  --radius-panel: 1rem;
  --radius-overlay: 1.25rem;
  --space-page: clamp(1rem, 2vw, 2rem);
  --focus-ring: 0 0 0 3px color-mix(in srgb, var(--color-primary) 30%, transparent);
}

[data-theme="dark"] {
  color-scheme: dark;
  --color-canvas: #090a0c;
  --color-surface: #121316;
  --color-surface-raised: #1a1b20;
  --color-border: rgb(255 255 255 / 9%);
  --color-border-strong: rgb(255 255 255 / 15%);
  --color-text: #f5f5f7;
  --color-text-muted: #b1b4bd;
  --color-text-subtle: #898d97;
  --color-primary: #a78bfa;
  --color-primary-hover: #c4b5fd;
  --color-primary-soft: rgb(167 139 250 / 16%);
  --focus-ring: 0 0 0 3px rgb(196 181 253 / 35%);
}
```

This is an illustrative token API, not a requirement to use these literal hex values or CSS variable names. Add semantic tokens for data visualization only when the product has a real need for them.

### Type, spacing, shape, and depth

- Use the host product's strong neutral sans-serif. Keep one family if it covers the required scripts and weights; use a display face only when it materially improves hierarchy.
- A practical hierarchy: page title `24-30px`; section title `16-20px`; body `14-16px`; control `13-15px`; metadata `11-12px`. Small uppercase labels are metadata, not primary content.
- Use weight and contrast before introducing another accent color. Use tabular numerals for totals, timers, IDs, and changing metrics.
- Use a 4px base rhythm with common gaps of `4, 8, 12, 16, 24, 32, 40`. Screen padding is responsive, not hard-coded to one viewport.
- Keep most control radii between `8-14px`; panels between `12-20px`; overlays can be larger. Nested radii should be concentric: outer radius = inner radius + inset spacing.
- Prefer a quiet border or subtle shadow, not both at full strength. Separate surfaces with value/spacing before adding another border.
- Avoid oversized page headings, random gradients, glass effects on every panel, ornamental dots, nested cards, and one-hue-only screens.
- Use icon + text for unfamiliar commands. Icon-only actions need an accessible name and tooltip. Use the icon library already selected by the new project.

## 3. Screen Composition Before Components

Before building, write a one-screen brief:

```text
User and role:
Job to finish:
Primary question / decision:
Main action:
Data scale (typical / high / empty):
Important constraints or permissions:
Best visual form and why:
What must stay visible while interacting:
Mobile transformation:
```

Then sketch at least two genuinely different compositions when the content is ambiguous. Do not make three card arrangements and call them concepts. Vary the actual model: overview + queue, table + inspector, board + filters, map + list, timeline + detail pane, or progressive form. Select one based on scan time, decision quality, action cost, and responsive behavior.

### Layout patterns

**Operational overview**

```text
Page title + scope / range                         primary action
Key numbers (inline strip, not five mandatory cards)
Main analysis / queue (wide)          Context / next actions (narrow)
Recent activity / exceptions across full width
```

Use a compact metric strip only when the numbers genuinely summarize the same scope. A statistic without comparison, trend, target, or consequence is often noise.

**Data management**

```text
Title + create/import action
Search + filters + saved view                    result count
Table: identity | important attributes | state | next action
Pagination / total / bulk selection actions
Optional detail inspector that preserves selection context
```

Use a table for many records and cross-row comparison. Use row cards only when records need rich, unequal content or a touch-first scan. Keep bulk actions visible only when selection exists.

**Work board**

```text
Title + ownership/scope selector + view controls
Filter row
State columns with counts and independent scroll as appropriate
Compact task items; expand one item for deeper detail
```

Columns should communicate lifecycle state. Do not place detailed forms in every card. On narrow screens, use a state selector or a single-column lane with clear next/previous navigation; do not shrink desktop columns until they are unusable.

**Time-based work surface**

```text
Date/person context + live status + primary timer action
Useful time range controls (latest / day / zoom)
Ruler and aligned lanes; blocks encode task and duration
Selection opens stable inspector with edit, split, and evidence
```

A timeline is a custom visualization, not a list of rounded rectangles. Its geometry has explicit time scale, minimum visible width, overlap/lane rules, playhead, labels, hit targets, drag handles, scroll synchronization, and keyboard alternatives. Never disguise overlap as one block, or make the shortest intervals impossible to select. If the user can split an interval, show the split affordance on selection and support a precise keyboard/time-input path as well as dragging.

**Review / approval**

```text
Queue scope + pending count + review filters
One focused record with evidence and history
Approve / request change / reject grouped by consequence
Decision reason where policy requires it
Clear pending/success/failure state and audit context
```

The evidence and the decision must be visually adjacent. Destructive or irreversible decisions require deliberate confirmation; ordinary progression should not be buried in a modal.

**Forms and setup**

- Group fields by the user's mental model, not by database table.
- Put labels above fields. Keep help beside the relevant field. Show required/optional status consistently.
- Use progressive steps only when the task is genuinely staged; show progress, allow safe backtracking, preserve entered data, and validate at the point of correction.
- Separate a searchable choice from free text. Explain when a value is unavailable because of role, scope, or policy.
- Keep a sticky action footer only when a long form needs persistent submit/cancel controls; never let it cover fields or validation messages.

## 4. Component Catalog and Recipes

Components are reusable behavior and visual grammar, not merely rounded containers. Define their anatomy, variants, states, responsive behavior, accessibility contract, and ownership before multiplying them across screens.

| Component | Use it for | Visual recipe | Essential states / variants |
| --- | --- | --- | --- |
| App shell | Global navigation and workspace context | Stable sidebar on wide screens; compact top bar + drawer on mobile; content owns width | expanded/collapsed, active route, mobile open, role-filtered, loading profile |
| Page heading | Identify current task and scope | Title, optional concise context, actions aligned to right or next line | with/without subtitle, compact, wrapping, mobile actions |
| Action toolbar | Search, scope, filter, create | Group controls by task; primary action separated from filters | active filter, clear filters, disabled, overflow, selected rows |
| Button | Commit an action | Primary solid accent; secondary quiet surface/outline; destructive only when action is destructive | idle, hover, keyboard focus, pressed, disabled, pending, success |
| Icon button | Frequent compact command | Fixed square hit-area, centered known icon, tooltip for non-obvious command | same button states, expanded/pressed toggle, tooltip |
| Text field | Short structured entry | Label above, helper below, focus ring, clear error association | empty, filled, focused, invalid, disabled, read-only, autofill |
| Search field | Filter visible dataset | Search icon inside a neutral field; explicit clear when query is non-empty | typing, clear, no matches, loading results, keyboard active result |
| Combobox / searchable select | Search and choose a known option set | Trigger matches field grammar; anchored popover or mobile sheet; selected item checkmark | open, query, selected, disabled option, no results, async error, keyboard navigation |
| Segmented control | Small mutually exclusive view/mode switch | One shared rail; visible selected segment; consistent labels/icons | selected, hover/focus, disabled, overflow/mobile scroll |
| Filter chip | Show an applied, removable constraint | Quiet outline or tinted neutral; removable only if safe | selected, removable, disabled, overflow summary |
| Status badge | Compact state identification | Text label plus color/icon where needed; do not encode state by color alone | semantic tone, compact, unknown, stale |
| Metric | One scoped number | Number + clear label + optional delta/target/range; preferably unframed strip | loading skeleton, unavailable, positive/negative trend, tooltip detail |
| Progress indicator | Communicate measured completion | Bar/ring only when denominator and calculation are meaningful; show label or fraction nearby | measured, not measured, paused, over target, loading |
| Data table | Compare/scan many records | Stable column alignment, readable row height, sticky header only if helpful | sort, selection, bulk action, loading, empty, error, responsive alternative |
| Dense data row | Show one record with predictable scan order | Primary label, 1-3 secondary fields, state, next action | hover/focus, selected, expanded, disabled, long-text |
| Task item | Summarize work and make next action obvious | Title + client/project context + owner/state/time; details disclosed on selection | compact/expanded, timer running/paused, overdue, locked, optimistic move |
| Kanban column | Group work by lifecycle state | Label/count, drop region, independent density; avoid giant empty dashed frames | empty, drop target, loading, permission restricted, high-volume scroll |
| Chart / analytic view | Reveal trend, distribution, or comparison | Direct labels where possible, axis units, clear scope, textual summary/table fallback | loading, no data, insufficient data, error, selected series, zoom/range |
| Timeline block | Represent an interval on a time ruler | Fixed track height, width from duration, legible selected state, separate resize/split hit zones | narrow/normal/long, overlap lane, running, paused, locked, selected, dragging, conflict |
| Inspector | Edit or explain the selected record without losing context | Stable side panel on desktop; sheet or route on mobile; label/value rows | no selection, selected, edit, dirty, saving, saved, conflict, error |
| Modal / dialog | Interrupt for focused, bounded work | Title, one scroll owner, compact context, actions at end or stable footer | opening, open, submitting, validation, failure, success, escape/backdrop policy |
| Drawer / sheet | Context-preserving detail or filter workflow | Anchored to edge; preserve underlying page and selected item | side/end placement, mobile full-height sheet, loading, dirty close |
| Toast / inline alert | Announce transient feedback or persistent issue | Toast for brief success; inline alert for actionable/persistent failure | polite/live announcement, undo, retry, dismiss, timeout, reduced motion |
| Tooltip / hint | Explain a non-obvious icon or constraint | Short, non-interactive explanation adjacent to trigger; never hide essential instructions here | delayed hover, keyboard focus, touch alternative, viewport-aware placement |
| Empty state | Explain an actual absence and next step | Short title + why + one useful action; avoid illustration by default | first-use, filtered-empty, permission-limited, truly empty |
| Skeleton | Preserve geometry while content loads | Match final content silhouette, no shimmer by default on long durations | reduced-motion, stale content, timeout fallback |
| Pagination / range footer | Navigate large datasets | Current range + total + previous/next; page-size when useful | first/last, loading, disabled, mobile compact |
| Avatar / identity | Attribute work to people | Stable size, initials fallback, name remains available in text | missing image, long name, group, privacy-safe |
| Date/range picker | Set one date or a bounded range | Trigger previews chosen value; popover stays within viewport; mobile sheet if dense | selected, range start/end, disabled dates, timezone hint, keyboard |
| Context menu | Rare secondary actions on an item | Trigger is explicit; items grouped and named by outcome | keyboard open, destructive group, unavailable item, dismissal |

### Surface hierarchy

Use these levels consistently:

1. **Canvas:** full-page background, no border.
2. **Section:** full-width band or unframed grouping with title and spacing.
3. **Work surface:** one meaningful frame for a table, chart, board, or editor.
4. **Repeated item:** row, task, event, or result may use a subtle item boundary.
5. **Overlay:** dialog/popover/sheet floats above the current context with one clear elevation cue.

Avoid card-in-card nesting. If two blocks need separate borders, ask whether one should instead be a row, divider, inset, or simply spacing.

## 5. Custom Visual Components

Custom components are warranted when the domain has structure that a generic library primitive cannot communicate clearly. They should still reuse standard focus, selection, typography, color, and motion tokens.

### Choose a visual form with this test

| User needs to… | Start with… | Add custom behavior when… |
| --- | --- | --- |
| Find one record among many | Searchable table/list | Comparison or grouping requires another view |
| Compare attributes across records | Table | A meaningful temporal or spatial dimension is central |
| Move work through a process | Kanban/state board | Ownership, dependencies, or WIP limits must be seen |
| Understand work across time | Timeline/calendar | Drag, overlap, splits, or live-now state matter |
| See a trend or anomaly | Chart plus summary | Domain marks/thresholds are meaningful to a trained user |
| Inspect location | Map paired with searchable list | Spatial relationships change the decision |
| Complete structured data entry | Form/wizard | A preview or builder directly improves confidence |
| Resolve a specific item | Detail pane/inspector | Comparison among multiple items is needed |

Do not use a chart merely to make a dashboard look visual. Each visualization must answer a question and name its scale, units, source/scope, and no-data behavior.

### Interaction anatomy for bespoke editors

For any drag/resize/split editor, document these before implementation:

- Coordinate model and source of truth (e.g. UTC instants plus displayed timezone; pixel coordinate only for preview).
- Minimum unit, snapping rule, legal bounds, and overlap policy.
- Which items can move, resize, split, merge, or delete, and why others are locked.
- Hit-area geometry so handles remain usable on narrow objects and touch.
- Selection behavior, keyboard alternative, announceable value, and visible focus.
- Preview versus committed state; cancel, undo, save, and server-conflict behavior.
- Scroll owner, zoom/range behavior, and pointer capture / release behavior.
- Dense collision strategy: lane assignment or clustering, never arbitrary overlap that hides selectable items.
- Error feedback tied to the offending object, with a recoverable correction path.

## 6. Interaction and Motion System

Motion should explain cause and result, preserve context, and remain interruptible. It is not a substitute for clear state. Apple recommends purposeful, brief, precise, optional motion and feedback that follows the user's gesture; see [Apple's Motion guidance](https://developer.apple.com/design/human-interface-guidelines/motion/).

Suggested starting timings (tune to platform and task):

| Purpose | Starting range | Notes |
| --- | --- | --- |
| Hover/focus color | `100-160ms` | Color/shadow only; no layout shift |
| Press feedback | `80-140ms` | Tiny scale or inset; do not make controls jump |
| Popover/small surface | `140-200ms` | Fade + short 4-8px translation |
| Drawer/dialog | `180-240ms` | One direction consistent with entry/exit; backdrop fades independently |
| Reordering / timeline drag | Pointer-following | Preview tracks input directly; settle animation after release only |
| Success feedback | `160-260ms` | One bounded confirmation; no repetitive celebration for routine work |

```css
:root {
  --motion-fast: 120ms;
  --motion-normal: 180ms;
  --motion-slow: 220ms;
  --ease-standard: cubic-bezier(0.2, 0, 0, 1);
  --ease-enter: cubic-bezier(0.16, 1, 0.3, 1);
}

.control {
  transition:
    color var(--motion-fast) var(--ease-standard),
    background-color var(--motion-fast) var(--ease-standard),
    border-color var(--motion-fast) var(--ease-standard),
    box-shadow var(--motion-fast) var(--ease-standard),
    transform var(--motion-fast) var(--ease-standard);
}

@media (prefers-reduced-motion: reduce) {
  *, *::before, *::after {
    scroll-behavior: auto !important;
    animation-duration: 0.01ms !important;
    animation-iteration-count: 1 !important;
    transition-duration: 0.01ms !important;
  }
}
```

Motion rules:

- Never use `transition: all`; name the properties that can change.
- Prefer CSS transitions for reversible state changes. Use keyframes/spring sequences only when the choreography adds meaning.
- Do not animate layout dimensions on repeated hover. Avoid content jumps and animated gradients.
- Keep drag previews under direct pointer control; never ease the item behind the pointer.
- Enter transitions can be slightly more expressive than exits; keep exits short and low amplitude.
- Initial page content should not animate unless there is a clear product reason. Respect `prefers-reduced-motion`; remove automatic/repeating movement and provide non-motion feedback.
- Motion must not be the sole signal for success, error, selection, or state transition.
- Use `will-change` only after profiling a real compositing issue.

## 7. Responsive Behavior

Responsive design is a change in prioritization and interaction, not merely a smaller desktop layout.

- Define breakpoints around content failure: when the main table, toolbar, or inspector no longer has enough width to work.
- Protect the primary task on every viewport. Move secondary actions into a named overflow menu rather than allowing them to be clipped.
- Desktop multi-column board -> mobile state selector / lane navigation; do not force 4-6 unusable narrow columns.
- Desktop table -> prioritize columns, allow horizontal scroll only when column comparison is essential, or switch to labeled record rows when that is faster to scan.
- Desktop side inspector -> mobile bottom sheet or dedicated detail route; keep selected-record identity and a clear back action.
- Dense timeline -> preserve readable labels and hit targets; allow intentional horizontal scroll with visible range/zoom controls and a “latest/now” action.
- Sidebar -> top bar + modal/drawer navigation; lock background scroll, close after route change, retain focus, and never crop role-specific menu items.
- Sticky footers must account for safe areas, keyboard, browser zoom, and content clearance.
- Test at `320px`, `375px`, `768px`, `1024px`, and a wide desktop, plus 200% zoom and long translated strings.

## 8. Accessibility and Input

- Prefer semantic HTML and well-supported accessible primitives. A custom control must recreate keyboard operation, roles, names, values, focus, and announcement behavior, not just visual styling.
- Every interactive target should be comfortably usable; aim for a 40-44px hit area for frequent touch controls. WCAG 2.2 AA sets a 24x24 CSS-pixel minimum with exceptions; use [W3C's target-size explanation](https://www.w3.org/WAI/WCAG22/Understanding/target-size-minimum) as a floor, not a comfort target.
- Keep a clearly visible keyboard focus. WCAG's [Focus Appearance guidance](https://www.w3.org/WAI/WCAG22/Understanding/focus-appearance) provides a stronger benchmark for indicator size and contrast.
- Meet text and non-text contrast requirements for both themes; validate real combinations rather than assuming a palette pair passes.
- Provide labels, descriptions, error associations, and status announcements. Do not rely on placeholder text as a label.
- Keyboard path must cover navigation, menu opening/closing, selection, drag alternative, dialogs, and recovery. Escape closes only when safe; a dirty editor asks before discarding.
- Avoid hover-only controls. Make the same action reachable by touch, keyboard, and pointer.
- Preserve visible focus when content scrolls; popovers and dialogs should manage focus and return it to their trigger.
- For charts and timelines, provide a concise text/table equivalent and keyboard-selectable data points.

## 9. Implementation Architecture (Stack-Neutral)

The new project's backend, routing, and component framework may differ. Keep visual rules portable and put integration decisions behind the new app's own architecture.

### Recommended layers

```text
Theme tokens
  -> primitive controls (button, field, menu, dialog)
    -> composed patterns (filter bar, table, board column, inspector)
      -> domain components (approval queue, work timeline, project selector)
        -> route/page composition
```

- **Tokens:** colors by semantic role, spacing, type, radius, elevation, motion, z-index, and focus.
- **Primitives:** small stable behavior, accessible by default; no domain queries or hidden navigation assumptions.
- **Patterns:** combinations reused across multiple features, with explicit props and states.
- **Domain components:** feature-owned, understand domain states but delegate persistence/authorization through explicit interfaces.
- **Pages:** compose a specific workflow; avoid a universal page-builder or generic component with dozens of unrelated boolean props.
- **Adapters:** isolate API/backend serialization and mutation semantics from visual components. Keep the visual component's contract typed in domain language rather than vendor-specific payloads.

Example component contract (illustrative, adapt to framework):

```ts
type AsyncState<T> =
  | { status: 'loading' }
  | { status: 'error'; message: string; retry?: () => void }
  | { status: 'ready'; data: T; stale?: boolean };

type WorkItemView = {
  id: string;
  title: string;
  state: 'open' | 'active' | 'paused' | 'review' | 'done';
  ownerLabel: string;
  canEdit: boolean;
};

type WorkItemRowProps = {
  item: WorkItemView;
  selected: boolean;
  onSelect(id: string): void;
  onPrimaryAction?(id: string): void;
};
```

Keep authorization authoritative on the server. A disabled/hide decision in the UI is a usability layer, not a security boundary. Do not hard-code assumptions such as user roles, project membership, billing, attendance policy, or backend workflow into a shared button or generic card.

### State and mutation contract

- Distinguish displayed state, draft state, optimistic preview, and persisted state.
- For every mutation define pending, success, validation failure, permission failure, conflict/stale data, network failure, retry, and rollback behavior.
- Prevent duplicate submission; make retries idempotent where appropriate; preserve user's work after recoverable failure.
- Make destructive effects explicit in labels and confirmation. Provide undo when the operation is reversible.
- Keep server response as canonical truth after optimistic interactions. Reconcile with a returned entity/version instead of blindly refreshing a whole page.
- Define who owns state: URL for navigable/searchable page scope, page for short-lived selection, editor for draft edits, server for canonical records, user preferences store for personal view settings.
- Use stable IDs as keys, not array indexes, for reorderable/timeline/board items.
- Large datasets need pagination or virtualization only when measured; preserve keyboard order, focus, and scroll position when virtualizing.

## 10. Code Quality for a Design System

- Keep theme definitions in one token layer and component variants in a small number of files/modules. Do not append late global selectors to fix one screen.
- Prefer explicit variants (`tone`, `size`, `density`, `disabled`) over fragile descendant selectors, placeholder-text selectors, or arbitrary class parsing.
- Avoid `!important`, runtime DOM styling, deep CSS selector overrides, and global styling based on the input placeholder or element text.
- Keep layout values in named tokens or feature-local constants. Use CSS grid/flex constraints and `minmax()` for resilient layouts.
- Use a shared component only after behavior repeats or must remain consistent. Do not abstract a one-off domain visualization into a universal generic renderer.
- Keep icon size/stroke and control height consistent; align optically where geometric centering looks off.
- Use exact transition properties and tabular numerals for live values. Avoid unbounded blur/backdrop filters over large scroll regions.
- Avoid color-driven trend charts with no labels, gradients that reduce legibility, and arbitrary shadow stacks.
- Add concise comments only where a non-obvious interaction or browser constraint needs explanation.

## 11. Design-to-Code Workflow

1. **Understand:** inspect the relevant source, route, current tokens, existing primitives, actual user workflow, permissions, and realistic data volume. Separate observed facts from proposals.
2. **Model the task:** write the one-screen brief and enumerate normal, empty, dense, failure, and permission-limited cases.
3. **Choose the visual grammar:** explain why a table/board/timeline/chart/inspector/form is the best fit. Sketch alternatives when the best form is uncertain.
4. **Specify components:** for each new component list anatomy, variants, data contract, states, keyboard behavior, mobile behavior, and motion.
5. **Implement tokens before exceptions:** wire theme and primitives first; build the domain composition using those instead of styling each page independently.
6. **Connect real behavior:** wire role/scope/data/persistence explicitly; no fake totals, decorative controls, or silent no-op actions.
7. **Review density:** use realistic labels and large datasets. Look for collision, clipping, repeated card framing, duplicated information, unstable row heights, and buried primary actions.
8. **Verify:** screenshot light/dark at mobile/tablet/desktop; test keyboard and pointer, loading/empty/error, long text, zoom, reduced motion, and browser overflow. Check the actual user journey, not just the happy-path screenshot.
9. **Refine:** remove anything that does not support comprehension, decision, or action. Do a final pass for contrast, focus, semantics, layout shift, and console/runtime errors.

For a design-only handoff, provide the selected composition, a short rationale, the component/state inventory, important responsive changes, and any unresolved assumptions. For implementation work, keep that brief small enough to stay useful, then implement and verify the actual flow. Do not spend the deliverable on abstract principles while leaving the screen generic.

### Required design review questions

- Is the main task obvious within a few seconds without a tour?
- Is the chosen visual form the most legible way to answer the user's question?
- Have we shown structure, not just framed everything as a card?
- What does this look like with 0 records, 10 records, 500 records, long names, and no permission?
- Can users reach the essential action with keyboard and touch? Are tiny timeline controls independently usable?
- Does selecting one record preserve the current filter, scroll, and context?
- Does every visible action work and provide pending/result feedback?
- Is color consistent by meaning across both themes? Can meaning still be understood without color?
- Does motion follow the user's action and stop when reduced motion is requested?
- Does mobile have an intentional information hierarchy, or is desktop merely clipped?
- Are server policy and data ownership explicit, without leaking backend assumptions into reusable visuals?

## 12. Instructions for Future Design / Coding Agents

Use this playbook as a quality bar, not a demand to copy COVENA's exact palette or UI. Before coding, inspect the target app and answer the one-screen brief. Produce domain-specific screen structure and a component/state inventory. If the first idea is a card grid, challenge it: compare a table, split workspace, board, timeline, chart, or unframed section when those fit the task better.

Do not stop at a few generic cards, a title, and a gradient CTA. Use realistic content to design information hierarchy, density, interactions, and exceptional states. For a new custom visualization, specify its data-to-geometry mapping and interaction contract. Implement the actual workflow, including empty/loading/error/disabled/success states, and verify screenshots at representative sizes and themes before calling it finished. Keep the new project's backend, API, permissions, architecture, and stack native to that project.

## 13. Research and Reference Links

- [Apple Human Interface Guidelines: Design Principles](https://developer.apple.com/design/human-interface-guidelines/design-principles) — purpose, flexibility, context, platform intention, and accessibility.
- [Apple Human Interface Guidelines: Motion](https://developer.apple.com/design/human-interface-guidelines/motion/) — purposeful, brief, precise, cancellable motion and gesture-consistent feedback.
- [W3C WCAG 2.2: Target Size (Minimum)](https://www.w3.org/WAI/WCAG22/Understanding/target-size-minimum) — target-size AA criterion and exceptions.
- [W3C WCAG 2.2: Focus Appearance](https://www.w3.org/WAI/WCAG22/Understanding/focus-appearance) — focus-indicator size and contrast guidance (AAA criterion).

These references inform accessibility and interaction quality; they do not prescribe the product's brand or layout. Confirm applicable WCAG conformance targets with the product owner and validate actual implementations with assistive technology and automated/manual testing.
