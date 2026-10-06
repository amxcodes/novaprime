import { createWorkTaskComposerSubmitAction } from "./work-task-composer-actions-route.ts";
import { projectTaskComposerOptions, resolveTaskComposerSubmission } from "./task-composer-route.js";

const unavailableTitle = "Task creation is unavailable";

/** Compose the Work TaskComposer from reads and command authority supplied by the route host. */
export function mountWorkTaskComposerRoute(target, {
  feature,
  loadError,
  lifetime,
  canCreateTask,
  workContextResult,
  catalogResult,
  catalogRequested,
  correctionTasksResult,
  correctionsRequested,
  isCurrentPageRequest,
  runCommand,
  api,
  requestOptions,
  idempotencyHeaders,
  clearIdempotency,
  pageChangedError,
  permissionDeniedError,
  billingConfirmation,
  correctionConfirmation,
  setMessage,
  refreshWork,
} = {}, host = {}) {
  if (typeof host.showFeatureMessage !== "function") {
    throw new TypeError("Work Task Composer host showFeatureMessage must be a function");
  }

  const Component = feature?.TaskComposer;
  if (!Component) {
    host.showFeatureMessage(target, unavailableTitle,
      loadError
        ? "Task creation could not load. Refresh Work to try again."
        : "Task creation is unavailable.",
    );
    return { mounted: false };
  }

  for (const name of ["mountReactIsland"]) {
    if (typeof host[name] !== "function") {
      throw new TypeError(`Work Task Composer host ${name} must be a function`);
    }
  }
  const requiredCallbacks = {
    canCreateTask,
    isCurrentPageRequest,
    runCommand,
    api,
    requestOptions,
    idempotencyHeaders,
    clearIdempotency,
    pageChangedError,
    permissionDeniedError,
    billingConfirmation,
    correctionConfirmation,
    setMessage,
    refreshWork,
  };
  for (const [name, callback] of Object.entries(requiredCallbacks)) {
    if (typeof callback !== "function") throw new TypeError(`Work Task Composer ${name} must be a function`);
  }
  if (!target || !lifetime) throw new TypeError("Work Task Composer target and lifetime are required");

  const composerOptions = projectTaskComposerOptions({
    canCreate: canCreateTask(),
    workContextResult,
    catalogResult,
    catalogRequested,
    correctionTasksResult,
    correctionsRequested,
    departmentsResult: undefined,
    departmentsRequested: false,
  });
  const onSubmit = createWorkTaskComposerSubmitAction({
    target,
    lifetime,
    isCurrentPageRequest,
    canCreateTask,
    resolveSubmission: (input) => resolveTaskComposerSubmission(input, {
      composerOptions,
      workContextResult,
      catalogResult,
      correctionTasksResult,
      departmentsResult: undefined,
    }),
    runCommand,
    api,
    requestOptions,
    idempotencyHeaders,
    clearIdempotency,
    pageChangedError,
    permissionDeniedError,
    billingConfirmation,
    correctionConfirmation,
    setMessage,
    refreshWork,
  });

  host.mountReactIsland(target, Component, {
    ...composerOptions,
    heading: "Create work",
    description: "Create a task in a workstream available to your role. Assignment and review stay separate; NOVA applies billing automatically.",
    selfAssignmentDefault: true,
    onSubmit,
  });
  return { mounted: true };
}
