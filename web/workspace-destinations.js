import {
  canShowAdminNavigation,
  canShowAvailabilityNavigation,
  canShowInviteNavigation,
  canShowOperationsNavigation,
  canShowPeopleNavigation,
  canShowTodayNavigation,
  canShowWorkNavigation,
  canShowWorkSetupNavigation,
} from "./admin-read-state.js";
import { canShowAdminArea } from "./src/pages/admin/admin-areas.ts";
import { isCollaborationRequestId, readFocusedCollaborationRequest } from "./app/work-route.js";
import { WORKSPACE_ROUTE_IDS } from "./src/app/route-resolution.ts";

/**
 * Current signed-in workspace destinations. Keep this list limited to routes
 * that the application actually renders; public/auth routes are separate.
 */
export const WORKSPACE_DESTINATIONS = Object.freeze([
  Object.freeze({
    view: "today", label: "My Day", summary: "Your attendance, active work, and daily timeline.", group: "My workspace", requiresResolvedGrants: true,
    homePriority: 1,
    canAccess: canShowTodayNavigation,
  }),
  Object.freeze({
    view: "work", label: "Work", summary: "Work tools available under your access.", group: "My workspace", requiresResolvedGrants: true,
    homePriority: 2,
    canAccess: canShowWorkNavigation,
  }),
  Object.freeze({
    view: "availability", label: "Availability", summary: "Availability tools available under your access.", group: "My workspace", requiresResolvedGrants: true,
    homePriority: 3,
    canAccess: canShowAvailabilityNavigation,
  }),
  Object.freeze({
    view: "people", label: "People", summary: "People tools available under your access.", group: "Team operations", requiresResolvedGrants: true,
    canAccess: canShowPeopleNavigation,
    homePriority: 5,
  }),
  Object.freeze({
    view: "notifications", label: "Notifications", summary: "Your NOVA notifications and activity.", group: "My workspace", requiresResolvedGrants: false,
    canAccess: () => true,
  }),
  Object.freeze({
    view: "operations", label: "Operations", summary: "Operational pages available under your access.", group: "Team operations", requiresResolvedGrants: true,
    homePriority: 4,
    canAccess: canShowOperationsNavigation,
  }),
  Object.freeze({
    view: "admin", label: "Admin console", summary: "Organization controls available under your access.", group: "Team operations", requiresResolvedGrants: true,
    navigation: false,
    homePriority: 6,
    canAccess: canShowAdminNavigation,
  }),
  Object.freeze({
    view: "admin-organisation", label: "Organisation", summary: "Organisation structure and attendance policy.", group: "Administration", requiresResolvedGrants: true,
    canAccess: (read) => canShowAdminArea(read, "organisation"),
  }),
  Object.freeze({
    view: "admin-availability", label: "Availability", summary: "Working calendars, shifts, holidays, and WFH policy.", group: "Administration", requiresResolvedGrants: true,
    canAccess: (read) => canShowAdminArea(read, "availability"),
  }),
  Object.freeze({
    view: "admin-access", label: "People and access", summary: "People administration, roles, and ownership controls.", group: "Administration", requiresResolvedGrants: true,
    canAccess: (read) => canShowAdminArea(read, "access"),
  }),
  Object.freeze({
    view: "admin-work", label: "Work administration", summary: "Client work and task controls.", group: "Administration", requiresResolvedGrants: true,
    canAccess: (read) => canShowAdminArea(read, "work"),
  }),
  Object.freeze({
    view: "admin-requests", label: "Requests and exceptions", summary: "Leave, WFH, and exception review.", group: "Administration", requiresResolvedGrants: true,
    canAccess: (read) => canShowAdminArea(read, "requests"),
  }),
  Object.freeze({
    view: "admin-audit", label: "Audit and delivery", summary: "Audit events and notification delivery.", group: "Administration", requiresResolvedGrants: true,
    canAccess: (read) => canShowAdminArea(read, "audit"),
  }),
  Object.freeze({
    view: "invite", label: "Invite a person", summary: "Invite someone to NOVA with an assigned role.", group: "Team operations", requiresResolvedGrants: true,
    homePriority: 7,
    canAccess: canShowInviteNavigation,
  }),
  Object.freeze({
    view: "work-setup", label: "Work setup", summary: "Work configuration available under your access.", group: "Configuration", requiresResolvedGrants: true,
    homePriority: 8,
    canAccess: canShowWorkSetupNavigation,
  }),
  Object.freeze({
    view: "settings", label: "Settings", summary: "Appearance and personal workspace preferences.", group: "Configuration", requiresResolvedGrants: false,
    homePriority: 9,
    canAccess: () => true,
  }),
]);

export const WORKSPACE_DESTINATION_VIEW_IDS = WORKSPACE_ROUTE_IDS;

/** Resolve links emitted by older task notifications into the current Work surface. */
export function resolveWorkspaceDestinationView(params) {
  const view = params.get("view");
  const reviewerRequestIds = params.getAll("reviewerRequest");
  const handoverRequestIds = params.getAll("handoverRequest");
  if (reviewerRequestIds.length || handoverRequestIds.length) {
    const targets = [...reviewerRequestIds, ...handoverRequestIds];
    if (view !== "work" || params.getAll("view").length !== 1 ||
        targets.length !== 1 || !isCollaborationRequestId(targets[0])) return null;
    return "work";
  }
  if (view === "today" && (params.has("task") || params.has("review"))) return "work";
  return WORKSPACE_DESTINATION_VIEW_IDS.includes(view) ? view : null;
}

const destinationByView = new Map(
  WORKSPACE_DESTINATIONS.map((destination) => [destination.view, destination]),
);

function hasResolvedGrantRead(read) {
  return Boolean(
    read &&
    !read.readError &&
    typeof read.actorPersonId === "string" &&
    read.actorPersonId.length > 0 &&
    Array.isArray(read.grants),
  );
}

/**
 * The same access decision powers navigation visibility and direct route
 * gating. Personal inbox/settings remain available if the grants read fails.
 */
export function canAccessWorkspaceDestination(view, read, routeParams) {
  const destination = destinationByView.get(view);
  if (!destination) return false;
  if (destination.requiresResolvedGrants && !hasResolvedGrantRead(read)) return false;
  const focusedRequest = view === "work" && routeParams && resolveWorkspaceDestinationView(routeParams) === "work"
    ? readFocusedCollaborationRequest(routeParams)
    : { status: "none" };
  if (focusedRequest.status === "focused") return true;
  return destination.canAccess(read);
}

export function getVisibleWorkspaceDestinations(read) {
  return WORKSPACE_DESTINATIONS.filter(({ view, navigation }) =>
    navigation !== false && canAccessWorkspaceDestination(view, read),
  );
}

export function resolveWorkspaceHome(read) {
  const candidates = WORKSPACE_DESTINATIONS
    .filter((destination) => Number.isFinite(destination.homePriority))
    .sort((left, right) => left.homePriority - right.homePriority);
  const defaultDestination = candidates.at(-1);
  return candidates.find(({ view }) => canAccessWorkspaceDestination(view, read))?.view
    ?? defaultDestination?.view;
}
