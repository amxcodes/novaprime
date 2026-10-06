import { readFileSync } from "node:fs";
import { describe, expect, it } from "bun:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { OperationsOverview } from "./OperationsOverview";
import type { OperationsOverviewProps } from "./contracts";

const baseProps: Pick<OperationsOverviewProps,
  "onRetry" | "onSearchPeople" | "onNextPeoplePage" | "onPreviousPeoplePage" | "onRetryPeople" | "onRetryPeoplePage" |
  "onNextTasksPage" | "onPreviousTasksPage" | "onRetryTasks" | "onRetryTasksPage" |
  "personHistoryHref" | "onViewPersonHistory" | "taskDetailHref" | "onOpenTask"> = {
  onRetry: () => {},
  onSearchPeople: () => {},
  onNextPeoplePage: () => {},
  onPreviousPeoplePage: () => {},
  onRetryPeople: () => {},
  onRetryPeoplePage: () => {},
  onNextTasksPage: () => {},
  onPreviousTasksPage: () => {},
  onRetryTasks: () => {},
  onRetryTasksPage: () => {},
  personHistoryHref: (id) => `/?view=people&person=${id}`,
  onViewPersonHistory: () => {},
  taskDetailHref: (id) => `/?view=work&task=${id}`,
  onOpenTask: () => {},
};

const peoplePage: NonNullable<OperationsOverviewProps["people"]> = {
  status: "ready",
  data: {
    people: [{ id: "person-1", displayName: "Taylor Example", email: "taylor@example.test" }],
    query: "Taylor",
    cursor: null,
    limit: 25,
    hasMore: true,
    nextCursor: "next-page",
    hasPrevious: false,
  },
  loadingPage: false,
};

function render(props: Partial<OperationsOverviewProps>) {
  return renderToStaticMarkup(createElement(OperationsOverview, { ...baseProps, ...props }));
}

function extractBlock(source: string, ruleStart: number) {
  const open = source.indexOf("{", ruleStart);
  if (open < 0) return "";
  let depth = 0;
  for (let index = open; index < source.length; index += 1) {
    if (source[index] === "{") depth += 1;
    else if (source[index] === "}") {
      depth -= 1;
      if (depth === 0) return source.slice(open + 1, index);
    }
  }
  return "";
}

describe("OperationsOverview grant-scoped reports", () => {
  it("shows no report sections when the host supplied no grant-enabled sources", () => {
    const markup = render({});
    expect(markup).toContain("No Operations reports are available");
    expect(markup).not.toContain("Team and people");
    expect(markup).not.toContain("Task context");
    expect(markup).not.toContain("Availability configuration");
  });

  it("shows only the availability source granted by the host", () => {
    const markup = render({
      availability: { status: "ready", data: { shifts: [], calendars: [], holidays: [] } },
      availabilitySources: { shifts: false, calendars: true, holidays: false },
    });
    expect(markup).toContain("Working calendars");
    expect(markup).not.toContain(">Shifts<");
    expect(markup).not.toContain(">Holidays<");
    expect(markup).not.toContain("Task context");
    expect(markup).not.toContain("Team and people");
  });

  it("keeps a denied source isolated from other ready reports", () => {
    const markup = render({
      people: { status: "denied", message: "People report is not available to this role." },
      tasks: { status: "ready", data: {
        tasks: [], cursor: null, limit: 30, hasMore: false, nextCursor: null, pageNumber: 1, hasPrevious: false,
      }, loadingPage: false },
    });
    expect(markup).toContain("People report unavailable");
    expect(markup).toContain("People report is not available to this role.");
    expect(markup).toContain("Task context");
    expect(markup).toContain("No visible tasks on this page");
  });

  it("provides cell labels and container-driven stacked rows for narrow screens", () => {
    const markup = render({
      people: peoplePage,
      tasks: {
        status: "ready",
        data: {
          tasks: [{
            id: "task-1",
            title: "A long task title that must wrap inside a narrow responsive row",
            status: "in_progress",
            priority: "high",
            dueDate: null,
            assignmentCount: 4,
            client: null,
            workstream: { name: "Delivery" },
            group: null,
            department: null,
          }],
          cursor: null,
          limit: 30,
          hasMore: true,
          nextCursor: "next-task-page",
          pageNumber: 1,
          hasPrevious: false,
        },
        loadingPage: false,
      },
    });
    const css = readFileSync(new URL("./OperationsOverview.module.css", import.meta.url), "utf8");
    expect(markup).toContain('aria-label="People visible on the current Operations report page"');
    expect(markup).toContain('aria-label="People report pages"');
    expect(markup).toContain("Showing this page only; no total is available.");
    expect(markup).toContain("Search people");
    expect(markup).toContain('data-label="Person"');
    expect(markup).toContain('data-label="History"');
    expect(markup).toContain("A long task title that must wrap inside a narrow responsive row");
    expect(markup).toContain("In progress");
    expect(markup).toContain("Non-cancelled assignments");
    expect(markup).toContain("4");
    expect(markup).toContain("Page 1: 1 task shown, up to 30 per page");
    expect(markup).toContain('aria-label="Task report pages"');
    expect(markup).toContain("Download this task page CSV");
    expect(css).toMatch(/@container\s+operations-overview\s*\(max-width:\s*60rem\)/);
    expect(css).toContain("content: attr(data-label)");
    expect(css).toContain("overflow-wrap: anywhere");
    expect(css).toContain(".taskRow { grid-template-columns: minmax(0, 1fr); }");
    expect(css).toMatch(/\.panel \.panelHeading\s*\{[\s\S]*?grid-template-columns:\s*minmax\(0, 1fr\) auto/);
    expect(css).toMatch(/\.panel\s*\{[\s\S]*?container:\s*operations-report-panel\s*\/\s*inline-size/);
    expect(css).toMatch(/@container\s+operations-report-panel\s*\(max-width:\s*38rem\)[\s\S]*?\.panel \.panelHeading\s*\{[\s\S]*?grid-template-columns:\s*minmax\(0, 1fr\)/);
    expect(css).toMatch(/@container\s+operations-report-panel\s*\(max-width:\s*38rem\)[\s\S]*?\.panel \.panelHeading\s*>\s*:last-child\s*\{[^}]*justify-content:\s*flex-start/);
    expect(css).not.toContain(":global(.sectionActions)");
  });

  it("keeps task export/page scope explicit and shows loading and retryable continuation states", () => {
    const loading = render({ tasks: { status: "loading" } });
    expect(loading).toContain("Loading visible tasks");

    const pageError = render({
      tasks: {
        status: "ready",
        data: {
          tasks: [], cursor: "cursor-one", limit: 30, hasMore: true, nextCursor: "cursor-two",
          pageNumber: 2, hasPrevious: true,
        },
        loadingPage: false,
        pageError: "Access changed. Retry this page.",
      },
    });
    expect(pageError).toContain("Could not change task page");
    expect(pageError).toContain("Access changed. Retry this page.");
    expect(pageError).toContain("CSV includes only this page");
    expect(pageError).toContain("Previous page");
    expect(pageError).toContain("Next page");
  });

  it("communicates loading, query-specific empty, denied, and retryable page-failure states", () => {
    const loading = render({ people: { status: "loading", query: "Morgan" } });
    expect(loading).toContain("Loading people");
    expect(loading).toContain("Morgan");
    expect(loading).toMatch(/tabindex="-1"[^>]*data-kind="info"[^>]*role="status"/);

    const empty = render({
      people: {
        status: "ready",
        data: { people: [], query: "No match", cursor: null, limit: 25, hasMore: false, nextCursor: null, hasPrevious: false },
        loadingPage: false,
      },
    });
    expect(empty).toContain("No people match this search");

    const denied = render({ people: { status: "denied", message: "Access was removed." } });
    expect(denied).toContain("Access was removed.");
    expect(denied).not.toContain("Taylor Example");

    const pageFailure = render({ people: { ...peoplePage, pageError: "Could not load this page." } });
    expect(pageFailure).toContain("Could not change people page");
    expect(pageFailure).toContain("Could not load this page.");
    expect(pageFailure).toContain("Try again");

    const pageLoading = render({ people: { ...peoplePage, loadingPage: true } });
    expect(pageLoading).toMatch(/<span[^>]*tabindex="-1"[^>]*aria-live="polite">Loading page…<\/span>/);
  });

  it("labels the page-local export and provides a responsive search and pagination layout", () => {
    const markup = render({ people: peoplePage });
    const css = readFileSync(new URL("./OperationsOverview.module.css", import.meta.url), "utf8");
    expect(markup).toContain("Pages and exports contain only the rows currently shown.");
    expect(markup).toContain("A next page is available.");
    expect(css).toMatch(/\.peopleSearch\s*\{[^}]*grid-template-columns:\s*minmax\(0, 1fr\) auto/);
    expect(css).toContain(".peoplePagination");
    expect(css).toMatch(/@container\s+operations-report-panel\s+\(max-width:\s*38rem\)[\s\S]*?\.pageProgress\s*\{[^}]*flex-basis:\s*100%/);
  });

  it("adapts compact Operations spacing, source rows, and recovery forms to its actual container", () => {
    const css = readFileSync(new URL("./OperationsOverview.module.css", import.meta.url), "utf8");
    expect(css).toMatch(/\.overview\s*\{[^}]*container:\s*operations-overview\s*\/\s*inline-size/);
    const query = "@container operations-overview (max-width: 39.9375rem)";
    const queryStart = css.indexOf(query);
    expect(queryStart).toBeGreaterThanOrEqual(0);
    const compactRules = extractBlock(css, queryStart);
    expect(compactRules).toMatch(/\.reportGrid\s*\{[^}]*gap:\s*var\(--nova-space-4\)/);
    expect(compactRules).toMatch(/\.panel\s*\{[^}]*padding:\s*var\(--nova-space-4\)/);
    expect(compactRules).toMatch(/\.availabilitySource li\s*\{[^}]*grid-template-columns:\s*minmax\(0, 1fr\)/);
    expect(compactRules).toMatch(/\.recovery :global\(\.feature-section\)\s*\{[^}]*padding:\s*var\(--nova-space-4\)/);
    expect(compactRules).toMatch(/\.recovery :global\(\.form-grid\)\s*\{[^}]*grid-template-columns:\s*minmax\(0, 1fr\)/);
    expect(css).not.toContain("@media (max-width: 639px)");
  });

  it("keeps task-detail links touch-sized on coarse pointers without widening the task row", () => {
    const css = readFileSync(new URL("./OperationsOverview.module.css", import.meta.url), "utf8");
    const coarsePointerStart = css.indexOf("@media (any-pointer: coarse)");
    expect(coarsePointerStart).toBeGreaterThanOrEqual(0);
    const coarsePointerRules = extractBlock(css, coarsePointerStart);

    expect(coarsePointerRules).toMatch(/\.taskIdentity a\s*\{[^}]*display:\s*inline-block;[^}]*max-width:\s*100%;[^}]*min-height:\s*var\(--nova-control-touch-target\);/);
    expect(css).toMatch(/\.taskIdentity h3\s*\{[^}]*overflow-wrap:\s*anywhere;/);
  });
});
