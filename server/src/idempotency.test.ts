import { expect, test } from "bun:test";
import { requestFingerprint, requestIdempotencyKey } from "./idempotency.js";

test("idempotency fingerprints ignore object key order", () => {
  expect(requestFingerprint({ title: "Task", dueDate: "2026-09-22" }))
    .toBe(requestFingerprint({ dueDate: "2026-09-22", title: "Task" }));
});

test("idempotency keys reject oversized headers", () => {
  expect(requestIdempotencyKey(new Request("http://localhost", {
    headers: { "Idempotency-Key": "x".repeat(201) },
  }))).toBe("INVALID");
});
