import { requestWithNetlifyContextIp, type NetlifyRequestContext } from "./trusted-client-ip.js";

// Netlify controls the edge forwarding headers for this function runtime.
process.env.NOVA_TRUST_PROXY_HEADERS ??= "true";
// Better Auth must use only the address supplied by Netlify's trusted context.
process.env.NOVA_AUTH_IP_ADDRESS_HEADER = "x-nova-remote-ip";

// Load after the Netlify-specific auth settings above are in place.
const novaApp = import("../../server/src/app");

export default async function handler(
  request: Request,
  context: NetlifyRequestContext,
): Promise<Response> {
  const { handleRequest } = await novaApp;
  return handleRequest(requestWithNetlifyContextIp(request, context.ip));
}

export const config = { path: "/api/*" };
