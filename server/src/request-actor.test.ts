import { expect, mock, test } from "bun:test";

let sessionReads = 0;
let actorReads = 0;

mock.module("./authentication-session.js", () => ({
  authenticationSession: async (request: Request) => {
    sessionReads += 1;
    return {
      identitySubject: request.headers.get("x-test-identity") ?? "person-a",
      email: "person@example.test",
      emailVerified: true,
      displayName: "Person",
    };
  },
}));
mock.module("./db.js", () => ({
  database: () => ({
    query: async (_sql: string, values: unknown[]) => {
      actorReads += 1;
      return { rows: [{ user_id: "00000000-0000-4000-8000-000000000001", organisation_id: "00000000-0000-4000-8000-000000000002", status: "active" }] };
    },
  }),
  databaseRequestContext: (userId: string, organisationId: string) => ({ userId, organisationId }),
}));

const { requestActor, withRequestActorResolutionCache } = await import("./request-actor.js");

function authenticatedRequest(cookie: string, identity = "person-a"): Request {
  return new Request("https://nova.test/api/work-context", {
    headers: { cookie, "x-test-identity": identity },
  });
}

test("shares session and actor resolution only for the same identity in one explicit request scope", async () => {
  sessionReads = 0;
  actorReads = 0;

  await withRequestActorResolutionCache(() => Promise.all([
    requestActor(authenticatedRequest("session=a")),
    requestActor(authenticatedRequest("session=a")),
    requestActor(authenticatedRequest("session=a")),
  ]).then(() => undefined));
  expect(sessionReads).toBe(1);
  expect(actorReads).toBe(1);

  await withRequestActorResolutionCache(() => Promise.all([
    requestActor(authenticatedRequest("session=a")),
    requestActor(authenticatedRequest("session=b", "person-b")),
    requestActor(authenticatedRequest("session=a")),
  ]).then(() => undefined));
  expect(sessionReads).toBe(3);
  expect(actorReads).toBe(3);

  await Promise.all([
    requestActor(authenticatedRequest("session=a")),
    requestActor(authenticatedRequest("session=a")),
  ]);
  expect(sessionReads).toBe(5);
  expect(actorReads).toBe(5);
});
