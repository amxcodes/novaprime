import type { ReactNode } from "react";
import type { WorkReadPlan } from "./read-capabilities";

export type WorkPageSectionId =
  | "assignments"
  | "tasks"
  | "reviews"
  | "collaboration"
  | "reviewer-management"
  | "create"
  | "sessions"
  | "timeline"
  | "context"
  | "task-detail";

export interface WorkPageSection {
  id: WorkPageSectionId;
  heading?: string;
  description?: string;
}

/**
 * Optional page-owned content for a section already present in the host's
 * prepared section list. Missing entries retain the transitional mount slot;
 * this map never controls feature visibility or route authorization.
 */
export type WorkPageSectionContent = Partial<Record<WorkPageSectionId, ReactNode>>;

export interface WorkPageSectionOptions {
  canCreateTasks: boolean;
  hasReviewRoute: boolean;
  taskDetailRoute: boolean;
  focusedCollaborationRequest?: boolean;
}

/** Present only the modules the route host has authorized and prepared. */
export function createWorkPageSections(
  reads: Readonly<WorkReadPlan>,
  options: WorkPageSectionOptions,
): ReadonlyArray<WorkPageSection> {
  if (options.taskDetailRoute) return [{ id: "task-detail" }];
  if (options.hasReviewRoute) return reads.reviews ? [{ id: "reviews" }] : [];
  if (options.focusedCollaborationRequest) {
    return reads.reviewerRequests || reads.handoverRequests ? [{ id: "collaboration" }] : [];
  }

  const sections: WorkPageSection[] = [];
  if (reads.assignments) sections.push({ id: "assignments" });
  if (reads.taskCollection) sections.push({ id: "tasks" });
  if (reads.reviews) sections.push({ id: "reviews" });
  if (reads.reviewerRequests || reads.handoverRequests) sections.push({ id: "collaboration" });
  if (reads.reviewerManagement) sections.push({ id: "reviewer-management" });
  if (options.canCreateTasks) sections.push({ id: "create" });
  if (reads.sessions) {
    sections.push({
      id: "sessions",
      heading: "Recorded work sessions",
      description: "Pause closes a segment; starting again creates a new segment without changing recorded history.",
    });
  }
  if (reads.timeline || reads.attendance) sections.push({ id: "timeline" });
  if (reads.workContextView) sections.push({ id: "context" });
  return sections;
}

export interface WorkPageNotice {
  id: string;
  kind: "warning" | "error";
  message: string;
}
