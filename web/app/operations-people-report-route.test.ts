import { describe, expect, it } from "bun:test";
import { createOperationsPeopleReportRoute } from "./operations-people-report-route.js";

describe("Operations People route adapter", () => {
  it("binds each server page to the normalized search and returned cursor", async () => {
    const paths: string[] = [];
    const route = createOperationsPeopleReportRoute({
      read: async (path) => {
        paths.push(path);
        return path.includes("cursor=")
          ? { people: [{ id: "two", displayName: "Second" }], hasMore: false, nextCursor: null, limit: 25 }
          : { people: [{ id: "one", displayName: "First" }], hasMore: true, nextCursor: "after-first", limit: 25 };
      },
    });
    await route.search("  Riley Lee  ");
    const cursor = route.getState().status === "ready" ? route.getState().data.nextCursor : null;
    if (cursor) await route.next(cursor);

    expect(paths).toEqual([
      "/api/people/directory?limit=25&q=Riley+Lee",
      "/api/people/directory?limit=25&q=Riley+Lee&cursor=after-first",
    ]);
    expect(route.getState()).toMatchObject({ status: "ready", data: { query: "Riley Lee", people: [{ id: "two" }] } });
  });

  it("maps the server's real forbidden API failure to a cleared denied report", async () => {
    const route = createOperationsPeopleReportRoute({
      read: async (path) => {
        if (path.includes("cursor=")) {
          const error = new Error("PERMISSION_DENIED") as Error & { code: string; httpStatus: number };
          error.code = "PERMISSION_DENIED";
          error.httpStatus = 403;
          throw error;
        }
        return { people: [{ id: "one", displayName: "First" }], hasMore: true, nextCursor: "after-first", limit: 25 };
      },
    });
    await route.start();
    await route.next("after-first");
    expect(route.getState()).toEqual({
      status: "denied",
      message: "You do not have permission to view people in this scope.",
    });
  });
});
