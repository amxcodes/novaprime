import { describe, expect, it } from "bun:test";
import { readFileSync } from "node:fs";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { isEligibleAssignmentCandidate, MyAssignments } from "./MyAssignments";
import type { WorkAssignment, WorkMyAssignmentsProps } from "./contracts";

function renderAssignment(
  canViewTask: boolean,
  onLoadCandidates: WorkMyAssignmentsProps["onLoadCandidates"] = async () => ({
    reviewers: [], handoverTargets: [],
  }),
) {
  const assignment: WorkAssignment = {
    assignmentId: "assignment-1",
    taskId: "task-1",
    title: "Prepare the delivery brief",
    canViewTask,
    status: "assigned",
    dueDate: null,
    dueDateRevision: 0,
    canEditDueDate: false,
    canStart: false,
    canSubmit: false,
    canRequestReviewer: true,
    canRequestHandover: false,
    hasPendingReviewerRequest: false,
    hasPendingHandoverRequest: false,
  };
  const props: WorkMyAssignmentsProps = {
    read: { status: "ready", data: { assignments: [assignment], hasMore: false, nextCursor: null, limit: 30 } },
    filters: { status: "all", due: "any", search: "", cursor: "" },
    taskDetailHref: (taskId) => `/?view=work&task=${taskId}`,
    onApplyFilters: () => {},
    onClearFilters: () => {},
    onOpenTask: () => {},
    onStart: () => {},
    onSubmit: () => {},
    onLoadCandidates,
    onSaveDueDate: () => {},
    onRequestReviewer: () => {},
    onRequestHandover: () => {},
    onOlder: () => {},
    onNewer: () => {},
  };
  return renderToStaticMarkup(createElement(MyAssignments, props));
}

describe("MyAssignments task-detail visibility", () => {
  it("keeps assignment-only titles as plain text without a task-detail link", () => {
    const markup = renderAssignment(false);
    expect(markup).toContain("Prepare the delivery brief");
    expect(markup).not.toContain("href=\"/?view=work&amp;task=task-1\"");
    expect(markup).not.toContain("<a ");
  });

  it("links to task detail only when the API grants task visibility", () => {
    const markup = renderAssignment(true);
    expect(markup).toContain("href=\"/?view=work&amp;task=task-1\"");
  });

  it("does not request eligible teammates while the assignment list is first rendered", () => {
    let reads = 0;
    const markup = renderAssignment(false, async () => {
      reads += 1;
      return { reviewers: [], handoverTargets: [] };
    });
    expect(markup).toContain("<details");
    expect(reads).toBe(0);
  });

  it("replaces native disclosure markers with a theme-aware indicator", () => {
    const css = readFileSync(new URL("./MyAssignments.module.css", import.meta.url), "utf8");
    expect(css).toMatch(/\.dueEditor summary,\s*\.collaboration summary\s*\{[^}]*list-style:\s*none/s);
    expect(css).toMatch(/summary::-webkit-details-marker\s*\{\s*display:\s*none/s);
    expect(css).toMatch(/summary::after\s*\{[^}]*border-inline-end:\s*1\.5px solid currentColor/s);
    expect(css).toMatch(/summary::after\s*\{[^}]*border-block-end:\s*1\.5px solid currentColor/s);
    expect(css).toMatch(/@media\s*\(forced-colors:\s*active\)[\s\S]*?summary::after\s*\{[^}]*border-color:\s*currentColor/s);
    expect(css).toMatch(/@media\s*\(prefers-reduced-motion:\s*reduce\)[\s\S]*?summary::after\s*\{[^}]*transition:\s*none/s);
  });

  it("uses authored filter controls while retaining the existing named form values", () => {
    const markup = renderAssignment(true);
    expect(markup.match(/aria-haspopup="listbox"/g)?.length).toBe(2);
    expect(markup).toMatch(/<select tabindex="-1" name="status">[\s\S]*?<option value="all" selected="">All statuses/);
    expect(markup).toMatch(/<select tabindex="-1" name="due">[\s\S]*?<option value="any" selected="">Any due date/);
    expect(markup).not.toMatch(/<select(?! tabindex="-1")/);
  });

  it("accepts candidate values only from the current authorized options", () => {
    const candidates = [{ id: "person-1", displayName: "Aman Verma" }];
    expect(isEligibleAssignmentCandidate("person-1", candidates)).toBe(true);
    expect(isEligibleAssignmentCandidate("person-2", candidates)).toBe(false);
    expect(isEligibleAssignmentCandidate("", candidates)).toBe(false);
  });
});
