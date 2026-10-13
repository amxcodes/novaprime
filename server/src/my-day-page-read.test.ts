import { expect, mock, test } from "bun:test";

let actorScopes = 0;
mock.module("./request-actor.js", () => ({
  withRequestActorResolutionCache: async <T>(operation: () => Promise<T>) => {
    actorScopes += 1;
    return operation();
  },
}));

const { readMyDayPage } = await import("./my-day-page-read.js");

function request(reads: unknown, headers: Record<string, string> = {}): Request {
  return new Request("https://nova.test/api/my-day/page-read", {
    method: "POST",
    headers: { "content-type": "application/json", origin: "https://nova.test", ...headers },
    body: JSON.stringify({ reads }),
  });
}

test("dispatches only bounded My Day projections under one actor-resolution scope", async () => {
  actorScopes = 0;
  const dispatches: Request[] = [];
  const response = await readMyDayPage(request([
    "/api/attendance/today",
    "/api/work/assignments/mine?limit=4&status=all",
    "/api/leave/mine",
    "/api/availability/wfh/mine",
  ], { cookie: "nova-session=private" }), async (read) => {
    dispatches.push(read);
    return read.url.endsWith("attendance/today")
      ? Response.json({ error: "OFFICE_ASSIGNMENT_REQUIRED" }, { status: 409 })
      : Response.json({ ready: true });
  });

  expect(response.status).toBe(200);
  expect(actorScopes).toBe(1);
  expect(dispatches.map((read) => [read.method, new URL(read.url).pathname])).toEqual([
    ["GET", "/api/attendance/today"],
    ["GET", "/api/work/assignments/mine"],
    ["GET", "/api/leave/mine"],
    ["GET", "/api/availability/wfh/mine"],
  ]);
  expect(dispatches.every((read) => read.headers.get("cookie") === "nova-session=private")).toBe(true);
  const body = await response.json();
  expect(body.reads.map((item: { status: number }) => item.status)).toEqual([409, 200, 200, 200]);
  expect(body.reads[0].body).toEqual({ error: "OFFICE_ASSIGNMENT_REQUIRED" });
  expect(response.headers.get("server-timing")).toContain("nova-my-day-attendance;dur=");
  expect(response.headers.get("server-timing")).toContain("nova-my-day-wfh;dur=");
});

test("accepts only the six explicit read routes and approved query keys", async () => {
  const invalidPlans = [
    ["/api/attendance/check-in"],
    ["/api/admin/people"],
    ["/api/leave/mine?personId=other"],
    ["/api/work/assignments/mine?limit=4&status=all&organisationId=other"],
    ["/api/attendance/today", "/api/attendance/today"],
    Array.from({ length: 6 }, () => "/api/leave/mine?"),
  ];
  for (const reads of invalidPlans) {
    let dispatchCount = 0;
    const response = await readMyDayPage(request(reads), async () => {
      dispatchCount += 1;
      return Response.json({});
    });
    expect(response.status).toBe(400);
    expect(dispatchCount).toBe(0);
  }
});

test("promotes authentication failures and hides provider details when every read fails", async () => {
  const unauthorized = await readMyDayPage(request([
    "/api/leave/mine",
    "/api/availability/wfh/mine",
  ]), async (read) => read.url.endsWith("leave/mine")
    ? Response.json({ error: "AUTHENTICATION_REQUIRED" }, { status: 401 })
    : Response.json({ requests: [] }));
  expect(unauthorized.status).toBe(401);
  expect(await unauthorized.json()).toEqual({ error: "AUTHENTICATION_REQUIRED" });

  const unavailable = await readMyDayPage(request([
    "/api/leave/mine",
    "/api/availability/wfh/mine",
  ]), async () => {
    throw Object.assign(new Error("private database detail"), { code: "28P01" });
  });
  expect(unavailable.status).toBe(503);
  expect(await unavailable.json()).toEqual({ error: "SERVICE_UNAVAILABLE" });
});
