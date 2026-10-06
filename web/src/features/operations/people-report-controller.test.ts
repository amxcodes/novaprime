import { describe, expect, it } from "bun:test";
import { createOperationsPeopleReportController } from "./people-report-controller";

const row = (id: string) => ({ id, displayName: id });
const page = (people: Array<{ id: string; displayName: string }>, query: string, cursor: string | null, nextCursor: string | null) => ({
  people,
  query,
  cursor,
  limit: 1,
  hasMore: Boolean(nextCursor),
  nextCursor,
});

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => { resolve = done; });
  return { promise, resolve: (value: T) => resolve(value) };
}

describe("Operations People report paging", () => {
  it("uses only server-searched bounded pages and allows previous/next traversal", async () => {
    const requests: Array<{ query: string; cursor: string | null }> = [];
    const controller = createOperationsPeopleReportController({
      readPage: async (query, cursor) => {
        requests.push({ query, cursor });
        if (cursor === null) return page([row("one")], query, cursor, "after-one");
        if (cursor === "after-one") return page([row("two")], query, cursor, "after-two");
        return page([row("three")], query, cursor, null);
      },
    });

    await controller.search("  Aman  ");
    await controller.next();
    await controller.next();
    expect(controller.getState()).toMatchObject({
      status: "ready",
      data: { query: "Aman", people: [row("three")], hasPrevious: true, hasMore: false },
    });
    await controller.previous();
    expect(controller.getState()).toMatchObject({ status: "ready", data: { people: [row("two")], hasPrevious: true, hasMore: true } });
    expect(requests).toEqual([
      { query: "Aman", cursor: null },
      { query: "Aman", cursor: "after-one" },
      { query: "Aman", cursor: "after-two" },
      { query: "Aman", cursor: "after-one" },
    ]);
  });

  it("does not let a stale search or page response replace the active query", async () => {
    const pending: Array<ReturnType<typeof deferred<ReturnType<typeof page>>>> = [];
    const controller = createOperationsPeopleReportController({
      readPage: () => {
        const request = deferred<ReturnType<typeof page>>();
        pending.push(request);
        return request.promise;
      },
    });
    const oldSearch = controller.search("old");
    const currentSearch = controller.search("current");
    pending[1].resolve(page([row("current")], "current", null, null));
    await currentSearch;
    pending[0].resolve(page([row("old")], "old", null, null));
    await oldSearch;
    expect(controller.getState()).toMatchObject({ status: "ready", data: { query: "current", people: [row("current")] } });
  });

  it("does not append a stale continuation after a new search starts", async () => {
    const pending: Array<{ resolve: (value: ReturnType<typeof page>) => void }> = [];
    const controller = createOperationsPeopleReportController({
      readPage: () => {
        const request = deferred<ReturnType<typeof page>>();
        pending.push(request);
        return request.promise;
      },
    });
    const initial = controller.search("before");
    pending[0].resolve(page([row("first")], "before", null, "after-first"));
    await initial;
    const continuation = controller.next("after-first");
    const freshSearch = controller.search("after");
    pending[2].resolve(page([row("fresh")], "after", null, null));
    await freshSearch;
    pending[1].resolve(page([row("stale")], "before", "after-first", null));
    await continuation;
    expect(controller.getState()).toMatchObject({ status: "ready", data: { query: "after", people: [row("fresh")] } });
  });

  it("keeps the current page visible and retries the same failed continuation", async () => {
    const requests: Array<{ query: string; cursor: string | null }> = [];
    let failNext = true;
    const controller = createOperationsPeopleReportController({
      readPage: async (query, cursor) => {
        requests.push({ query, cursor });
        if (cursor === null) return page([row("one")], query, null, "after-one");
        if (failNext) {
          failNext = false;
          return { readError: "REQUEST_FAILED" };
        }
        return page([row("two")], query, cursor, null);
      },
      failureMessage: () => "Try again.",
    });
    await controller.start();
    await controller.next();
    expect(controller.getState()).toMatchObject({
      status: "ready",
      data: { people: [row("one")], nextCursor: "after-one" },
      loadingPage: false,
      pageError: "Try again.",
    });
    await controller.retry();
    expect(controller.getState()).toMatchObject({ status: "ready", data: { people: [row("two")], hasPrevious: true } });
    expect(requests.slice(1)).toEqual([
      { query: "", cursor: "after-one" },
      { query: "", cursor: "after-one" },
    ]);
  });

  it("clears the page when the capability is denied and fails closed on a malformed continuation", async () => {
    let denied = false;
    const controller = createOperationsPeopleReportController({
      readPage: async (query, cursor) => {
        if (denied) return { readError: "PERMISSION_DENIED" };
        return cursor === null ? page([row("one")], query, null, "next") : { people: [], hasMore: true, nextCursor: null };
      },
    });
    await controller.start();
    await controller.next();
    expect(controller.getState()).toMatchObject({ status: "ready", pageError: expect.stringContaining("could not be identified") });
    denied = true;
    await controller.search("restricted");
    expect(controller.getState()).toMatchObject({ status: "denied" });
  });
});
