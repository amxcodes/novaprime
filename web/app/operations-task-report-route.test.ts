import { describe, expect, it } from "bun:test";
import { createOperationsTaskReportRoute, operationsTaskPageUrl } from "./operations-task-report-route.js";

describe("Operations task report route adapter", () => {
  it("retains all task states and binds opaque cursors to the same bounded query", async () => {
    expect(operationsTaskPageUrl()).toBe("/api/work/tasks/visible?limit=30&status=all");
    expect(operationsTaskPageUrl("cursor+/opaque==")).toBe(
      "/api/work/tasks/visible?limit=30&status=all&cursor=cursor%2B%2Fopaque%3D%3D",
    );

    const paths: string[] = [];
    const report = createOperationsTaskReportRoute({ read: async (path) => {
      paths.push(path);
      return { tasks: [], hasMore: false, nextCursor: null, limit: 30 };
    } });
    await report.start();
    expect(paths).toEqual(["/api/work/tasks/visible?limit=30&status=all"]);
  });
});
