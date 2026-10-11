const WORK_AREA_DEFINITIONS = Object.freeze([
  Object.freeze({
    id: "my-work",
    label: "My work",
    title: "My work",
    description: "Your assignments, recorded sessions, and attendance.",
    features: Object.freeze(["assignments", "sessions", "timeline", "savedTaskViews"]),
  }),
  Object.freeze({
    id: "tasks",
    label: "Tasks",
    title: "Tasks",
    description: "Browse and create tasks available under your current access.",
    features: Object.freeze(["visibleTasks", "taskComposer", "savedTaskViews"]),
  }),
  Object.freeze({
    id: "reviews",
    label: "Reviews",
    title: "Reviews",
    description: "Review submitted work available to you.",
    features: Object.freeze(["reviews"]),
  }),
  Object.freeze({
    id: "requests",
    label: "Requests",
    title: "Requests",
    description: "Resolve task reviewer and handover requests available to you.",
    features: Object.freeze(["collaboration"]),
  }),
  Object.freeze({
    id: "reviewer-management",
    label: "Reviewer management",
    title: "Reviewer management",
    description: "Manage reviewer assignments within your authorized work scope.",
    features: Object.freeze(["reviewerManagement"]),
  }),
  Object.freeze({
    id: "context",
    label: "Work context",
    title: "Work context",
    description: "Browse clients, workstreams, and groups available under your access.",
    features: Object.freeze(["workContext"]),
  }),
]);

const WORK_AREA_READS = Object.freeze({
  "my-work": Object.freeze(["assignmentsResult", "sessionsResult", "timeline", "attendanceResult"]),
  tasks: Object.freeze(["visibleTasksResult", "taskCatalogResult"]),
  reviews: Object.freeze(["reviewsResult"]),
  requests: Object.freeze(["reviewerRequestsResult", "handoverRequestsResult"]),
  "reviewer-management": Object.freeze(["reviewerManagementResult"]),
  context: Object.freeze([]),
});

const DEFAULT_WORK_AREA_ORDER = Object.freeze([
  "my-work", "tasks", "reviews", "requests", "reviewer-management", "context",
]);
const WORK_AREA_PRESERVED_FILTERS = Object.freeze([
  "assignmentStatus", "assignmentDue", "assignmentSearch", "assignmentCursor",
  "taskStatus", "taskDue", "taskSearch", "taskCursor", "taskLayout",
]);

function hasWorkCapability(readPlan, key) {
  return readPlan?.[key] === true;
}

function areaIsAvailable(id, readPlan, canCreateTasks) {
  switch (id) {
    case "my-work":
      return hasWorkCapability(readPlan, "assignments") || hasWorkCapability(readPlan, "sessions") ||
        hasWorkCapability(readPlan, "timeline") || hasWorkCapability(readPlan, "attendance");
    case "tasks":
      return hasWorkCapability(readPlan, "taskCollection") || canCreateTasks === true;
    case "reviews":
      return hasWorkCapability(readPlan, "reviews");
    case "requests":
      return hasWorkCapability(readPlan, "reviewerRequests") || hasWorkCapability(readPlan, "handoverRequests");
    case "reviewer-management":
      return hasWorkCapability(readPlan, "reviewerManagement");
    case "context":
      return hasWorkCapability(readPlan, "workContextView");
    default:
      return false;
  }
}

function sectionsForWorkArea(id, readPlan, canCreateTasks) {
  switch (id) {
    case "my-work":
      return [
        ...(hasWorkCapability(readPlan, "assignments") ? ["assignments"] : []),
        ...(hasWorkCapability(readPlan, "sessions") ? ["sessions"] : []),
        ...(hasWorkCapability(readPlan, "timeline") || hasWorkCapability(readPlan, "attendance") ? ["timeline"] : []),
      ];
    case "tasks":
      return [
        ...(hasWorkCapability(readPlan, "taskCollection") ? ["tasks"] : []),
        ...(canCreateTasks ? ["create"] : []),
      ];
    case "reviews": return ["reviews"];
    case "requests": return ["collaboration"];
    case "reviewer-management": return ["reviewer-management"];
    case "context": return ["context"];
    default: return [];
  }
}

/** Return only areas represented by the current server-issued read plan. */
export function getAvailableWorkAreas(readPlan, canCreateTasks = false) {
  if (!readPlan || typeof readPlan !== "object") return [];
  return WORK_AREA_DEFINITIONS
    .filter((area) => areaIsAvailable(area.id, readPlan, canCreateTasks))
    .map((area) => ({ ...area, sections: sectionsForWorkArea(area.id, readPlan, canCreateTasks) }));
}

/** Resolve an area query as a presentation preference, bounded by available areas. */
export function resolveWorkAreaId(requestedId, availableAreas) {
  if (!Array.isArray(availableAreas) || availableAreas.length === 0) return null;
  const available = new Set(availableAreas.map((area) => area.id));
  if (available.has(requestedId)) return requestedId;
  return DEFAULT_WORK_AREA_ORDER.find((id) => available.has(id)) || availableAreas[0].id;
}

/** Keep read dispatch and lazy feature selection aligned to the chosen area. */
export function isWorkReadIncludedInArea(readKey, areaId, canCreateTasks = false) {
  if (WORK_AREA_READS[areaId]?.includes(readKey)) return true;
  if (areaId === "tasks" && canCreateTasks && readKey === "workContext") return true;
  return areaId === "context" && readKey === "workContext";
}

export function isWorkFeatureIncludedInArea(feature, areaId, readPlan, canCreateTasks = false) {
  if (!WORK_AREA_DEFINITIONS.find((area) => area.id === areaId)?.features.includes(feature)) return false;
  switch (feature) {
    case "assignments": return hasWorkCapability(readPlan, "assignments");
    case "sessions": return hasWorkCapability(readPlan, "sessions");
    case "timeline": return hasWorkCapability(readPlan, "timeline") || hasWorkCapability(readPlan, "attendance");
    case "visibleTasks": return hasWorkCapability(readPlan, "taskCollection");
    case "taskComposer": return canCreateTasks === true;
    case "savedTaskViews": return areaId === "my-work"
      ? hasWorkCapability(readPlan, "assignments")
      : hasWorkCapability(readPlan, "taskCollection");
    case "reviews": return hasWorkCapability(readPlan, "reviews");
    case "collaboration": return hasWorkCapability(readPlan, "reviewerRequests") || hasWorkCapability(readPlan, "handoverRequests");
    case "reviewerManagement": return hasWorkCapability(readPlan, "reviewerManagement");
    case "workContext": return hasWorkCapability(readPlan, "workContextView");
    default: return false;
  }
}

/** Preserve feature filters while changing only the Work presentation area. */
export function workAreaHref(currentHref, areaId) {
  const url = new URL(currentHref, "https://nova.invalid");
  const params = new URLSearchParams({ view: "work", area: areaId });
  for (const key of WORK_AREA_PRESERVED_FILTERS) {
    const value = url.searchParams.get(key);
    if (value) params.set(key, value);
  }
  return url.pathname + "?" + params.toString() + url.hash;
}
