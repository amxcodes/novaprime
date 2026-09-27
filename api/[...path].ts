import { handleRequest } from "../server/src/app";

// Vercel controls the edge forwarding headers for this function runtime.
process.env.NOVA_TRUST_PROXY_HEADERS ??= "true";

/**
 * Vercel Cron sends a provider-authenticated GET. Translate it in-process to
 * NOVA's canonical protected POST; no second maintenance implementation or
 * network self-call is needed.
 */
async function fetchRequest(request: Request): Promise<Response> {
  const url = new URL(request.url);
  if (request.method === "GET" && url.pathname === "/api/internal/background/tick") {
    if (process.env.NOVA_BACKGROUND_SCHEDULER !== "vercel") return new Response(null, { status: 204 });
    const cronSecret = process.env.CRON_SECRET;
    if (!cronSecret || request.headers.get("authorization") !== `Bearer ${cronSecret}`) {
      return new Response("Unauthorized", { status: 401 });
    }
    const backgroundSecret = process.env.NOVA_BACKGROUND_JOB_SECRET;
    if (!backgroundSecret) {
      return new Response("NOVA scheduler is not configured", { status: 503 });
    }
    return handleRequest(new Request(url, {
      method: "POST",
      headers: {
        authorization: `Bearer ${backgroundSecret}`,
        "x-nova-background-scheduler": "vercel",
      },
    }));
  }
  return handleRequest(request);
}

export default { fetch: fetchRequest };
