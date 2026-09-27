import { afterEach, expect, test } from "bun:test";

const environmentKeys = [
  "NOVA_BACKGROUND_SCHEDULER",
  "NOVA_PUBLIC_ORIGIN",
  "BETTER_AUTH_URL",
  "NOVA_BACKGROUND_JOB_SECRET",
] as const;
const previousEnvironment = new Map(environmentKeys.map((key) => [key, process.env[key]]));
const originalFetch = globalThis.fetch;

afterEach(() => {
  for (const key of environmentKeys) {
    const previous = previousEnvironment.get(key);
    if (previous === undefined) delete process.env[key];
    else process.env[key] = previous;
  }
  globalThis.fetch = originalFetch;
});

async function handler(): Promise<(event?: unknown) => Promise<Response>> {
  // Bun loads the TypeScript-module extension directly; keep the path dynamic
  // so the Node-oriented deployment typecheck doesn't require an extension flag.
  const modulePath = "./nova-background-tick.mts";
  const loaded = await import(modulePath);
  return loaded.default as (event?: unknown) => Promise<Response>;
}

test("Netlify Cron is inert unless Netlify is the selected scheduler", async () => {
  process.env.NOVA_BACKGROUND_SCHEDULER = "supabase";
  let requests = 0;
  globalThis.fetch = (async () => {
    requests += 1;
    return Response.json({ tick: true });
  }) as unknown as typeof fetch;

  const response = await (await handler())();

  expect(response.status).toBe(204);
  expect(requests).toBe(0);
});

test("Netlify Cron fails closed without its NOVA origin and tick secret", async () => {
  process.env.NOVA_BACKGROUND_SCHEDULER = "netlify";
  delete process.env.NOVA_PUBLIC_ORIGIN;
  delete process.env.BETTER_AUTH_URL;
  delete process.env.NOVA_BACKGROUND_JOB_SECRET;

  const response = await (await handler())();

  expect(response.status).toBe(503);
});

test("Netlify Cron forwards one authenticated POST to the canonical NOVA tick", async () => {
  process.env.NOVA_BACKGROUND_SCHEDULER = "netlify";
  process.env.NOVA_PUBLIC_ORIGIN = "https://nova.example/";
  process.env.NOVA_BACKGROUND_JOB_SECRET = "nova-tick-secret";

  let capturedUrl = "";
  let capturedInit: RequestInit | undefined;
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    capturedUrl = String(input);
    capturedInit = init;
    return Response.json({ tick: { closedAttendance: 0 } });
  }) as unknown as typeof fetch;

  const response = await (await handler())();
  const headers = new Headers(capturedInit?.headers);

  expect(capturedUrl).toBe("https://nova.example/api/internal/background/tick");
  expect(capturedInit?.method).toBe("POST");
  expect(headers.get("authorization")).toBe("Bearer nova-tick-secret");
  expect(headers.get("x-nova-background-scheduler")).toBe("netlify");
  expect(response.status).toBe(200);
  expect(await response.json()).toEqual({ tick: { closedAttendance: 0 } });
});
