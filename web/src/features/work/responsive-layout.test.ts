import { readFileSync } from "node:fs";
import { describe, expect, it } from "bun:test";

const read = (path: string) => readFileSync(new URL(path, import.meta.url), "utf8");

describe("responsive layout contracts", () => {
  it("keeps a useful desktop content track while the rail adapts", () => {
    const shell = read("../../app-shell/AppShell.module.css");
    const navigation = read("../../app-shell/Navigation.module.css");
    const topBar = read("../../app-shell/TopBar.module.css");
    const shellComponent = read("../../app-shell/AppShell.tsx");
    const shellBreakpoints = read("../../app-shell/breakpoints.ts");
    expect(shell).toContain("grid-template-columns: var(--nova-navigation-width-expanded) minmax(0, 1fr)");
    expect(shell).toContain("grid-template-columns: var(--nova-navigation-width-compact) minmax(0, 1fr)");
    expect(shell).toMatch(/@media\s*\(max-width:\s*1199px\)[\s\S]*?grid-template-columns: minmax\(0, 1fr\)/);
    expect(navigation).toMatch(/@media\s*\(max-width:\s*1199px\)[\s\S]*?\.desktopSidebar\s*\{\s*display: none/);
    expect(topBar).toMatch(/@media\s*\(min-width:\s*1200px\)[\s\S]*?\.start\s*\{\s*display: none/);
    expect(topBar).toMatch(/@media\s*\(max-width:\s*1199px\)/);
    expect(shellComponent).toContain("matchMedia(EXPANDED_NAVIGATION_MEDIA_QUERY)");
    expect(shellBreakpoints).toContain("EXPANDED_NAVIGATION_MIN_WIDTH_PX = 1200");
    expect(shellBreakpoints).toContain("`(min-width: ${EXPANDED_NAVIGATION_MIN_WIDTH_PX}px)`");
  });

  it("stacks My Day and adapts its module grid to the available page width", () => {
    const page = read("../my-day/MyDayPage.module.css");
    expect(page).toMatch(/@container my-day-page\s*\(max-width:\s*60rem\)/);
    expect(page).toMatch(/@container my-day-page\s*\(max-width:\s*40rem\)/);
    expect(page).toContain("grid-template-columns: minmax(0, 1fr); gap: var(--nova-space-6)");
  });

  it("reflows Work filters in their own containers and provides touch-sized task links", () => {
    const visibleTasks = read("./VisibleTasks.module.css");
    const assignments = read("./MyAssignments.module.css");
    const assignmentSummary = read("../assignments/AssignmentList.module.css");
    expect(visibleTasks).toMatch(/@container visible-tasks\s*\(max-width:\s*60rem\)/);
    expect(visibleTasks).toMatch(/@container visible-tasks\s*\(max-width:\s*40rem\)/);
    expect(visibleTasks).toContain("grid-template-columns: repeat(2, minmax(0, 1fr))");
    expect(assignments).toMatch(/@container assignments\s*\(max-width:\s*60rem\)/);
    expect(assignments).toContain("grid-template-columns: minmax(8rem, 1.9fr) minmax(5.5rem, 0.7fr) minmax(6rem, 0.8fr) minmax(9.5rem, 1.45fr)");
    expect(assignments).toMatch(/@container assignments \(max-width: 34rem\)[\s\S]*?\.collectionHeader \{ display: none; \}[\s\S]*?grid-template-columns: repeat\(2, minmax\(0, 1fr\)\)/);
    expect(assignments).toMatch(/@container assignments \(max-width: 22rem\)[\s\S]*?grid-template-columns: minmax\(0, 1fr\)/);
    expect(assignments).toMatch(/@media \(any-pointer: coarse\)[\s\S]*?\.actions :global\(button\)[\s\S]*?min-height: var\(--nova-control-touch-target\)/);
    expect(visibleTasks).toMatch(/@media\s*\(any-pointer:\s*coarse\)[\s\S]*?\.title a\s*\{\s*min-height: var\(--nova-control-touch-target\)/);
    expect(visibleTasks).toMatch(/@media\s*\(any-pointer:\s*coarse\)[\s\S]*?\.filterActions > :global\(button\)\s*\{\s*min-height: var\(--nova-control-touch-target\);\s*\}/);
    expect(assignments).toMatch(/@media \(any-pointer: coarse\)[\s\S]*?\.filterActions > :global\(button\)[\s\S]*?min-height: var\(--nova-control-touch-target\)/);
    expect(assignmentSummary).toMatch(/@media\s*\(any-pointer:\s*coarse\)[\s\S]*?\.title a\s*\{\s*min-height: var\(--nova-control-touch-target\)/);
  });

  it("gives assignment collections room for their table layout and preserves narrow-card labels", () => {
    const work = read("./WorkPage.module.css");
    const assignments = read("./MyAssignments.module.css");
    expect(work).toMatch(/\.section\[data-section="assignments"\],[\s\S]*?\.section\[data-section="tasks"\],[\s\S]*?grid-column:\s*1\s*\/\s*-1/);
    expect(assignments).toMatch(/@container assignments \(max-width: 34rem\)[\s\S]*?\.collectionHeader \{ display: none; \}[\s\S]*?\.task,[\s\S]*?\.actions \{\s*grid-column: 1 \/ -1;/);
    expect(assignments).toMatch(/@container assignments \(max-width: 34rem\)[\s\S]*?\.fieldLabel \{[\s\S]*?position: static/);
    expect(assignments).toMatch(/@container assignments \(max-width: 22rem\)[\s\S]*?grid-template-columns: minmax\(0, 1fr\)/);
  });

  it("keeps Work surfaces explicit and leaves feature controls to their owners", () => {
    const tokens = read("../../design-system/foundations/tokens.css");
    const work = read("./WorkPage.module.css");
    for (const token of ["body", "label", "title", "heading"]) {
      expect(tokens).toContain(`--nova-type-${token}:`);
    }
    expect(work).toContain('.section[data-section="create"]');
    expect(work).toContain('.section[data-section="sessions"]');
    expect(work).toContain('.section[data-section="assignments"]');
    expect(work).toContain('.section[data-section="tasks"]');
    expect(work).not.toContain('.section[data-section="sessions"] > :global(section > .panel-header');
    expect(work).not.toContain(".feature-section");
    expect(work).not.toMatch(/:global\((?:label|input|select|textarea|button|p)\b/);
    expect(work).toMatch(/@container work-board\s*\(max-width:\s*40rem\)/);
  });

  it("raises the Work timeline date field to the touch target size on coarse pointers", () => {
    const work = read("./WorkPage.module.css");
    expect(work).toMatch(/@media \(any-pointer: coarse\)[\s\S]*?\.timelineControl input,[\s\S]*?min-height: var\(--nova-control-touch-target\)/);
  });

  it("keeps the recorded-session heading presentation in its owning feature", () => {
    const work = read("./WorkPage.module.css");
    const sessions = read("./sessions/WorkSessions.module.css");
    expect(work).toContain(".sectionHeader h2");
    expect(work).toContain(".sectionHeader p");
    expect(sessions).not.toContain("[data-section=\"sessions\"]");
  });

  it("keeps reviewer management responsive and styled at its feature boundary", () => {
    const reviewerManagement = read("./reviewer-management/ReviewerManagement.module.css");
    const tokens = read("../../design-system/foundations/tokens.css");
    const declared = new Set([...tokens.matchAll(/(--nova-[\w-]+)\s*:/g)].map((match) => match[1]));
    const referenced = [...new Set([...reviewerManagement.matchAll(/var\((--nova-[\w-]+)/g)].map((match) => match[1]))];
    expect(reviewerManagement).toContain("container: reviewer-management / inline-size");
    expect(reviewerManagement).toMatch(/@container reviewer-management \(max-width: 60rem\)/);
    expect(reviewerManagement).toMatch(/@container reviewer-management \(max-width: 40rem\)/);
    expect(reviewerManagement).toMatch(/@media \(forced-colors: active\)/);
    expect(reviewerManagement).toContain("--nova-control-touch-target");
    expect(reviewerManagement).toMatch(/:focus-visible/);
    expect(referenced.length).toBeGreaterThan(0);
    for (const token of referenced) expect(declared.has(token)).toBe(true);
  });
});
