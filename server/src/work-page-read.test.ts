import { expect, mock, test } from "bun:test";

let actorScopes = 0;
mock.module("./request-actor.js", () => ({
  withRequestActorResolutionCache: async <T>(operation: () => Promise<T>) => {
    actorScopes += 1;
    return operation();
  },
}));

const { readWorkPage } = await import("./work-page-read.js");

function request(reads: unknown, headers: Record<string, string> = {}): Request {
  return new Request("https://nova.test/api/work/page-read", {
    method: "POST",
    headers: { "content-type": "application/json", origin: "https://nova.test", ...headers },
    body: JSON.stringify({ reads }),
  });
}

test("dispatches only bounded GET reads and preserves each existing response", async () => {
  actorScopes = 0;
  const dispatches: Request[] = [];
  const response = await readWorkPage(request([
    "/api/task-catalog",
    "/api/attendance/today",
  ], { cookie: "nova-session=private" }), async (read) => {
    dispatches.push(read);
    return read.url.endsWith("attendance/today")
      ? Response.json({ error: "OFFICE_ASSIGNMENT_REQUIRED" }, { status: 409 })
      : Response.json({ clients: [] });
  });

  expect(response.status).toBe(200);
  expect(actorScopes).toBe(1);
  expect(dispatches.map((read) => [read.method, new URL(read.url).pathname])).toEqual([
    ["GET", "/api/task-catalog"],
    ["GET", "/api/attendance/today"],
  ]);
  expect(dispatches[0]?.headers.get("cookie")).toBe("nova-session=private");
  expect((await response.json()).reads.map((item: { status: number }) => item.status)).toEqual([200, 409]);
  expect(response.headers.get("server-timing")).toContain("nova-work-task-catalog;dur=");
  expect(response.headers.get("server-timing")).toContain("nova-work-attendance;dur=");
});

test("rejects mutation, unknown, cross-origin, duplicate, malformed and unbounded reads before dispatch", async () => {
  const invalidPlans = [
    ["/api/work-sessions/start"],
    ["/api/admin/people"],
    ["https://attacker.test/api/work-context"],
    ["/api/work-context?unknown=1"],
    ["/api/work-context?q=one&q=two"],
    ["/api/work-context", "/api/work-context"],
    Array.from({ length: 13 }, () => "/api/work-context?q=duplicate"),
  ];
  for (const reads of invalidPlans) {
    let dispatchCount = 0;
    const response = await readWorkPage(request(reads), async () => {
      dispatchCount += 1;
      return Response.json({});
    });
    expect(response.status).toBe(400);
    expect(dispatchCount).toBe(0);
  }

  const oversized = await readWorkPage(new Request("https://nova.test/api/work/page-read", {
    method: "POST",
    headers: { "content-type": "application/json", origin: "https://nova.test" },
    body: JSON.stringify({ reads: ["/api/work-context"], padding: "x".repeat(20_000) }),
  }), async () => Response.json({}));
  expect(oversized.status).toBe(413);
});

test("requires POST JSON and promotes authentication failures to the outer request", async () => {
  const getResponse = await readWorkPage(new Request("https://nova.test/api/work/page-read"), async () => Response.json({}));
  expect(getResponse.status).toBe(405);

  const unauthorized = await readWorkPage(request(["/api/task-catalog"]), async () =>
    Response.json({ error: "AUTHENTICATION_REQUIRED" }, { status: 401 }),
  );
  expect(unauthorized.status).toBe(401);
  expect(await unauthorized.json()).toEqual({ error: "AUTHENTICATION_REQUIRED" });

  const unavailable = await readWorkPage(request(["/api/task-catalog"]), async () => {
    throw Object.assign(new Error("private database detail"), { code: "28P01" });
  });
  expect(unavailable.status).toBe(503);
  expect(await unavailable.json()).toEqual({ error: "SERVICE_UNAVAILABLE" });
});
