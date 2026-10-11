import { expect, test } from "bun:test";
import { createSavedTaskViewsReadStore } from "./saved-task-views-read-store.js";

test("saved-view subscribers receive immutable snapshots as a read settles", () => {
  const store = createSavedTaskViewsReadStore();
  const changes = [];
  const unsubscribe = store.subscribe(() => changes.push(store.getSnapshot()));
  const views = [{ id: "view-1", name: "Open work" }];

  store.publish({ views, readStatus: "ready" });
  views.push({ id: "view-2", name: "Late mutation" });

  expect(changes).toHaveLength(1);
  expect(store.getSnapshot()).toEqual({
    views: [{ id: "view-1", name: "Open work" }],
    readStatus: "ready",
  });
  expect(Object.isFrozen(store.getSnapshot())).toBe(true);
  expect(Object.isFrozen(store.getSnapshot().views)).toBe(true);
  unsubscribe();
  store.publish({ views: [], readStatus: "error" });
  expect(changes).toHaveLength(1);
});
