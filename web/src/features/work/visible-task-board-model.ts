import type { VisibleTask } from "./contracts";

export const VISIBLE_TASK_BOARD_LANE_DEFINITIONS = [
  { id: "up-next", label: "To do", statuses: ["backlog", "ready"] },
  { id: "in-progress", label: "In progress", statuses: ["in_progress"] },
  { id: "review", label: "In review", statuses: ["submitted"] },
  { id: "complete", label: "Complete", statuses: ["approved", "done"] },
  { id: "attention", label: "Needs attention", statuses: ["blocked", "returned"] },
  { id: "cancelled", label: "Cancelled", statuses: ["cancelled"] },
  { id: "other", label: "Other statuses", statuses: [] },
] as const;

export type VisibleTaskBoardLaneId = typeof VISIBLE_TASK_BOARD_LANE_DEFINITIONS[number]["id"];

export interface VisibleTaskBoardLane {
  id: VisibleTaskBoardLaneId;
  label: string;
  tasks: ReadonlyArray<VisibleTask>;
}

const laneByStatus = new Map<string, VisibleTaskBoardLaneId>(
  VISIBLE_TASK_BOARD_LANE_DEFINITIONS.flatMap((lane) => lane.statuses.map((status) => [status, lane.id] as const)),
);

/** Group the current server-provided page by its existing status, without implying a status transition. */
export function groupVisibleTasksByBoardLane(tasks: ReadonlyArray<VisibleTask>): VisibleTaskBoardLane[] {
  const grouped = new Map<VisibleTaskBoardLaneId, VisibleTask[]>();

  for (const task of tasks) {
    const laneId = laneByStatus.get(String(task.status).toLowerCase()) ?? "other";
    const laneTasks = grouped.get(laneId) ?? [];
    laneTasks.push(task);
    grouped.set(laneId, laneTasks);
  }

  return VISIBLE_TASK_BOARD_LANE_DEFINITIONS.flatMap((definition) => {
    const laneTasks = grouped.get(definition.id);
    return laneTasks?.length ? [{ id: definition.id, label: definition.label, tasks: laneTasks }] : [];
  });
}
