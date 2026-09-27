import { expect, test } from "bun:test";
import { timestampInput } from "./timestamp-input.js";

test("preserves RFC 3339 microseconds and explicit offsets", () => {
  const utc = "2026-09-23T12:34:56.123456Z";
  const offset = "2026-09-23T18:04:56.123456+05:30";
  expect(timestampInput(utc)).toBe(utc);
  expect(timestampInput(offset)).toBe(offset);
});

test("accepts leap-day and rejects impossible dates and clock fields", () => {
  expect(timestampInput("2024-02-29T00:00:00Z")).toBe("2024-02-29T00:00:00Z");
  expect(timestampInput("2023-02-29T00:00:00Z")).toBeUndefined();
  expect(timestampInput("2024-02-30T00:00:00Z")).toBeUndefined();
  expect(timestampInput("2024-01-01T24:00:00Z")).toBeUndefined();
  expect(timestampInput("2024-01-01T23:60:00Z")).toBeUndefined();
});

test("requires a timezone and at most PostgreSQL's six fractional digits", () => {
  expect(timestampInput("2026-09-23T12:34:56.123Z")).toBe("2026-09-23T12:34:56.123Z");
  expect(timestampInput("2026-09-23T12:34:56.1234567Z")).toBeUndefined();
  expect(timestampInput("2026-09-23T12:34:56.123456")).toBeUndefined();
  expect(timestampInput("2026-09-23T12:34:56+14:01")).toBeUndefined();
  expect(timestampInput("2026-09-23T12:34:56+15:00")).toBeUndefined();
  expect(timestampInput(null)).toBeNull();
});
