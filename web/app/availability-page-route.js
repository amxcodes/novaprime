import { planAvailabilityAgendaReads } from "../src/features/availability/capabilities.ts";

const sourceLabelByRead = Object.freeze([
  ["schedule", "scheduled shifts"],
  ["holidays", "holidays"],
  ["attendance", "attendance"],
  ["leave", "leave"],
  ["wfh", "work-from-home"],
]);

/**
 * Mount the Availability page and keep its URL, read, and route-lifetime
 * orchestration at the route boundary. The server still filters each event
 * source independently using the authenticated actor's current grants.
 */
export async function mountAvailabilityPage({
  target,
  actorGrants,
  location = window.location,
  history = window.history,
  isCurrentPageRequest,
  pageApi,
  refreshPermissions = () => {},
  mountIsland,
  getReadIssue,
  businessTimeLabel,
  showFeedback,
  restorePendingRouteScroll,
  loadFeature = () => import("../src/pages/availability/AvailabilityPage.tsx"),
} = {}) {
  const requiredFunctions = {
    isCurrentPageRequest,
    pageApi,
    refreshPermissions,
    mountIsland,
    getReadIssue,
    businessTimeLabel,
    showFeedback,
    restorePendingRouteScroll,
    loadFeature,
  };
  for (const [name, service] of Object.entries(requiredFunctions)) {
    if (typeof service !== "function") throw new TypeError(`Availability page route service ${name} must be a function`);
  }
  if (!target) throw new TypeError("Availability page route target is required");
  if (!location || typeof location.search !== "string" || typeof location.origin !== "string") {
    throw new TypeError("Availability page route location is required");
  }
  if (!history || typeof history.replaceState !== "function") {
    throw new TypeError("Availability page route history is required");
  }

  const params = new URLSearchParams(location.search);
  const readPlan = planAvailabilityAgendaReads(actorGrants);
  const sourceLabels = sourceLabelByRead
    .filter(([key]) => readPlan[key])
    .map(([, label]) => label);
  let accessRefreshStarted = false;

  function handleAccessChanged() {
    if (accessRefreshStarted) return;
    accessRefreshStarted = true;
    if (params.has("cursor")) {
      const url = new URL("/", location.origin);
      for (const [key, value] of params) {
        if (key !== "cursor") url.searchParams.append(key, value);
      }
      if (!url.searchParams.has("view")) url.searchParams.set("view", "availability");
      history.replaceState(history.state, "", url);
    }
    try { void Promise.resolve(refreshPermissions()).catch(() => {}); }
    catch { /* The feature still clears its protected rows if refresh cannot start. */ }
  }

  const feature = await loadFeature();
  if (!isCurrentPageRequest() || !target.isConnected) return null;
  if (typeof feature?.AvailabilityPage !== "function") {
    throw new TypeError("Availability page feature export is incomplete");
  }

  const agenda = {
    startDate: params.get("startDate") || "",
    endDate: params.get("endDate") || "",
    cursor: params.get("cursor"),
    sourceLabels,
    loadEvents: async (rangeStart, rangeEnd, cursor) => {
      const search = new URLSearchParams({ startDate: rangeStart, endDate: rangeEnd, limit: "50" });
      if (cursor) search.set("cursor", cursor);
      try {
        return await pageApi("/api/availability/agenda?" + search.toString());
      } catch (error) {
        const accessChanged = error?.payload?.reason === "AVAILABILITY_ACCESS_CHANGED";
        if (accessChanged || (error?.httpStatus === 403 && error?.code === "PERMISSION_DENIED")) {
          handleAccessChanged();
          return {
            events: [],
            readError: "PERMISSION_DENIED",
            ...(accessChanged ? { accessChanged: true } : {}),
          };
        }
        return { events: [], readError: error?.code || "REQUEST_FAILED" };
      }
    },
    updateRange: (rangeStart, rangeEnd) => {
      const url = new URL("/", location.origin);
      url.searchParams.set("view", "availability");
      url.searchParams.set("startDate", rangeStart);
      url.searchParams.set("endDate", rangeEnd);
      history.replaceState(history.state, "", url);
    },
    onAccessChanged: handleAccessChanged,
    isCurrentPageRequest,
    readErrorMessage: (response) => getReadIssue(response, "availability agenda")?.message ||
      "Could not load availability events. Refresh the page to try again.",
    businessTimeLabel,
  };

  mountIsland(target, feature.AvailabilityPage, { agenda });
  showFeedback();
  restorePendingRouteScroll();
  return Object.freeze({ agenda });
}
