import { requestFailureStatus } from "./request-failure.js";
import { withRequestActorResolutionCache } from "./request-actor.js";

const workReadRoutes = new Map([
  ["/api/work/assignments/mine", { name: "assignments", query: ["limit", "status", "due", "q", "cursor"] }],
  ["/api/work/timeline", { name: "timeline", query: ["date"] }],
  ["/api/reviews/pending", { name: "reviews", query: ["assignmentId", "taskId"] }],
  ["/api/task-reviewer-requests", { name: "reviewer-requests", query: ["requestId"] }],
  ["/api/task-handover-requests", { name: "handover-requests", query: ["requestId"] }],
  ["/api/work/tasks/visible", { name: "visible-tasks", query: ["limit", "status", "due", "q", "cursor"] }],
  ["/api/task-catalog", { name: "task-catalog", query: [] }],
  ["/api/attendance/today", { name: "attendance", query: [] }],
  ["/api/task-assignments/reviewer-management", { name: "reviewer-management", query: ["limit", "cursor"] }],
]);

const maxWorkPageReads = 9;
const maxWorkPageReadBytes = 16_384;
const timelineReadPhases = ["access", "data", "adjustment"] as const;

type WorkPageReadRoute = {
  name: string;
  query: string[];
};

type WorkPageReadItem = {
  path: string;
  status: number;
  body: unknown;
};

type WorkPageReadResult = WorkPageReadItem & {
  name: string;
  durationMs: number;
  timelinePhases?: Partial<Record<(typeof timelineReadPhases)[number], number>>;
};

type DispatchRead = (request: Request) => Promise<Response>;

function safeTimelinePhases(serverTiming: string | null): WorkPageReadResult["timelinePhases"] {
  if (!serverTiming) return undefined;
  const phases: NonNullable<WorkPageReadResult["timelinePhases"]> = {};
  for (const entry of serverTiming.split(",")) {
    const match = /^\s*nova-timeline-(access|data|adjustment)\s*;\s*dur=([\d.]+)\s*$/i.exec(entry);
    if (!match) continue;
    const durationMs = Number(match[2]);
    if (Number.isFinite(durationMs) && durationMs >= 0 && durationMs <= 60_000) {
      phases[match[1] as (typeof timelineReadPhases)[number]] = durationMs;
    }
  }
  return Object.keys(phases).length ? phases : undefined;
}

function errorResponse(error: string, status: number): Response {
  return Response.json({ error }, {
    status,
    headers: { "cache-control": "no-store" },
  });
}

async function boundedBodyText(request: Request): Promise<string | null | undefined> {
  const reader = request.body?.getReader();
  if (!reader) return "";
  const chunks: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > maxWorkPageReadBytes) {
      await reader.cancel().catch(() => undefined);
      reader.releaseLock();
      return undefined;
    }
    chunks.push(value);
  }
  reader.releaseLock();

  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    return null;
  }
}

function validatePaths(value: unknown, origin: string): Array<{ path: string; route: WorkPageReadRoute }> | null {
  if (!Array.isArray(value) || value.length < 1 || value.length > maxWorkPageReads) return null;

  const validated: Array<{ path: string; route: WorkPageReadRoute }> = [];
  const uniquePaths = new Set<string>();
  for (const path of value) {
    if (typeof path !== "string" || path.length > 4_096 || !path.startsWith("/api/")) return null;
    let url: URL;
    try {
      url = new URL(path, origin);
    } catch {
      return null;
    }
    if (url.origin !== origin || url.hash || url.username || url.password) return null;

    const route = workReadRoutes.get(url.pathname);
    if (!route) return null;
    for (const key of new Set(url.searchParams.keys())) {
      if (!route.query.includes(key) || url.searchParams.getAll(key).length !== 1) return null;
    }
    if (uniquePaths.has(url.href)) return null;
    uniquePaths.add(url.href);
    validated.push({ path, route });
  }
  return validated;
}

/**
 * Dispatch only the bounded Work reads selected by the client-side permission
 * plan. Each existing endpoint still performs its normal server authorization.
 */
export async function readWorkPage(
  request: Request,
  dispatchRead: DispatchRead,
): Promise<Response> {
  if (request.method !== "POST") return errorResponse("METHOD_NOT_ALLOWED", 405);
  if (request.headers.get("content-type")?.split(";", 1)[0].trim().toLowerCase() !== "application/json") {
    return errorResponse("JSON_BODY_REQUIRED", 415);
  }
  const contentLength = Number(request.headers.get("content-length"));
  if (Number.isFinite(contentLength) && contentLength > maxWorkPageReadBytes) {
    return errorResponse("REQUEST_TOO_LARGE", 413);
  }

  const text = await boundedBodyText(request);
  if (text === undefined) return errorResponse("REQUEST_TOO_LARGE", 413);
  if (text === null) return errorResponse("INVALID_BODY_TEXT", 400);
  let body: unknown;
  try {
    body = JSON.parse(text);
  } catch {
    return errorResponse("INVALID_JSON", 400);
  }
  if (!body || typeof body !== "object" || Array.isArray(body) ||
      Object.keys(body).some((key) => key !== "reads")) {
    return errorResponse("INVALID_WORK_READ_PLAN", 400);
  }
  const paths = validatePaths(
    (body as { reads?: unknown }).reads,
    new URL(request.url).origin,
  );
  if (!paths) return errorResponse("INVALID_WORK_READ_PLAN", 400);

  const headers = new Headers(request.headers);
  headers.delete("content-length");
  headers.delete("content-type");
  const reads = await withRequestActorResolutionCache(() => Promise.all(paths.map(async ({ path, route }) => {
    const startedAt = performance.now();
    try {
      const response = await dispatchRead(new Request(new URL(path, request.url), {
        method: "GET",
        headers,
        signal: request.signal,
      }));
      const result: WorkPageReadItem = {
        path,
        status: response.status,
        body: await response.json().catch(() => ({ error: "INVALID_READ_RESPONSE" })),
      };
      return {
        ...result,
        name: route.name,
        durationMs: performance.now() - startedAt,
        ...(route.name === "timeline" ? { timelinePhases: safeTimelinePhases(response.headers.get("server-timing")) } : {}),
      };
    } catch (error) {
      const code = error && typeof error === "object" && "code" in error && typeof error.code === "string"
        ? error.code
        : "UNKNOWN";
      console.error(`NOVA_WORK_PAGE_READ_FAILED GET ${code}`);
      const status = requestFailureStatus(error);
      return {
        path,
        status,
        body: { error: status === 503 ? "SERVICE_UNAVAILABLE" : "INTERNAL_ERROR" },
        name: route.name,
        durationMs: performance.now() - startedAt,
      };
    }
  })));

  const unauthenticated = reads.find((read) => read.status === 401);
  if (unauthenticated) {
    const error = unauthenticated.body && typeof unauthenticated.body === "object" && "error" in unauthenticated.body
      ? String(unauthenticated.body.error)
      : "AUTHENTICATION_REQUIRED";
    return errorResponse(error, 401);
  }
  if (reads.some((read) => read.status === 403 &&
      read.body && typeof read.body === "object" &&
      ("error" in read.body ? read.body.error : "code" in read.body ? read.body.code : undefined) === "ACCOUNT_NOT_OPERATIONAL")) {
    return errorResponse("ACCOUNT_NOT_OPERATIONAL", 403);
  }
  if (reads.every((read) => read.status >= 500)) {
    return errorResponse(reads.some((read) => read.status === 503) ? "SERVICE_UNAVAILABLE" : "INTERNAL_ERROR",
      reads.some((read) => read.status === 503) ? 503 : 500);
  }

  const serverTiming = reads.flatMap(({ name, durationMs, timelinePhases }) => [
    `nova-work-${name};dur=${Math.max(0, durationMs).toFixed(1)}`,
    ...(timelinePhases ? Object.entries(timelinePhases).map(([phase, phaseDurationMs]) =>
      `nova-work-timeline-${phase};dur=${Math.max(0, phaseDurationMs).toFixed(1)}`,
    ) : []),
  ]).join(", ");
  const responseReads = reads.map(({ timelinePhases: _timelinePhases, ...read }) => read);
  return Response.json({ reads: responseReads }, {
    headers: {
      "cache-control": "no-store",
      "server-timing": serverTiming,
    },
  });
}
