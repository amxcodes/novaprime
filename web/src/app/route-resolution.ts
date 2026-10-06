/** Stable route IDs shared by URL resolution and the capability-filtered shell. */
export const WORKSPACE_ROUTE_IDS = Object.freeze([
  "today",
  "work",
  "availability",
  "people",
  "notifications",
  "operations",
  "admin",
  "admin-organisation",
  "admin-availability",
  "admin-access",
  "admin-work",
  "admin-requests",
  "admin-audit",
  "invite",
  "work-setup",
  "settings",
] as const);

export type WorkspaceRouteId = (typeof WORKSPACE_ROUTE_IDS)[number];

export type PublicRouteId = "accept" | "reset" | "setup" | "login" | "forgot" | "deploy";

export type ApplicationRoute =
  | { kind: "public"; view: PublicRouteId }
  | { kind: "workspace"; view: WorkspaceRouteId | null };

type LocationInput = Pick<Location, "pathname" | "search">;
type ResolveWorkspaceRoute = (params: URLSearchParams) => WorkspaceRouteId | null;

const QUERY_PUBLIC_ROUTES = ["setup", "login", "forgot", "deploy"] as const;

type QueryPublicRouteId = (typeof QUERY_PUBLIC_ROUTES)[number];

function isQueryPublicRoute(value: string | null): value is QueryPublicRouteId {
  return value !== null && (QUERY_PUBLIC_ROUTES as readonly string[]).includes(value);
}

/**
 * Resolve only the requested route from the URL. Identity and capability
 * checks stay with the application host and server-authorized route plan.
 */
export function resolveApplicationRoute(
  location: LocationInput,
  resolveWorkspaceRoute: ResolveWorkspaceRoute,
): ApplicationRoute {
  if (location.pathname === "/accept-invite" || location.pathname.endsWith("/accept-invite/")) {
    return { kind: "public", view: "accept" };
  }
  if (location.pathname === "/reset-password" || location.pathname.endsWith("/reset-password/")) {
    return { kind: "public", view: "reset" };
  }

  const params = new URLSearchParams(location.search);
  const requestedView = params.get("view");
  if (isQueryPublicRoute(requestedView)) {
    return { kind: "public", view: requestedView };
  }

  return { kind: "workspace", view: resolveWorkspaceRoute(params) };
}
