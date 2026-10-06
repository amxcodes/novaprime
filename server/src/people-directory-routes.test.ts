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

test("routes the bounded directory and focused directory-record reads to authenticated handlers", async () => {
  for (const path of [
    "/api/people/directory?limit=25",
    "/api/people/00000000-0000-4000-8000-000000000001",
  ]) {
    const response = await handleRequest(new Request(`http://nova.test${path}`));
    expect(response.status).toBe(503);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(await response.json()).toEqual({ error: "AUTHENTICATION_CONFIGURATION_REQUIRED" });
  }
});

test("invalid or nested person-directory paths do not fall through to broad people reads", async () => {
  for (const path of [
    "/api/people/not-a-uuid",
    "/api/people/00000000-0000-4000-8000-000000000001/directory",
    "/api/people/directory/extra",
  ]) {
    expect((await handleRequest(new Request(`http://nova.test${path}`))).status).toBe(404);
  }

  expect((await handleRequest(new Request("http://nova.test/api/people"))).status).toBe(503);
});
