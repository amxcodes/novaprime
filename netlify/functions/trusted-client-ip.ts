export const NETLIFY_CONTEXT_IP_HEADER = "x-nova-remote-ip";

/** Minimal structural view of Netlify's native Function Context. */
export type NetlifyRequestContext = Readonly<{
  ip?: string;
}>;

/** Copy the request and derive the private client-IP header only from Netlify. */
export function requestWithNetlifyContextIp(
  request: Request,
  contextIp: string | undefined,
): Request {
  const headers = new Headers(request.headers);
  const trustedIp = contextIp?.trim();

  if (trustedIp) {
    headers.set(NETLIFY_CONTEXT_IP_HEADER, trustedIp);
  } else {
    // Never let a client-supplied value survive if Netlify cannot provide one.
    headers.delete(NETLIFY_CONTEXT_IP_HEADER);
  }

  const init: RequestInit & { duplex?: "half" } = {
    method: request.method,
    headers,
    cache: request.cache,
    credentials: request.credentials,
    integrity: request.integrity,
    keepalive: request.keepalive,
    mode: request.mode,
    redirect: request.redirect,
    referrer: request.referrer,
    referrerPolicy: request.referrerPolicy,
    signal: request.signal,
  };

  if (request.body) {
    init.body = request.body;
    // Node's Fetch implementation requires this when forwarding a stream.
    init.duplex = "half";
  }

  return new Request(request.url, init);
}
