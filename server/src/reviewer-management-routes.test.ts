import { afterEach, beforeEach, expect, test } from "bun:test";
import { handleRequest } from "./app.js";

const authEnvironmentKeys = ["BETTER_AUTH_SECRET", "BETTER_AUTH_URL", "DATABASE_URL"] as const;
const previousAuthEnvironment = new Map(authEnvironmentKeys.map((key) => [key, process.env[key]]));

beforeEach(() => {
  for (const key of authEnvironmentKeys) delete process.env[key];
});

afterEach(() => {
  for (const key of authEnvironmentKeys) {
    const value = previousAuthEnvironment.get(key);
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
});

test("routes reviewer-management reads through authenticated no-store handlers", async () => {
  const assignmentId = "00000000-0000-4000-8000-000000000001";
  const paths = [
    "/api/task-assignments/reviewer-management",
    `/api/task-assignments/${assignmentId}/reviewer-management`,
    `/api/task-assignments/${assignmentId}/reviewer-management/exception-candidates`,
  ];
  for (const path of paths) {
    const response = await handleRequest(new Request(`http://nova.test${path}`));
    expect(response.status).toBe(503);
    expect(response.headers.get("cache-control")).toBe("no-store");
  }

  for (const path of [
    "/api/task-assignments/not-a-uuid/reviewer-management",
    `/api/task-assignments/${assignmentId}/reviewer-management/extra`,
    `/api/task-assignments/${assignmentId}/reviewer-management/exception-candidates/extra`,
  ]) {
    expect((await handleRequest(new Request(`http://nova.test${path}`))).status).toBe(404);
  }

  expect((await handleRequest(new Request(
    `http://nova.test/api/task-assignments/${assignmentId}/reviewer-management`,
    { method: "POST", body: "{}" },
  ))).status).toBe(404);
});
