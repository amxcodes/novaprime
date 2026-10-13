import { requestFailureStatus } from "./request-failure.js";
import { withRequestActorResolutionCache } from "./request-actor.js";

export type PageReadRoute = Readonly<{
  name: string;
  query: readonly string[];
}>;

export type PageReadResult = Readonly<{
  path: string;
  status: number;
  body: unknown;
}>;

type DispatchRead = (request: Request) => Promise<Response>;

type PageReadOptions = Readonly<{
  routes: ReadonlyMap<string, PageReadRoute>;
  maxReads: number;
  timingPrefix: string;
  failureEvent: string;
  invalidPlanError: string;
  includeTimelinePhases?: boolean;
}>;

const maxPageReadBytes = 16_384;
const timelineReadPhases = ["access", "data"] as const;

type PageReadResultWithTiming = PageReadResult & {
  name: string;
  durationMs: number;
  timelinePhases?: Partial<Record<(typeof timelineReadPhases)[number], number>>;
};

function safeTimelinePhases(serverTiming: string | null): PageReadResultWithTiming["timelinePhases"] {
  if (!serverTiming) return undefined;
  const phases: NonNullable<PageReadResultWithTiming["timelinePhases"]> = {};
  for (const entry of serverTiming.split(",")) {
    const match = /^\s*nova-timeline-(access|data)\s*;\s*dur=([\d.]+)\s*$/i.exec(entry);
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
    if (size > maxPageReadBytes) {
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

function validatePaths(
  value: unknown,
  origin: string,
  options: PageReadOptions,
): Array<{ path: string; route: PageReadRoute }> | null {
  if (!Array.isArray(value) || value.length < 1 || value.length > options.maxReads) return null;

  const validated: Array<{ path: string; route: PageReadRoute }> = [];
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

    const route = options.routes.get(url.pathname);
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

/** Dispatch a small, explicitly allowlisted set of read-only API routes. */
export async function readPage(
  request: Request,
  dispatchRead: DispatchRead,
  options: PageReadOptions,
): Promise<Response> {
  if (request.method !== "POST") return errorResponse("METHOD_NOT_ALLOWED", 405);
  if (request.headers.get("content-type")?.split(";", 1)[0].trim().toLowerCase() !== "application/json") {
    return errorResponse("JSON_BODY_REQUIRED", 415);
  }
  const contentLength = Number(request.headers.get("content-length"));
  if (Number.isFinite(contentLength) && contentLength > maxPageReadBytes) {
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
    return errorResponse(options.invalidPlanError, 400);
  }
  const paths = validatePaths(
    (body as { reads?: unknown }).reads,
    new URL(request.url).origin,
    options,
  );
  if (!paths) return errorResponse(options.invalidPlanError, 400);

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
      const result: PageReadResult = {
        path,
        status: response.status,
        body: await response.json().catch(() => ({ error: "INVALID_READ_RESPONSE" })),
      };
      return {
        ...result,
        name: route.name,
        durationMs: performance.now() - startedAt,
        ...(options.includeTimelinePhases && route.name === "timeline"
          ? { timelinePhases: safeTimelinePhases(response.headers.get("server-timing")) }
          : {}),
      } satisfies PageReadResultWithTiming;
    } catch (error) {
      const code = error && typeof error === "object" && "code" in error && typeof error.code === "string"
        ? error.code
        : "UNKNOWN";
      console.error(`NOVA_${options.failureEvent} GET ${code}`);
      const status = requestFailureStatus(error);
      return {
        path,
        status,
        body: { error: status === 503 ? "SERVICE_UNAVAILABLE" : "INTERNAL_ERROR" },
        name: route.name,
        durationMs: performance.now() - startedAt,
      } satisfies PageReadResultWithTiming;
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
    `${options.timingPrefix}-${name};dur=${Math.max(0, durationMs).toFixed(1)}`,
    ...(timelinePhases ? Object.entries(timelinePhases).map(([phase, phaseDurationMs]) =>
      `${options.timingPrefix}-timeline-${phase};dur=${Math.max(0, phaseDurationMs).toFixed(1)}`,
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
