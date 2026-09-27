import { expect, test } from "bun:test";
import { EventEmitter } from "node:events";
import { databaseRequestContext, observeIdleDatabaseErrors } from "./db";

test("accepts only UUID values for trusted database request context", () => {
  expect(
    databaseRequestContext(
      "66a5d042-d0f4-4ca8-aec9-c08bc92d9244",
      "d77e0fcb-6c3f-4c78-a955-906750f3d58b",
    ),
  ).toEqual({
    userId: "66a5d042-d0f4-4ca8-aec9-c08bc92d9244",
    organisationId: "d77e0fcb-6c3f-4c78-a955-906750f3d58b",
  });
});

test("rejects request context that could not have come from a resolved actor", () => {
  expect(() => databaseRequestContext("not-a-user", "not-an-organisation")).toThrow(
    "DATABASE_REQUEST_CONTEXT_INVALID",
  );
});

test("handles PostgreSQL idle-connection errors without an uncaught pool error", () => {
  const pool = new EventEmitter();
  const reports: unknown[][] = [];
  const originalError = console.error;
  console.error = (...values: unknown[]) => reports.push(values);
  try {
    observeIdleDatabaseErrors(pool);
    pool.emit("error", Object.assign(new Error("database restarted"), { code: "57P01" }));
    expect(reports).toEqual([["NOVA_DATABASE_IDLE_CONNECTION_ERROR", "57P01"]]);
  } finally {
    console.error = originalError;
  }
});
