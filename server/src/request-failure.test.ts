import { expect, test } from "bun:test";
import { requestFailureStatus } from "./request-failure.js";

test.each(["08006", "28P01", "53300", "57P03"])(
  "maps database dependency failure %s to service unavailable",
  (code) => {
    expect(requestFailureStatus({ code })).toBe(503);
  },
);

test("keeps application and unknown failures as internal errors", () => {
  expect(requestFailureStatus({ code: "23505" })).toBe(500);
  expect(requestFailureStatus(new Error("unexpected failure"))).toBe(500);
});
