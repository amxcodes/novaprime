import type { DatabaseDiagnostics } from "../../server/src/database-diagnostics.js";

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
const safeWorkReadNames = new Set([
  "assignments", "timeline", "reviews", "reviewer-requests",
  "handover-requests", "visible-tasks",
  "task-catalog", "attendance", "reviewer-management",
  "timeline-access", "timeline-data",
]);

const safeTimelinePhases = new Set(["access", "data"]);

export type SlowRequestInput = Readonly<{
  method: string;
  pathname: string;
  status: number;
  durationMs: number;
  appMs?: number;
  authModuleLoadMs?: number;
  entryModuleLoadMs: number;
  serverTiming?: string;
  databaseDiagnostics?: DatabaseDiagnostics;
}>;

function safeWorkReadTimings(serverTiming: string | undefined): Record<string, number> | undefined {
  if (!serverTiming) return undefined;
  const timings: Record<string, number> = {};
  for (const entry of serverTiming.split(",")) {
    const match = /^\s*nova-work-([a-z-]+)\s*;\s*dur=([\d.]+)\s*$/i.exec(entry);
    if (!match || !safeWorkReadNames.has(match[1])) continue;
    const duration = Number(match[2]);
    if (Number.isFinite(duration) && duration >= 0 && duration <= 60_000) {
      timings[match[1]] = Math.round(duration);
    }
  }
  return Object.keys(timings).length ? timings : undefined;
}

function safeTimelinePhaseTimings(serverTiming: string | undefined): Record<string, number> | undefined {
  if (!serverTiming) return undefined;
  const timings: Record<string, number> = {};
  for (const entry of serverTiming.split(",")) {
    const match = /^\s*nova-timeline-(access|data)\s*;\s*dur=([\d.]+)\s*$/i.exec(entry);
    if (!match || !safeTimelinePhases.has(match[1])) continue;
    const duration = Number(match[2]);
    if (Number.isFinite(duration) && duration >= 0 && duration <= 60_000) {
      timings[match[1]] = Math.round(duration);
    }
  }
  return Object.keys(timings).length ? timings : undefined;
}

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
  const database = input.databaseDiagnostics;
  const workReadTimings = safeWorkReadTimings(input.serverTiming);
  const timelinePhaseTimings = safeTimelinePhaseTimings(input.serverTiming);
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
    ...(workReadTimings ? { work_read_ms: workReadTimings } : {}),
    ...(timelinePhaseTimings ? { timeline_phase_ms: timelinePhaseTimings } : {}),
    ...(database ? {
      nova_db_pool_acquire_ms: Math.round(database.nova.poolAcquireMs),
      nova_db_pool_acquisitions: database.nova.poolAcquisitions,
      nova_db_pool_acquire_failures: database.nova.poolAcquireFailures,
      nova_db_pool_idle_available: database.nova.poolAcquireIdleAvailable,
      nova_db_pool_capacity_available: database.nova.poolAcquireCapacityAvailable,
      nova_db_pool_at_capacity: database.nova.poolAcquireAtCapacity,
      nova_db_pool_max_waiting_at_acquire: database.nova.maxPoolWaitingCountAtAcquire,
      nova_db_query_ms: Math.round(database.nova.queryRoundTripMs),
      nova_db_queries: database.nova.queries,
      nova_db_query_failures: database.nova.queryFailures,
      nova_db_max_query_ms: Math.round(database.nova.maxQueryRoundTripMs),
      auth_db_pool_acquire_ms: Math.round(database.auth.poolAcquireMs),
      auth_db_pool_acquisitions: database.auth.poolAcquisitions,
      auth_db_pool_acquire_failures: database.auth.poolAcquireFailures,
      auth_db_pool_idle_available: database.auth.poolAcquireIdleAvailable,
      auth_db_pool_capacity_available: database.auth.poolAcquireCapacityAvailable,
      auth_db_pool_at_capacity: database.auth.poolAcquireAtCapacity,
      auth_db_pool_max_waiting_at_acquire: database.auth.maxPoolWaitingCountAtAcquire,
      auth_db_query_ms: Math.round(database.auth.queryRoundTripMs),
      auth_db_queries: database.auth.queries,
      auth_db_query_failures: database.auth.queryFailures,
      auth_db_max_query_ms: Math.round(database.auth.maxQueryRoundTripMs),
    } : {}),
  } as const;
}
