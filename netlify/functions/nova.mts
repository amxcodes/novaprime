import { requestWithNetlifyContextIp, type NetlifyRequestContext } from "./trusted-client-ip.js";
import { slowRequestDiagnostic } from "./request-diagnostics.js";

// Netlify controls the edge forwarding headers for this function runtime.
process.env.NOVA_TRUST_PROXY_HEADERS ??= "true";
// Better Auth must use only the address supplied by Netlify's trusted context.
process.env.NOVA_AUTH_IP_ADDRESS_HEADER = "x-nova-remote-ip";

// Load after the Netlify-specific auth settings above are in place.
const moduleLoadStartedAt = performance.now();
let moduleLoadMs = 0;
const novaApp = import("../../server/src/app").then((module) => {
  moduleLoadMs = performance.now() - moduleLoadStartedAt;
  return module;
});

export default async function handler(
  request: Request,
  context: NetlifyRequestContext,
): Promise<Response> {
  const startedAt = performance.now();
  const { handleRequest } = await novaApp;
  const response = await handleRequest(requestWithNetlifyContextIp(request, context.ip));
  const durationMs = performance.now() - startedAt;
  const timing = response.headers.get("server-timing")?.match(/(?:^|,)\s*nova-app;dur=([\d.]+)/i);
  const diagnostic = slowRequestDiagnostic({
    method: request.method,
    pathname: new URL(request.url).pathname,
    status: response.status,
    durationMs,
    ...(timing ? { appMs: Number(timing[1]) } : {}),
    moduleLoadMs,
  });
  if (diagnostic) console.warn(JSON.stringify(diagnostic));
  return response;
}

export const config = { path: "/api/*" };
