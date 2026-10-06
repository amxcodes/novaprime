import {
  canAccessWorkspaceDestination,
  resolveWorkspaceDestinationView,
} from "./workspace-destinations.js";
import { canShowAdminFeature } from "./src/features/admin/capabilities.ts";

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const REVIEW_NOTIFICATION_TARGETS = Object.freeze({
  "leave.requested": Object.freeze({ parameter: "leave", feature: "leaveReview", section: "leave-review" }),
  "wfh.requested": Object.freeze({ parameter: "wfh", feature: "wfhReview", section: "wfh-review" }),
});
const LEAVE_STATUS_EVENTS = new Set([
  "leave.approved", "leave.rejected", "leave.cancelled",
  "attendance.recovery_required", "attendance.recovered",
]);
const WFH_STATUS_EVENTS = new Set(["wfh.approved", "wfh.rejected", "wfh.cancelled"]);

function resolveAvailabilityRequestLink(params, { grants, eventKey } = {}) {
  const hasLeave = params.has("leave");
  const hasWfh = params.has("wfh");
  if (!hasLeave && !hasWfh) return undefined;
  if (hasLeave === hasWfh || params.getAll("view").length !== 1 || params.get("view") !== "today") return null;

  const parameter = hasLeave ? "leave" : "wfh";
  const id = params.get(parameter);
  if (params.getAll(parameter).length !== 1 || !UUID_PATTERN.test(id || "")) return null;

  const target = REVIEW_NOTIFICATION_TARGETS[eventKey];
  if (target) {
    if (target.parameter !== parameter || !canShowAdminFeature(grants, target.feature)) return null;
    const focusParams = new URLSearchParams({ view: "admin", focus: target.section, [parameter]: id });
    return "/?" + focusParams.toString();
  }

  const statusEvents = parameter === "leave" ? LEAVE_STATUS_EVENTS : WFH_STATUS_EVENTS;
  if (!statusEvents.has(eventKey) || !canAccessWorkspaceDestination("today", grants, params)) return null;
  return "/?view=today&" + parameter + "=" + encodeURIComponent(id);
}

/**
 * Resolve server-provided notification URLs to a current, same-origin route
 * that the signed-in person can discover. This is presentation filtering; the
 * destination page and its API still perform their own authorization checks.
 */
export function resolveNotificationDeepLink(rawDeepLink, { origin, grants, homeView, eventKey } = {}) {
  if (typeof rawDeepLink !== "string" || rawDeepLink.length > 2048 || !origin) return null;

  let baseOrigin;
  let destination;
  try {
    baseOrigin = new URL(origin).origin;
    destination = new URL(rawDeepLink, baseOrigin);
  } catch {
    return null;
  }
  if (destination.origin !== baseOrigin || destination.pathname !== "/") return null;

  const availabilityRequestDestination = resolveAvailabilityRequestLink(destination.searchParams, { grants, eventKey });
  if (availabilityRequestDestination !== undefined) return availabilityRequestDestination;
  if (REVIEW_NOTIFICATION_TARGETS[eventKey]) return null;

  const requestedView = destination.searchParams.get("view");
  if ((destination.searchParams.has("reviewerRequest") || destination.searchParams.has("handoverRequest")) &&
      (requestedView !== "work" || destination.searchParams.getAll("view").length !== 1)) return null;
  const view = requestedView === "home"
    ? homeView
    : resolveWorkspaceDestinationView(destination.searchParams);
  if (!view || !canAccessWorkspaceDestination(view, grants, destination.searchParams)) return null;
  return destination.pathname + destination.search + destination.hash;
}
