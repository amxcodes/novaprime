const EMPTY_SNAPSHOT = Object.freeze({ views: Object.freeze([]), readStatus: "loading" });

/** Share personal saved-view reads with Work widgets without blocking the page. */
export function createSavedTaskViewsReadStore(initialSnapshot = EMPTY_SNAPSHOT) {
  let snapshot = initialSnapshot;
  const listeners = new Set();

  return Object.freeze({
    getSnapshot: () => snapshot,
    subscribe(listener) {
      if (typeof listener !== "function") throw new TypeError("A store listener is required");
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    publish(nextSnapshot) {
      if (!nextSnapshot || !Array.isArray(nextSnapshot.views) ||
          !["loading", "error", "ready"].includes(nextSnapshot.readStatus)) {
        throw new TypeError("A valid saved-view read snapshot is required");
      }
      snapshot = Object.freeze({
        views: Object.freeze([...nextSnapshot.views]),
        readStatus: nextSnapshot.readStatus,
      });
      for (const listener of listeners) listener();
    },
  });
}
