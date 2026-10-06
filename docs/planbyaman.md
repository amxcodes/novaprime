# Covena --- UI, Design System & Frontend Architecture Specification

**Status:** Accepted direction / implementation research baseline\
**Scope:** Web desktop, tablet, mobile web, adaptive workspaces, user
customization, visual components, motion, design system, frontend
structure, and future GenUI\
**Product:** Covena --- People, Projects & Work Management System

------------------------------------------------------------------------

## 1. Executive Direction

Covena should **not** be designed as a conventional SaaS dashboard made
from generic cards, tables, badges, and charts.

The accepted direction is:

> **A stable product system underneath, with an adaptive, highly visual,
> customizable interface on top.**

The interface should have a recognizable Covena visual language built
from:

-   typography
-   geometry
-   spacing
-   color
-   material/surface behavior
-   iconography
-   information visualization
-   motion
-   spatial composition
-   responsive/adaptive behavior

The system should support:

1.  deterministic product UI
2.  responsive UI
3.  adaptive UI
4.  user-configurable UI
5.  draggable/resizable workspaces
6.  custom visual/domain components
7.  role and organization defaults
8.  AI-assisted personalization
9.  future schema-driven Generative UI

The objective is not to imitate Apple, Notion, Linear, or another
product. Those products are references for **design engineering
principles**, not visual templates.

------------------------------------------------------------------------

# 2. Core Design Philosophy

## 2.1 Covena is a visual language, not a component library

Generic primitives such as:

-   Button
-   Input
-   Dialog
-   Card
-   Table
-   Badge

are infrastructure.

The actual Covena experience should be expressed through higher-level
visual concepts such as:

-   Workday Timeline
-   Attendance Pulse
-   Team Presence
-   Project Pulse
-   Project Flow
-   Capacity Map
-   Activity Stream
-   Approval Queue
-   Schedule Rail
-   Milestone Flow
-   Workload Matrix
-   Organization Map
-   Command Surface
-   Personal Workspace

The system should ask:

> **What is the most natural visual representation of this
> information?**

rather than:

> Which generic card should contain this information?

------------------------------------------------------------------------

# 3. Research-Informed Principles

## 3.1 Adaptive UI is established; Generative UI is emerging

Adaptive interfaces have decades of HCI research behind them. Recent
work continues to study how adaptive menus and personalization affect
task completion, cognitive load, engagement, and user preference.

Generative UI is newer. Current research such as the 2026 ACL work on
Generative Interfaces demonstrates that language models can dynamically
compose visual interfaces from user intent.

The important architectural implication is:

> GenUI should compose trusted, structured components rather than
> generate arbitrary UI code.

------------------------------------------------------------------------

## 3.2 User control remains essential

Adaptive behavior should not silently rearrange important workflows
without user understanding.

Preferred model:

``` text
System observes useful pattern
        ↓
System proposes adaptation
        ↓
User approves
        ↓
Preference becomes persistent
```

Example:

> "You frequently use Attendance and Tasks together. Add them to your
> quick workspace?"

Not:

> The system silently changes the navigation.

------------------------------------------------------------------------

## 3.3 Design tokens are infrastructure

The design system should be token-driven rather than dependent on
arbitrary CSS values.

Token categories:

``` text
Primitive tokens
    ↓
Semantic tokens
    ↓
Component tokens
    ↓
Visual components
```

The design system should be structured so it can eventually map cleanly
to standardized Design Token formats and cross-platform representations.

------------------------------------------------------------------------

# 4. Covena Architecture

Recommended high-level structure:

``` text
src/
│
├── app/
│   ├── router/
│   ├── providers/
│   ├── layouts/
│   ├── navigation/
│   └── permissions/
│
├── design-system/
│   ├── foundations/
│   ├── primitives/
│   ├── controls/
│   ├── surfaces/
│   ├── visual/
│   ├── patterns/
│   ├── layouts/
│   └── contracts/
│
├── features/
│   ├── employees/
│   ├── attendance/
│   ├── projects/
│   ├── tasks/
│   ├── leave/
│   ├── clients/
│   ├── departments/
│   ├── notifications/
│   └── settings/
│
├── pages/
│   ├── dashboard/
│   ├── employees/
│   ├── attendance/
│   ├── projects/
│   └── settings/
│
├── personalization/
│   ├── preferences/
│   ├── layouts/
│   ├── saved-views/
│   └── recommendations/
│
├── workspace/
│   ├── engine/
│   ├── registry/
│   ├── persistence/
│   ├── responsive/
│   ├── history/
│   └── rendering/
│
├── genui/
│   ├── schemas/
│   ├── registry/
│   ├── renderer/
│   ├── validation/
│   └── capabilities/
│
├── lib/
│   ├── api/
│   ├── auth/
│   ├── permissions/
│   ├── dates/
│   ├── formatting/
│   └── utils/
│
└── types/
```

------------------------------------------------------------------------

# 5. Dependency Direction

Preferred dependency direction:

``` text
app
 ↓
pages
 ↓
features
 ↓
design-system
 ↓
primitive/accessibility foundation
```

Personalization can influence features and workspace composition.

GenUI can consume:

-   features
-   design-system contracts
-   workspace engine
-   personalization
-   permissions

But the design system should not depend on GenUI.

### Rules

``` text
pages → features                 ✓
pages → design-system            ✓

features → design-system         ✓
features → other features        ⚠️ intentional only

design-system → features         ✗
design-system → pages            ✗
design-system → genui            ✗

genui → trusted features         ✓
genui → trusted design system    ✓
```

The goal is to prevent circular dependencies and keep the UI foundation
independent of business logic and AI.

------------------------------------------------------------------------

# 6. Pages vs Features

## Pages

A page represents a route and should primarily orchestrate:

-   route context
-   permissions
-   page metadata
-   feature composition
-   workspace composition

Example:

``` text
pages/employees/
    EmployeesPage.tsx
```

It should not contain hundreds of lines of employee business logic.

## Features

A feature owns a domain.

Example:

``` text
features/employees/
├── components/
├── visual/
├── hooks/
├── api/
├── schemas/
├── types.ts
├── permissions.ts
└── utils.ts
```

The feature should own:

-   business UI
-   data access
-   domain state
-   validation
-   domain permissions
-   domain-specific visualizations

### Principle

> **Pages compose. Features own functionality. Design system provides
> reusable language.**

------------------------------------------------------------------------

# 7. Component Extraction Rule

Use:

> **Local by default. Promote by evidence.**

Do not split components merely because they contain 30--50 lines.

Extract when a component has:

-   independent state
-   meaningful responsibility
-   real reuse
-   accessibility complexity
-   responsive behavior
-   testing value
-   domain meaning

Avoid:

``` text
EmployeeTableHeaderActions.tsx
EmployeeTableHeaderFilterIcon.tsx
EmployeeTableRowName.tsx
```

unless those abstractions have a real reason to exist.

------------------------------------------------------------------------

# 8. Design System Layers

## 8.1 Foundations

``` text
Color
Typography
Spacing
Geometry
Radius
Elevation
Materials
Motion
Iconography
Breakpoints
Accessibility
```

## 8.2 Primitives

Generic interaction infrastructure:

``` text
Button
Input
Select
Combobox
Checkbox
Radio
Switch
Dialog
Drawer
Popover
Tooltip
Dropdown
Tabs
Menu
Command
Calendar
Toast
```

These should be visually and behaviorally owned by Covena even if their
low-level implementation uses an external primitive library.

------------------------------------------------------------------------

## 8.3 Controls

Higher-level interaction components:

``` text
FilterControl
DateRangePicker
SearchControl
ViewSwitcher
ColumnSelector
SortControl
CommandSearch
```

------------------------------------------------------------------------

## 8.4 Surfaces

``` text
Surface
Panel
FloatingPanel
Sheet
Inspector
ModalSurface
WorkspaceSurface
```

A "card" is available as a primitive pattern, but should not be the
default visual representation of product information.

------------------------------------------------------------------------

# 9. Visual Component System

This is a major part of Covena.

The design system should include visual primitives based on
**information intent**.

## Visual categories

``` text
time
people
presence
progress
activity
relationship
comparison
distribution
hierarchy
flow
status
quantity
capacity
```

Examples:

### Time

``` text
WorkdayTimeline
ScheduleRail
CalendarHeatmap
AttendancePulse
TimeDistribution
```

### People

``` text
TeamPresence
PeopleStrip
EmployeeTimeline
OrgMap
AvailabilityMap
```

### Projects

``` text
ProjectPulse
ProjectFlow
MilestoneRail
ProjectHealth
WorkloadMatrix
```

### Management

``` text
TeamCapacity
GoalProgress
RiskRadar
ApprovalQueue
ActivityStream
```

### Data

``` text
Trend
Distribution
Heatmap
Comparison
Progress
Ranking
Funnel
Matrix
```

------------------------------------------------------------------------

# 10. Visual Intent

Introduce a conceptual visual-intent vocabulary:

``` ts
type VisualIntent =
  | "quantity"
  | "trend"
  | "comparison"
  | "timeline"
  | "relationship"
  | "presence"
  | "progress"
  | "distribution"
  | "hierarchy"
  | "activity"
  | "status"
  | "capacity"
  | "flow"
```

This vocabulary can eventually be shared by:

-   human designers
-   developers
-   workspace configuration
-   AI/GenUI

Example:

``` text
Team availability
    ↓
presence
    ↓
TeamPresence
```

``` text
Project workload over time
    ↓
trend
    ↓
WorkloadTrend
```

------------------------------------------------------------------------

# 11. Product UI vs System UI

## System UI

``` text
Navigation
Buttons
Menus
Forms
Inputs
Dialogs
Toolbars
Settings controls
```

## Product UI

``` text
Workday Timeline
Attendance Pulse
Team Presence
Project Flow
Capacity Map
Activity Stream
People relationships
Workload visualization
Approval queue
Project health
```

System UI provides infrastructure.

Product UI creates the identity of Covena.

------------------------------------------------------------------------

# 12. Visual Grammar

Create and maintain a formal **Covena Visual Grammar**.

## Geometry

Define:

-   corner relationships
-   nested surface geometry
-   alignment
-   spacing rhythm
-   container proportions
-   visual balance

Avoid arbitrary radii everywhere.

Nested surfaces should have related geometry.

``` text
Workspace
  ↓
Surface
  ↓
Module
  ↓
Control
```

## Typography

Define:

``` text
Display
Heading
Body
Metadata
Numerical
Technical / data
```

Typography should communicate hierarchy before decoration does.

## Color

Use semantic color:

``` text
background
surface
text
border
primary
secondary
success
warning
destructive
info
focus
```

Do not depend on color alone for state.

State may also use:

-   shape
-   icon
-   position
-   typography
-   motion
-   density

------------------------------------------------------------------------

# 13. Material and Surface Philosophy

Do not apply blur, glass, gradients, shadows, or translucency
universally.

Materials should communicate hierarchy and function.

Possible surface levels:

``` text
Canvas
Surface
Elevated Surface
Floating Surface
Overlay
Contextual Surface
```

The goal is:

> **Aesthetic through hierarchy and material behavior, not decoration.**

Apple's current Liquid Glass guidance is a useful reference here:
materials are treated as functional layers for controls/navigation and
should be used selectively rather than covering all content in effects.

Covena should not imitate Liquid Glass.

It should learn from the underlying principle.

------------------------------------------------------------------------

# 14. Motion System

Motion is part of the design system.

Create:

``` text
motion/
├── duration
├── easing
├── entrance
├── exit
├── transform
├── morph
├── feedback
├── loading
├── navigation
└── spatial
```

## Motion hierarchy

Use different motion scales for:

``` text
Micro interactions
Standard transitions
Expressive transitions
Spatial transformations
```

Exact values should be validated through prototypes rather than treated
as universal constants.

## Core rule

> **Animate the relationship, not merely the object.**

If a detail panel emerges from an employee row, the animation should
communicate that relationship.

If a widget moves in a workspace, its identity should visually persist
through the move.

------------------------------------------------------------------------

# 15. Motion Accessibility

Provide:

``` text
Full motion
Reduced motion
Minimal motion
```

Respect:

-   prefers-reduced-motion
-   reduced transparency preferences
-   high contrast
-   focus visibility

Motion should never be required to understand essential information.

------------------------------------------------------------------------

# 16. Iconography

Do not treat icons as random SVG files.

Create a Covena icon/symbol system with:

``` text
weight
size
optical alignment
filled/outline variants
active state
disabled state
directional variants
animation behavior
```

Create custom Covena symbols for important domain concepts where generic
icon libraries are insufficient.

Potential categories:

``` text
Navigation
People
Work
Time
Projects
Communication
System
Status
Approvals
Attendance
```

The goal is similar to the system thinking behind SF Symbols:
consistency in geometry, weight, alignment and behavior.

Do not copy Apple's symbols or branding.

------------------------------------------------------------------------

# 17. Avoid Generic "Card-First" Design

The rule should be:

> **Generic components are implementation primitives, not product
> experiences.**

Instead of:

``` tsx
<MetricCard title="Attendance" value="8h 32m" />
```

prefer a visual representation when appropriate:

``` tsx
<WorkdayTimeline />
```

Instead of:

``` tsx
<MetricCard title="Project Health" value="72%" />
```

prefer:

``` tsx
<ProjectPulse />
```

Instead of:

``` tsx
<Card>
  <EmployeeList />
</Card>
```

prefer:

``` tsx
<TeamPresence />
```

Generic cards still exist; they simply should not dominate the product.

------------------------------------------------------------------------

# 18. Responsive vs Adaptive UI

These must be treated differently.

## Responsive

Same conceptual composition changes size:

-   spacing
-   typography
-   columns
-   widths
-   padding

## Adaptive

The composition itself changes:

``` text
Table → List
Sidebar → Navigation rail
Two-pane → Single-pane
Inline toolbar → Overflow menu
Detail pane → Full-screen detail
```

Use **window size / available space** as the basis rather than device
labels alone.

Preferred conceptual classes:

``` text
COMPACT
MEDIUM
EXPANDED
```

Do not assume:

``` text
phone = mobile
tablet = tablet
desktop = desktop
```

because split-screen, resizing and browser windows change available
space.

------------------------------------------------------------------------

# 19. Mobile and Desktop Architecture

Do not build:

``` text
EmployeesDesktop.tsx
EmployeesMobile.tsx
```

as independent applications.

Instead:

``` text
EmployeeCollection
       │
       ├── Expanded → DataTable
       ├── Medium   → CompactTable
       └── Compact  → EmployeeList
```

The same feature owns:

-   data
-   state
-   filters
-   permissions
-   actions

Only the composition changes.

------------------------------------------------------------------------

# 20. Example: Employee Experience

## Expanded

``` text
Employee list                 Employee details
────────────────────          ─────────────────────
Aman                          Profile
Alex                          Employment
Maria                         Attendance
John                          Projects
                              Activity
```

## Medium

``` text
Employee list
     ↓
selected employee
     ↓
detail surface
```

## Compact

``` text
Employees
Aman
Alex
Maria
John

     ↓

Employee detail
```

Same domain.

Same state.

Different spatial composition.

------------------------------------------------------------------------

# 21. Responsive Customization

For configurable workspaces, layouts may eventually support different
arrangements per size class.

Conceptually:

``` json
{
  "desktop": {
    "x": 6,
    "y": 0,
    "w": 6,
    "h": 4
  },
  "medium": {
    "x": 0,
    "y": 8,
    "w": 6,
    "h": 4
  },
  "compact": {
    "x": 0,
    "y": 14,
    "w": 12,
    "h": 5
  }
}
```

However, default behavior should automatically transform/compact layouts
where possible.

Users should not be forced to manually maintain three layouts.

------------------------------------------------------------------------

# 22. Workspace System

Covena should support more than dashboards.

Introduce a **Workspace Engine**.

``` text
workspace/
├── engine/
├── registry/
├── persistence/
├── responsive/
├── history/
└── rendering/
```

Responsibilities:

-   drag
-   resize
-   placement
-   collision handling
-   responsive transformation
-   persistence
-   undo/redo
-   module registration
-   permission checks
-   AI commands
-   layout serialization

------------------------------------------------------------------------

# 23. Two Workspace Modes

## Normal Mode

Clean interface.

No grid.

No handles.

No unnecessary configuration chrome.

## Customize Mode

User can:

-   move
-   resize
-   add
-   remove
-   hide
-   pin
-   configure
-   reorder
-   save
-   reset

Example:

``` text
Customize dashboard
────────────────────────────────────

[Attendance]     [Projects]

        [Team activity]

[Add module]
```

A side inspector can expose module properties.

------------------------------------------------------------------------

# 24. Structured Grid vs Freeform Canvas

These are different systems.

## Structured Grid

Use for:

-   dashboards
-   analytics
-   management views
-   employee overview
-   project overview
-   reports

Advantages:

-   predictable
-   responsive
-   accessible
-   aligned
-   easier to maintain

## Freeform Canvas

Potentially use for:

-   personal workspace
-   planning
-   visual project boards
-   relationship mapping
-   AI-generated exploration
-   spatial work

Advantages:

-   creative
-   highly customizable
-   spatial thinking

Do not make the entire HRMS freeform.

------------------------------------------------------------------------

# 25. Hybrid Workspace Direction

A useful long-term model is:

``` text
┌──────────────────────────────────────┐
│ Freeform/contextual region           │
├──────────────────────────────────────┤
│ Structured adaptive grid              │
│                                      │
│ [Attendance] [Projects] [Tasks]      │
└──────────────────────────────────────┘
```

This gives creative freedom without turning core workflows into an
unstructured canvas.

------------------------------------------------------------------------

# 26. Workspace Modules

A module is a product-level visual experience.

Examples:

``` text
AttendancePulse
Today'sSchedule
ProjectPulse
TeamPresence
TaskFlow
ProjectHealth
TeamCapacity
ActivityStream
ApprovalQueue
WorkloadMatrix
QuickActions
Notes
```

Each module should have a contract.

Conceptually:

``` ts
type ModuleDefinition = {
  type: string
  component: Component
  schema: Schema

  capabilities: {
    movable: boolean
    resizable: boolean
    hideable: boolean
    configurable: boolean
    duplicable: boolean
  }

  responsiveModes: {
    compact: string
    medium: string
    expanded: string
  }

  permissions: string[]

  ai: {
    describable: boolean
    generatable: boolean
    configurable: boolean
  }
}
```

------------------------------------------------------------------------

# 27. Module Registry

A central registry maps trusted module types to implementations.

Conceptually:

``` ts
const registry = {
  "attendance-pulse": {
    component: AttendancePulse,
    schema: AttendancePulseSchema,
    permissions: ["attendance.read"]
  },

  "project-pulse": {
    component: ProjectPulse,
    schema: ProjectPulseSchema,
    permissions: ["projects.read"]
  },

  "team-capacity": {
    component: TeamCapacity,
    schema: TeamCapacitySchema,
    permissions: ["team.read"]
  }
}
```

The registry becomes the bridge between:

-   human-created layouts
-   saved layouts
-   organization templates
-   role templates
-   AI-generated compositions

------------------------------------------------------------------------

# 28. Never Store Executable UI Code in the Database

Store configuration, not arbitrary React code.

Good:

``` json
{
  "type": "project-pulse",
  "props": {
    "showProgress": true,
    "showMembers": false
  },
  "layout": {
    "x": 2,
    "y": 4,
    "w": 6,
    "h": 4
  }
}
```

Bad:

``` text
database → React source code → eval()
```

The renderer resolves:

``` text
type
 ↓
trusted registry
 ↓
component
 ↓
validated props
 ↓
render
```

------------------------------------------------------------------------

# 29. Module Capabilities

Each module can declare:

``` text
movable
resizable
hideable
duplicable
configurable
```

Example:

``` ts
{
  movable: true,
  resizable: true,
  hideable: true,
  configurable: true
}
```

Critical system surfaces can be:

``` ts
{
  movable: false,
  resizable: false,
  hideable: false
}
```

This preserves organizational and security requirements.

------------------------------------------------------------------------

# 30. Pinning

Users can pin modules:

``` text
pinned: true
```

Pinned modules can remain near the top or in a reserved region while
other content rearranges around them.

------------------------------------------------------------------------

# 31. Undo / Redo

Once users can modify layouts, provide:

``` text
Undo
Redo
Reset layout
```

and ideally keyboard shortcuts:

``` text
Cmd/Ctrl + Z
Cmd/Ctrl + Shift + Z
```

Workspace history should be handled by the workspace subsystem rather
than individual modules.

------------------------------------------------------------------------

# 32. Personalization Model

Create a first-class user UI preference model.

Conceptually:

``` ts
type UIProfile = {
  theme: "light" | "dark" | "system"

  density: "compact" | "default" | "comfortable"

  navigation: {
    mode: "sidebar" | "rail" | "top"
    pinnedItems: string[]
  }

  dashboard: {
    layout: Layout
    hiddenModules: string[]
  }

  tables: {
    savedViews: TableView[]
  }
}
```

This is independent of employee/project business data.

------------------------------------------------------------------------

# 33. Customization Hierarchy

Recommended precedence:

``` text
SYSTEM DEFAULT
      ↓
ORGANIZATION DEFAULT
      ↓
ROLE DEFAULT
      ↓
USER CUSTOMIZATION
      ↓
CURRENT CONTEXT
```

Example:

``` text
Organization
  → default dashboard

Manager role
  → team capacity module

User
  → removes team capacity
  → adds personal projects

Current context
  → temporarily surfaces relevant information
```

------------------------------------------------------------------------

# 34. What Users Can Customize

Good candidates:

-   dashboard layout
-   module order
-   module visibility
-   module size
-   table columns
-   table order
-   saved filters
-   navigation shortcuts
-   density
-   theme
-   appearance
-   saved views
-   workspace composition

Avoid allowing arbitrary customization of:

-   permission semantics
-   security boundaries
-   critical HR workflows
-   approval meaning
-   required compliance notices
-   security warnings
-   core conceptual navigation

Customization should not destroy consistency.

------------------------------------------------------------------------

# 35. AI-Assisted Personalization

The preferred model:

``` text
Usage pattern
    ↓
AI suggestion
    ↓
User approval
    ↓
Saved preference
```

Examples:

> "You frequently open Attendance and Tasks together. Add them to your
> quick workspace?"

> "Your dashboard is getting crowded. Create a compact view focused on
> attendance, tasks and today's schedule?"

AI should assist configuration rather than silently control the user's
interface.

------------------------------------------------------------------------

# 36. Generative UI Architecture

GenUI should not be:

``` text
LLM → arbitrary React/HTML
```

Instead:

``` text
User intent
    ↓
Structured requirement
    ↓
UI specification
    ↓
Schema validation
    ↓
Permission validation
    ↓
Data/capability resolution
    ↓
Trusted module registry
    ↓
Covena components
    ↓
Responsive composition
```

This keeps generated UI:

-   safe
-   consistent
-   accessible
-   permission-aware
-   visually coherent
-   maintainable

------------------------------------------------------------------------

# 37. GenUI Uses the Same Component Vocabulary

AI should not invent:

``` text
random button
random border
random card
random color
random typography
```

It should select from:

``` text
Covena visual intent
Covena modules
Covena patterns
Covena tokens
Covena layout engine
```

Example:

``` text
"Show department workload over the last month."

        ↓

visual intent = trend

        ↓

WorkloadTrend

        ↓

Covena visual system
```

------------------------------------------------------------------------

# 38. GenUI and Permissions

AI-generated UI must use the same permission model as ordinary UI.

Example:

``` text
User
 ↓
Role
 ↓
Permissions
 ↓
Capabilities
 ↓
Available modules/actions
```

If a user cannot perform an action through normal UI, GenUI should not
expose it.

AI should never bypass:

-   RLS
-   organization boundaries
-   permissions
-   business rules
-   approval rules

------------------------------------------------------------------------

# 39. Stable vs Adaptive vs Generative UI

Covena should have three classes.

## Stable UI

Use for:

-   navigation
-   settings
-   forms
-   permissions
-   critical workflows
-   security
-   payroll
-   employee termination
-   compliance

## Adaptive UI

Use for:

-   dashboards
-   personal workspaces
-   saved views
-   role-specific surfaces
-   responsive layouts
-   personalization

## Generative UI

Use for:

-   exploration
-   analytics
-   reports
-   cross-domain questions
-   AI workspaces
-   temporary views
-   data exploration

This gives the product stability where it matters and flexibility where
it adds value.

------------------------------------------------------------------------

# 40. Design System and GenUI Convergence

The design system should become a **UI vocabulary shared by humans and
AI**.

Human developer:

``` text
<TeamPresence />
```

User:

``` text
Move Team Presence next to Attendance.
```

AI:

``` text
{
  "type": "team-presence",
  "layout": {...}
}
```

All three operate on the same underlying system.

------------------------------------------------------------------------

# 41. Technology Foundation

The component foundation should be deliberately replaceable.

Application code should use:

``` tsx
import { Button } from "@/design-system/components/Button"
```

not:

``` tsx
import { Button } from "some-vendor"
```

The internal implementation can use:

-   Radix
-   Base UI
-   React Aria
-   shadcn source
-   native React/CSS
-   another accessible primitive

without exposing that dependency to product features.

------------------------------------------------------------------------

# 42. Component Library Selection

No single library should be considered universally "professional."

## MUI

Strengths:

-   mature
-   large ecosystem
-   enterprise-oriented
-   many ready-made components

Tradeoff:

-   more opinionated
-   deeper customization can become more involved

## Mantine

Strengths:

-   broad toolkit
-   hooks and utilities
-   relatively flexible
-   faster to build with

Tradeoff:

-   still a framework-level visual system that may require customization
    for a distinctive Covena identity

## shadcn

Strengths:

-   source code becomes part of the application
-   highly customizable
-   strong Tailwind integration
-   useful starting point

Important:

> shadcn should be treated as a source/distribution approach, not as
> Covena's visual identity.

## Radix / Base UI / React Aria

These are strong candidates for low-level accessible behavior.

The final choice should be made through a technical spike rather than
popularity.

------------------------------------------------------------------------

# 43. Recommended Component Spike

Before committing, prototype:

``` text
Button
Input
Select
Combobox
Dialog
Drawer
Dropdown
Tooltip
Tabs
Popover
DatePicker
Command palette
Data table interactions
```

Evaluate:

### Accessibility

-   keyboard navigation
-   focus management
-   screen readers
-   RTL
-   reduced motion
-   high contrast

### Interaction

-   nested dialogs
-   drawers
-   touch
-   pointer
-   keyboard
-   forms

### Developer experience

-   TypeScript
-   composition
-   controlled/uncontrolled state
-   customization

### Future compatibility

-   responsive variants
-   component metadata
-   AI composition
-   schema-driven rendering

Choose based on evidence.

------------------------------------------------------------------------

# 44. Recommended Direction

For Covena, the preferred direction is:

``` text
React / chosen framework
        ↓
TypeScript
        ↓
Tailwind/CSS implementation
        ↓
Covena design tokens
        ↓
Accessible primitive foundation
        ↓
Covena primitives
        ↓
Covena visual components
        ↓
Covena patterns
        ↓
Feature modules
        ↓
Workspace engine
        ↓
Pages
```

Do not make the product visually dependent on a vendor's default theme.

------------------------------------------------------------------------

# 45. Specialized Libraries

Where appropriate, prefer mature specialized infrastructure instead of
rebuilding everything:

``` text
TanStack Table       → complex tables
React Hook Form      → forms
Zod                  → schemas/validation
date-fns             → date operations
Recharts / equivalent → charts where suitable
Lucide / custom      → icons
Motion               → layout/motion/gestures
```

These are candidates, not mandatory dependencies.

------------------------------------------------------------------------

# 46. Workspace Engine Technology Evaluation

Evaluate several approaches before locking the implementation.

## React Grid Layout

Strong candidate for structured responsive dashboards.

Useful capabilities include:

-   dragging
-   resizing
-   responsive layouts
-   serialization
-   constraints
-   collision handling

## dnd-kit

Useful as a lower-level foundation when custom interaction behavior is
more important than a ready-made grid model.

## Muuri

Interesting for draggable/sortable/responsive and more unconventional
layouts.

## DashKit-style approaches

Useful to study for configurable widget/dashboard architectures.

The final decision should follow prototypes rather than theoretical
preference.

------------------------------------------------------------------------

# 47. Visual Workbench / Storybook

A component workbench should be part of the development process.

Each major visual component should be tested across:

``` text
Theme
├── Light
└── Dark

Density
├── Compact
├── Default
└── Comfortable

Window
├── Compact
├── Medium
└── Expanded

State
├── Default
├── Loading
├── Empty
├── Error
├── Disabled
├── Focused
└── Selected

Accessibility
├── Reduced motion
├── High contrast
└── Keyboard navigation
```

Visual regression testing should be considered for important components.

------------------------------------------------------------------------

# 48. Design Tokens

Recommended structure:

``` text
tokens/
├── primitives/
│   ├── color
│   ├── typography
│   ├── spacing
│   ├── radius
│   ├── shadow
│   ├── motion
│   └── breakpoint
│
├── semantic/
│   ├── background
│   ├── surface
│   ├── text
│   ├── border
│   ├── action
│   ├── status
│   └── focus
│
└── component/
    ├── button
    ├── input
    ├── table
    ├── navigation
    └── visual-modules
```

Use semantic tokens wherever possible.

------------------------------------------------------------------------

# 49. Density

Covena is an enterprise/work-management product, so density is a
product-level choice.

Support:

``` text
Compact
Default
Comfortable
```

Desktop tables can use compact/default density.

Mobile visual modules can use more comfortable spacing.

Do not force consumer-app spacing across all enterprise workflows.

------------------------------------------------------------------------

# 50. Page Anatomy

A page should have a consistent skeleton but not a generic visual
appearance.

Conceptually:

``` text
Context / breadcrumb
        ↓
Page title + purpose
        ↓
Actions / controls
        ↓
Filters / tabs where necessary
        ↓
Visual workspace / feature content
```

The main content should determine its own visual representation.

------------------------------------------------------------------------

# 51. Reference Page Strategy

Do not design every page independently first.

Build a small number of reference experiences:

1.  Employees
2.  Attendance
3.  Projects
4.  Dashboard / Workspace
5.  Settings

Use these to validate:

-   tokens
-   typography
-   motion
-   responsive behavior
-   visual component language
-   workspace engine
-   customization
-   accessibility

Once these are strong, the remaining pages should compose the
established system.

------------------------------------------------------------------------

# 52. Production Design Principles

### Principle 1

**Content over chrome.**

### Principle 2

**Visualize information according to its natural structure.**

### Principle 3

**Generic components are infrastructure, not the final experience.**

### Principle 4

**Responsive behavior is architectural, not a finishing step.**

### Principle 5

**Adaptive layout can change composition, not merely size.**

### Principle 6

**User customization should be persistent and controlled.**

### Principle 7

**AI should propose or compose within trusted boundaries.**

### Principle 8

**Motion should communicate continuity and relationships.**

### Principle 9

**Accessibility is part of the design system.**

### Principle 10

**The design system should be independent of its underlying component
vendor.**

### Principle 11

**Feature ownership should determine code ownership.**

### Principle 12

**Design for current product needs while preserving machine-readable UI
contracts for future GenUI.**

------------------------------------------------------------------------

# 53. What We Should Avoid

Avoid:

-   generic card grids everywhere
-   excessive rounded rectangles
-   arbitrary gradients
-   excessive glass/blur
-   animation for decoration
-   inconsistent radii
-   random icon styles
-   random spacing
-   giant global components folders
-   page-specific business logic inside generic UI
-   desktop-first then "fix mobile"
-   separate mobile and desktop implementations of the same domain
-   vendor components leaking through the application architecture
-   arbitrary AI-generated HTML
-   storing executable UI code in the database
-   silent AI-driven layout changes
-   over-engineered frontend architecture
-   creating abstractions before evidence of reuse

------------------------------------------------------------------------

# 54. What We Should Encourage

Encourage:

-   distinctive visual representations
-   semantic tokens
-   custom domain visualizations
-   spatial relationships
-   purposeful motion
-   adaptive composition
-   user-configurable workspaces
-   saved views
-   persistent layouts
-   undo/redo
-   responsive module variants
-   accessibility-aware animation
-   custom symbols
-   visual continuity
-   AI-assisted customization
-   structured GenUI
-   feature ownership
-   replaceable primitive foundations

------------------------------------------------------------------------

# 55. Example: Attendance

Instead of:

``` text
┌──────────────────┐
│ Attendance       │
│                  │
│ 8h 42m           │
└──────────────────┘
```

Prefer a dedicated visual model:

``` text
WORKDAY

09:27
  ●───────────────●───────────────
  in              now             expected out

7h 42m elapsed
```

On compact screens, this can become:

``` text
09:27
●────────────
7h 42m
Working
```

The information stays the same.

The composition adapts.

------------------------------------------------------------------------

# 56. Example: Project

Instead of:

``` text
Project Health
72%
```

Use:

``` text
PROJECT / AROHA

Brief ━━━━━●━━━━ Build ━━━━━ Review

72% complete
3 milestones
2 blocked
```

The visual metaphor is a project flow.

------------------------------------------------------------------------

# 57. Example: Team Presence

Instead of:

``` text
Team
8 employees
```

Use:

``` text
TEAM PRESENCE

● ● ● ● ● ○ ○ ●

8 working
1 away
2 offline
```

The representation communicates presence directly.

------------------------------------------------------------------------

# 58. Example: Workspace

Normal:

``` text
Good morning

[Attendance Pulse]   [Today's Schedule]

[Project Pulse]       [Team Presence]

[Activity Stream]
```

Customize:

``` text
Customize workspace

[Attendance Pulse]      [Team Presence]

       [Project Pulse]

[+ Add module]
```

User can:

-   drag
-   resize
-   remove
-   pin
-   configure
-   save

------------------------------------------------------------------------

# 59. Future: AI Workspace

User:

> "Create a workspace for my Monday planning."

Potential generated composition:

``` text
Monday Planning

Today's schedule
Outstanding tasks
Project deadlines
Team availability
Notes
Quick actions
```

The AI chooses trusted modules.

It does not create arbitrary React code.

------------------------------------------------------------------------

# 60. Future: AI Data Exploration

User:

> "Show me teams with the highest workload and their attendance this
> week."

Potential composition:

``` text
TEAM WORKLOAD

Engineering       ████████████
Design            ████████
Marketing         █████

────────────────────────────────

Attendance trend

Mon ──●
Tue ───●
Wed ─────●
Thu ───●
Fri ──●
```

The result can be temporary or saved as a workspace.

------------------------------------------------------------------------

# 61. Versioning

Avoid:

``` text
ButtonV1
ButtonV2
ButtonModern
```

Prefer a stable semantic API:

``` tsx
<Button variant="primary" />
```

while implementation evolves underneath.

Version the design system at the system/API level:

``` text
Covena Design System v0.x
Covena Design System v1.x
```

Maintain compatibility wherever practical.

------------------------------------------------------------------------

# 62. Research Baseline

The architecture is informed by current work and discussions around:

### Apple

-   Human Interface Guidelines
-   adaptive layouts
-   Liquid Glass
-   materials
-   motion
-   SF Symbols
-   custom symbols

### Google

-   adaptive app/window-size guidance
-   canonical layouts
-   responsive/adaptive composition
-   generative UI research

### W3C

-   Design Tokens Community Group
-   machine-readable UI specification discussions

### React ecosystem

-   shadcn
-   Radix
-   Base UI
-   React Aria
-   React Grid Layout
-   dnd-kit
-   Muuri
-   component workbench/Storybook ecosystem

### HCI research

-   adaptive interfaces
-   user-driven customization
-   mixed-initiative personalization
-   generative interfaces
-   elicitive UI

### Developer communities

Reddit/GitHub discussions consistently show tradeoffs between: - mature
opinionated libraries - code-owned component systems - headless
primitives - custom design systems - feature-oriented architecture -
configurable dashboards - draggable/resizable workspaces

These sources should be rechecked when making final implementation
choices because the ecosystem changes rapidly.

------------------------------------------------------------------------

# 63. Useful Research Sources

-   Apple Human Interface Guidelines --- Layout\
    https://developer.apple.com/design/human-interface-guidelines/layout

-   Apple Technology Overview --- Liquid Glass\
    https://developer.apple.com/documentation/TechnologyOverviews/liquid-glass

-   Apple --- SF Symbols\
    https://developer.apple.com/sf-symbols/

-   Apple Design Resources\
    https://developer.apple.com/design/resources/

-   Google Adaptive Apps\
    https://developer.android.com/develop/adaptive-apps

-   Google Adaptive Layouts\
    https://developer.android.com/develop/adaptive-apps/guides/canonical-layouts

-   W3C Design Tokens Community Group\
    https://www.w3.org/community/design-tokens/

-   W3C UI Specification Schema Community Group\
    https://www.w3.org/groups/cg/uispec/

-   shadcn/ui\
    https://ui.shadcn.com/

-   shadcn/ui GitHub\
    https://github.com/shadcn-ui/ui

-   Feature-Sliced Design\
    https://github.com/feature-sliced/documentation

-   React Grid Layout\
    https://github.com/react-grid-layout/react-grid-layout

-   dnd-kit\
    https://github.com/clauderic/dnd-kit

-   Muuri\
    https://github.com/haltu/muuri

-   Generative Interfaces --- ACL 2026\
    https://aclanthology.org/2026.findings-acl.74/

-   Generative Interfaces implementation\
    https://github.com/SALT-NLP/GenUI

-   Google Research --- Generative UI\
    https://research.google/blog/generative-ui-a-rich-custom-visual-interactive-user-experience-for-any-prompt/

------------------------------------------------------------------------

# 64. Final Architecture Decision

The accepted Covena direction is:

``` text
                         COVENA
                           │
              ┌────────────┴────────────┐
              │                         │
         PRODUCT MODEL             VISUAL MODEL
              │                         │
       Features / Data             Visual Grammar
       Workflows                   Geometry
       Permissions                 Typography
       Business rules              Material
              │                     Motion
              │                     Iconography
              │                         │
              └────────────┬────────────┘
                           │
                    DESIGN SYSTEM
                           │
             ┌─────────────┼─────────────┐
             │             │             │
        Primitives      Visual        Patterns
                        Modules
             │             │             │
             └─────────────┼─────────────┘
                           │
                    WORKSPACE ENGINE
                           │
             ┌─────────────┴─────────────┐
             │                           │
       Structured Grid              Freeform Canvas
             │                           │
             └─────────────┬─────────────┘
                           │
                    PERSONALIZATION
                           │
                ┌──────────┴──────────┐
                │                     │
             User                    AI
           Controls               Assistance
                │                     │
                └──────────┬──────────┘
                           │
                         GenUI
```

## The core idea

> **Covena's design system is not a collection of buttons and cards. It
> is a visual language for representing work.**

The product should feel:

-   designed rather than assembled
-   visual rather than dashboard-generic
-   spatial rather than rigid
-   responsive rather than merely shrunk
-   adaptive rather than static
-   customizable rather than one-size-fits-all
-   animated with purpose rather than decorated
-   AI-ready without being AI-dependent

The system should provide a **strong default experience** while allowing
users and, eventually, AI to compose that experience within safe and
coherent boundaries.

------------------------------------------------------------------------

# 65. Implementation Sequence

The recommended implementation order is:

## Phase 1 --- Visual foundations

-   typography
-   color
-   spacing
-   geometry
-   surfaces
-   iconography
-   motion
-   accessibility

## Phase 2 --- Primitive foundation

-   controls
-   overlays
-   navigation
-   form primitives
-   surface primitives

## Phase 3 --- Visual language

Build custom:

-   timeline
-   presence
-   progress
-   activity
-   relationship
-   flow
-   capacity
-   data visualization

## Phase 4 --- Responsive system

Validate:

``` text
compact
medium
expanded
```

across the reference experiences.

## Phase 5 --- Feature architecture

Implement:

-   Employees
-   Attendance
-   Projects
-   Tasks
-   Settings

using the system.

## Phase 6 --- Workspace engine

Implement:

-   grid
-   drag
-   resize
-   persistence
-   responsive layouts
-   pinning
-   undo/redo
-   customization mode

## Phase 7 --- Personalization

Implement:

-   user preferences
-   saved views
-   workspace templates
-   organization defaults
-   role defaults

## Phase 8 --- GenUI contracts

Add:

-   component schemas
-   module registry
-   capability metadata
-   permission-aware rendering
-   structured UI specifications

## Phase 9 --- AI-assisted workspace

Add:

-   natural-language layout changes
-   suggested personalization
-   generated temporary workspaces
-   AI-generated analytical compositions

------------------------------------------------------------------------

# 66. Final Product Principle

**Build the system before building the screens.**

But the "system" is not merely:

``` text
Button
Card
Table
```

It is:

``` text
Visual language
+
Information visualization
+
Motion
+
Responsive composition
+
Workspace behavior
+
Customization
+
Accessibility
+
Feature architecture
+
AI-readable contracts
```

Once that foundation is correct, individual Covena pages should feel
like **different expressions of the same product**, not separate UI
projects.
