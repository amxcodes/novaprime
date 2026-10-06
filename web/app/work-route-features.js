const workFeatureLoaders = Object.freeze({
  taskDetail: () => import("../src/features/work/task-detail/index.ts").then((module) => ({ module })),
  workContext: () => Promise.all([
    import("../src/features/work-context/WorkContextExplorer.tsx"),
    import("../src/features/work-context/client-department-projection.ts"),
  ]).then(([module, projector]) => ({ module, projector: projector.projectWorkContextClientDepartmentCreation })),
  reviews: () => import("../src/features/reviews/ReviewsPage.tsx").then((module) => ({ module })),
  collaboration: () => import("../src/features/work-collaboration/WorkCollaborationRequests.tsx")
    .then((module) => ({ module })),
  taskComposer: () => import("../src/features/work/task-composer/TaskComposer.tsx").then((module) => ({ module })),
  sessions: () => Promise.all([
    import("../src/features/work/sessions/WorkSessions.tsx"),
    import("./work-sessions-route.js"),
  ]).then(([module, route]) => ({ module, route })),
  timeline: () => Promise.all([
    import("../src/features/work/timeline/WorkTimeline.tsx"),
    import("./work-timeline-route.js"),
  ]).then(([module, route]) => ({ module, route })),
  assignments: () => import("../src/features/work/MyAssignments.tsx").then((module) => ({ module })),
  savedTaskViews: () => import("../src/features/work/WorkSavedTaskViews.tsx").then((module) => ({ module })),
  visibleTasks: () => Promise.all([
    import("../src/features/work/VisibleTasks.tsx"),
    import("./visible-tasks-route.js"),
  ]).then(([module, route]) => ({ module, route })),
  reviewerManagement: () => import("../src/features/work/reviewer-management/index.ts")
    .then((module) => ({ module })),
});

/**
 * Load only feature bundles the route host has already selected. The host
 * computes every capability and focused-route gate; this module only owns
 * import composition and keeps a failed chunk local to its feature.
 *
 * @param {Record<string, boolean>} enabled Feature keys selected by the host.
 * @param {Record<string, () => Promise<unknown>>} [loaders] Import seams for focused tests.
 */
export async function loadWorkRouteFeatures(enabled = {}, loaders = workFeatureLoaders) {
  if (!enabled || typeof enabled !== "object" || Array.isArray(enabled)) {
    throw new TypeError("Work feature selection is required");
  }
  const entries = await Promise.all(Object.entries(loaders).map(async ([feature, load]) => {
    if (enabled[feature] !== true) return [feature, null];
    try {
      if (typeof load !== "function") throw new TypeError(`Work feature loader ${feature} is unavailable`);
      return [feature, await load()];
    } catch (error) {
      return [feature, { error }];
    }
  }));
  return Object.fromEntries(entries);
}
