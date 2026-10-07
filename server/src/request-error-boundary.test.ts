import { afterEach, beforeEach, expect, mock, test } from "bun:test";

mock.module("./auth.js", () => ({
  auth: {
    handler: async (request: Request) => {
      if (new URL(request.url).searchParams.has("unknown-failure")) {
        throw new Error("unexpected internal failure");
      }
      throw Object.assign(new Error("database password must not reach the caller"), { code: "28P01" });
    },
  },
}));

const previousEnvironment = new Map(
  ["BETTER_AUTH_SECRET", "BETTER_AUTH_URL", "DATABASE_URL"].map((key) => [key, process.env[key]]),
);
process.env.BETTER_AUTH_SECRET = "test-secret-which-is-long-enough-for-better-auth";
process.env.BETTER_AUTH_URL = "https://nova.test";
process.env.DATABASE_URL = "postgres://nova_app:private@127.0.0.1/nova";

const { handleRequest } = await import("./app.js");

beforeEach(() => {
  process.env.BETTER_AUTH_SECRET = "test-secret-which-is-long-enough-for-better-auth";
  process.env.BETTER_AUTH_URL = "https://nova.test";
  process.env.DATABASE_URL = "postgres://nova_app:private@127.0.0.1/nova";
});

afterEach(() => {
  for (const [key, value] of previousEnvironment) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
});

test("database authentication failures return service unavailable and log only the safe code", async () => {
  const previousConsoleError = console.error;
  const logEntries: string[] = [];
  console.error = (...values) => logEntries.push(values.join(" "));
  try {
    const response = await handleRequest(new Request("https://nova.test/api/auth/get-session"));

    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({ error: "SERVICE_UNAVAILABLE" });
    expect(response.headers.get("server-timing")).toMatch(/^nova-app;dur=\d+(?:\.\d+)?$/);
    expect(logEntries.join(" ")).toContain("28P01");
    expect(logEntries.join(" ")).not.toContain("database password");
  } finally {
    console.error = previousConsoleError;
  }
});

test("unexpected auth failures remain internal errors", async () => {
  const response = await handleRequest(new Request("https://nova.test/api/auth/get-session?unknown-failure=1"));

  expect(response.status).toBe(500);
  expect(await response.json()).toEqual({ error: "INTERNAL_ERROR" });
});
