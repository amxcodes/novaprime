const safeApiGroups = new Set([
  "attendance", "audit-events", "auth", "auth-handoffs", "availability",
  "clients", "email-connections", "health", "historical-exceptions",
  "internal", "invitations", "leave", "me", "notification-preferences",
  "notifications", "offices",
  "organisation", "organisation-departments", "people", "permissions",
  "ready", "reviews", "roles", "setup", "task-assignments", "task-catalog",
  "task-composer", "task-handover-requests", "task-reviewer-requests", "tasks",
  "work", "work-context", "work-groups", "work-sessions", "workstreams",
]);

export type SlowRequestInput = Readonly<{
  method: string;
  pathname: string;
  status: number;
  durationMs: number;
  appMs?: number;
  authModuleLoadMs?: number;
  entryModuleLoadMs: number;
}>;

/** Return a route label without identifiers, query strings, or arbitrary paths. */
function safeRoute(pathname: string): string {
  if (pathname === "/api/auth/get-session") return "auth.get-session";
  if (pathname === "/api/auth/sign-in/email") return "auth.sign-in";
  if (pathname === "/api/auth/sign-out") return "auth.sign-out";

  const group = pathname.startsWith("/api/") ? pathname.slice(5).split("/", 1)[0] : "";
  return group && safeApiGroups.has(group) ? `api.${group}` : "api.other";
}

/** Keep function logs quiet on normal requests and redact all request data. */
export function slowRequestDiagnostic(input: SlowRequestInput) {
  if (
    input.status < 500 && input.durationMs < 1_500 && (input.appMs ?? 0) < 750 &&
    (input.authModuleLoadMs ?? 0) < 750 && input.entryModuleLoadMs < 1_000
  ) return null;

  const method = /^(GET|POST|PUT|PATCH|DELETE|HEAD|OPTIONS)$/.test(input.method)
    ? input.method
    : "OTHER";
  return {
    event: "NOVA_REQUEST_DIAGNOSTIC",
    method,
    route: safeRoute(input.pathname),
    status: input.status,
    handler_ms: Math.round(input.durationMs),
    ...(input.appMs === undefined ? {} : { app_ms: Math.round(input.appMs) }),
    entry_module_load_ms: Math.round(input.entryModuleLoadMs),
    ...(input.authModuleLoadMs === undefined
      ? {}
      : { auth_module_load_ms: Math.round(input.authModuleLoadMs) }),
  } as const;
}
