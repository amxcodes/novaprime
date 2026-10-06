import { describe, expect, it } from "bun:test";
import { createOperationsTaskReportController } from "./task-report-controller";

const task = (id: string) => ({
  id,
  title: `Task ${id}`,
  status: "open",
  priority: "normal",
  dueDate: null,
  client: { id: "client-secret", name: "Client" },
  workstream: { id: "stream-secret", kind: "client", name: "Delivery" },
  group: { id: "group-secret", name: "Team" },
  department: { id: "department-secret", name: "Ops" },
  assignmentCount: 2,
  assignments: [{ personId: "person-secret", personName: "Private Assignee" }],
  description: "Do not project me",
  billingClass: "billable",
});

const page = (tasks: unknown[], nextCursor: string | null = null) => ({
  tasks,
  hasMore: nextCursor !== null,
  nextCursor,
  limit: 1,
});

describe("Operations task report paging", () => {
  it("projects only visible summary fields and follows server cursors in both directions", async () => {
    const requests: Array<string | null> = [];
    const controller = createOperationsTaskReportController({
      readPage: async (cursor) => {
        requests.push(cursor);
        if (cursor === null) return page([task("one")], "after-one");
        if (cursor === "after-one") return page([task("two")], "after-two");
        return page([task("three")]);
      },
    });

    await controller.start();
    await controller.next("after-one");
    await controller.next("after-two");
    expect(controller.getState()).toMatchObject({
      status: "ready",
      data: { pageNumber: 3, tasks: [{ id: "three" }], hasPrevious: true, hasMore: false },
    });
    await controller.previous();
    expect(controller.getState()).toMatchObject({
      status: "ready",
      data: { pageNumber: 2, tasks: [{ id: "two" }], hasPrevious: true, hasMore: true },
    });
    const state = controller.getState();
    if (state.status !== "ready") throw new Error("expected task page");
    expect(state.data.tasks[0]).toEqual({
      id: "two",
      title: "Task two",
      status: "open",
      priority: "normal",
      dueDate: null,
      assignmentCount: 2,
      client: { name: "Client" },
      workstream: { name: "Delivery" },
      group: { name: "Team" },
      department: { name: "Ops" },
    });
    expect(JSON.stringify(state.data)).not.toContain("Private Assignee");
    expect(JSON.stringify(state.data)).not.toContain("description");
    expect(requests).toEqual([null, "after-one", "after-two", "after-one"]);
  });

  it("preserves the current page on transient continuation failure and retries the same cursor", async () => {
    const requests: Array<string | null> = [];
    let fail = true;
    const controller = createOperationsTaskReportController({
      readPage: async (cursor) => {
        requests.push(cursor);
        if (cursor === null) return page([task("one")], "after-one");
        if (fail) {
          fail = false;
          return { readError: "REQUEST_FAILED" };
        }
        return page([task("two")]);
      },
      failureMessage: () => "Try again.",
    });

    await controller.start();
    await controller.next("after-one");
    expect(controller.getState()).toMatchObject({
      status: "ready",
      data: { tasks: [{ id: "one" }], nextCursor: "after-one", pageNumber: 1 },
      loadingPage: false,
      pageError: "Try again.",
    });
    await controller.retry();
    expect(controller.getState()).toMatchObject({ status: "ready", data: { tasks: [{ id: "two" }], pageNumber: 2 } });
    expect(requests).toEqual([null, "after-one", "after-one"]);
  });

  it("clears scoped rows and cursor history when a continuation loses authorization", async () => {
    const controller = createOperationsTaskReportController({
      readPage: async (cursor) => cursor === null
        ? page([task("one")], "after-one")
        : { readError: "REQUEST_FAILED", readStatus: 403 },
    });

    await controller.start();
    await controller.next("after-one");
    expect(controller.getState()).toEqual({ status: "denied", message: "You do not have permission to view tasks in this scope." });
    await controller.previous();
    expect(controller.getState().status).toBe("denied");
  });

  it("fails closed on repeated cursors, oversized pages, malformed rows, or missing counts", async () => {
    const malformed = [
      { ...page([task("one")], "after-one"), tasks: [task("one"), task("two")] },
      page([{ ...task("one"), assignmentCount: undefined }]),
    ];
    for (const result of malformed) {
      const controller = createOperationsTaskReportController({ readPage: async () => result });
      await controller.start();
      expect(controller.getState()).toMatchObject({ status: "error", message: expect.stringContaining("incomplete") });
    }

    const repeated = createOperationsTaskReportController({
      readPage: async (cursor) => cursor === null ? page([task("one")], "after-one") : page([task("two")], "after-one"),
    });
    await repeated.start();
    await repeated.next();
    expect(repeated.getState()).toMatchObject({ status: "ready", pageError: expect.stringContaining("incomplete") });
  });

  it("does not mount responses after the Operations route becomes stale", async () => {
    let current = true;
    let finish!: (result: ReturnType<typeof page>) => void;
    const controller = createOperationsTaskReportController({
      isCurrent: () => current,
      readPage: () => new Promise((resolve) => { finish = resolve; }),
    });
    const pending = controller.start();
    current = false;
    finish(page([task("stale")]));
    await pending;
    expect(controller.getState()).toEqual({ status: "loading" });
  });
});
