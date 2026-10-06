/** Mount Reviewer Management with page-bound reads and host-owned save authority. */
export function mountWorkReviewerManagementRoute(target, {
  feature,
  loadError,
  initialRead,
  lifetime,
  onSaveReviewer,
} = {}, host = {}) {
  if (typeof host.showWorkFeatureMessage !== "function") {
    throw new TypeError("Work Reviewer Management host showWorkFeatureMessage must be a function");
  }

  const Component = feature?.ReviewerManagement;
  if (!Component) {
    host.showWorkFeatureMessage(target, "Reviewer management is unavailable",
      loadError
        ? "The reviewer management interface could not load. Refresh Work to try again."
        : "The reviewer management interface is unavailable.",
    );
    return { mounted: false };
  }

  for (const name of ["isCurrentPageRequest", "readPage", "mountReactIsland"]) {
    if (typeof host[name] !== "function") {
      throw new TypeError(`Work Reviewer Management host ${name} must be a function`);
    }
  }
  if (typeof onSaveReviewer !== "function") {
    throw new TypeError("Work Reviewer Management onSaveReviewer must be a function");
  }

  const isPageCurrent = () => Boolean(target?.isConnected && host.isCurrentPageRequest(lifetime));
  const onLoadAssignments = async (cursor) => {
    if (!isPageCurrent()) return { readError: "STALE_PAGE_REQUEST" };
    const query = new URLSearchParams({ limit: "25" });
    if (cursor) query.set("cursor", cursor);
    return host.readPage(
      "/api/task-assignments/reviewer-management?" + query.toString(),
      lifetime,
      { assignments: [], hasMore: false, nextCursor: null, limit: 25 },
    );
  };
  const onLoadCandidates = async (assignmentId, search, cursor) => {
    if (!isPageCurrent()) return { readError: "STALE_PAGE_REQUEST" };
    const query = new URLSearchParams({ limit: "25" });
    if (search) query.set("q", search);
    if (cursor) query.set("cursor", cursor);
    return host.readPage(
      "/api/task-assignments/" + encodeURIComponent(assignmentId) + "/reviewer-management?" + query.toString(),
      lifetime,
      {},
    );
  };

  host.mountReactIsland(target, Component, {
    initialRead,
    onLoadAssignments,
    onLoadCandidates,
    onSaveReviewer,
  });
  return { mounted: true };
}
