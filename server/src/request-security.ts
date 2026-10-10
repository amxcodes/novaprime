import { configuredPublicOrigins } from "./public-origin.js";

const stateChangingMethods = new Set(["POST", "PUT", "PATCH", "DELETE"]);

function originFrom(value: string | null): string | undefined {
  if (!value || value === "null") return undefined;
  try {
    return new URL(value).origin;
  } catch {
    return undefined;
  }
}

function rejection(): Response {
  return Response.json(
    { error: "CSRF_ORIGIN_INVALID" },
    { status: 403, headers: { "cache-control": "no-store" } },
  );
}

/**
 * Better Auth applies its own origin/CSRF middleware to /api/auth. NOVA's
 * domain commands are separate cookie-authenticated endpoints, so they need
 * the same boundary before a browser can reach a state-changing command.
 * Requests without browser origin metadata remain usable for operator/API
 * clients; a request carrying a session cookie must prove its same-origin
 * source instead of relying on SameSite behaviour alone.
 */
export function stateChangingRequestError(
  request: Request,
  environment = process.env,
): Response | undefined {
  if (!stateChangingMethods.has(request.method.toUpperCase())) return undefined;

  const requestOrigin = new URL(request.url).origin;
  const allowedOrigins = new Set([requestOrigin]);
  try {
    const configured = configuredPublicOrigins(environment);
    if (!configured.includes(requestOrigin)) return rejection();
    configured.forEach((origin) => allowedOrigins.add(origin));
  } catch {
    // Authentication configuration validation reports malformed URLs later.
  }

  const originHeader = request.headers.get("origin");
  const refererHeader = request.headers.get("referer");
  const candidates = [originFrom(originHeader), originFrom(refererHeader)].filter(
    (candidate): candidate is string => Boolean(candidate),
  );
  const hasInvalidExplicitOrigin = (originHeader !== null && !originFrom(originHeader)) ||
    (refererHeader !== null && !originFrom(refererHeader));
  if (hasInvalidExplicitOrigin || candidates.some((candidate) => !allowedOrigins.has(candidate))) {
    return rejection();
  }

  if (request.headers.get("sec-fetch-site")?.toLowerCase() === "cross-site") {
    return rejection();
  }

  const hasSessionCookie = Boolean(request.headers.get("cookie"));
  if (hasSessionCookie && candidates.length === 0) {
    return rejection();
  }

  return undefined;
}
