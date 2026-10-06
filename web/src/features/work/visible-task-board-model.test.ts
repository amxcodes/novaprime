import { describe, expect, it } from "bun:test";
import { groupVisibleTasksByBoardLane } from "./visible-task-board-model";
import type { VisibleTask } from "./contracts";

function task(id: string, status: string): VisibleTask {
  return {
    id,
    title: id,
    description: null,
    status,
    priority: "normal",
    dueDate: null,
    createdAt: "2026-10-01T12:00:00.000Z",
    client: null,
    workstream: { id: "stream", name: "Organisation", kind: "organisation" },
    group: null,
    department: null,
    assignmentCount: 0,
  };
}

describe("visible task board status projection", () => {
  it("groups real task states while keeping each record's exact status", () => {
    const lanes = groupVisibleTasksByBoardLane([
      task("ready-1", "ready"),
      task("blocked-1", "blocked"),
      task("backlog-1", "backlog"),
      task("returned-1", "returned"),
      task("submitted-1", "submitted"),
      task("done-1", "done"),
      task("approved-1", "approved"),
    ]);

    expect(lanes.map(({ id, tasks }) => [id, tasks.map(({ id: taskId }) => taskId)])).toEqual([
      ["up-next", ["ready-1", "backlog-1"]],
      ["review", ["submitted-1"]],
      ["complete", ["done-1", "approved-1"]],
      ["attention", ["blocked-1", "returned-1"]],
    ]);
    expect(lanes.flatMap(({ tasks }) => tasks.map(({ status }) => status))).toEqual([
      "ready", "backlog", "submitted", "done", "approved", "blocked", "returned",
    ]);
  });

  it("retains cancelled and future status values rather than silently dropping them", () => {
    const lanes = groupVisibleTasksByBoardLane([
      task("cancelled-1", "cancelled"),
      task("future-1", "scheduled_for_release"),
    ]);

    expect(lanes.map(({ id, label, tasks }) => [id, label, tasks[0].status])).toEqual([
      ["cancelled", "Cancelled", "cancelled"],
      ["other", "Other statuses", "scheduled_for_release"],
    ]);
  });

  it("omits empty lanes so a partial page is not presented as a complete workflow total", () => {
    expect(groupVisibleTasksByBoardLane([])).toEqual([]);
    expect(groupVisibleTasksByBoardLane([task("one", "in_progress")]).map(({ id }) => id)).toEqual(["in-progress"]);
  });
});
