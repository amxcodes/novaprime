/** Netlify Cron adapter implementation: the protected NOVA endpoint remains the only runner. */
export default async function backgroundTick(): Promise<Response> {
  if (process.env.NOVA_BACKGROUND_SCHEDULER !== "netlify") return new Response(null, { status: 204 });
  const origin = process.env.NOVA_PUBLIC_ORIGIN ?? process.env.BETTER_AUTH_URL;
  const secret = process.env.NOVA_BACKGROUND_JOB_SECRET;
  if (!origin || !secret) return new Response("NOVA scheduler is not configured", { status: 503 });

  const response = await fetch(`${origin.replace(/\/$/, "")}/api/internal/background/tick`, {
    method: "POST",
    headers: {
      authorization: `Bearer ${secret}`,
      "x-nova-background-scheduler": "netlify",
    },
  });
  return new Response(await response.text(), {
    status: response.status,
    headers: { "content-type": "application/json" },
  });
}
