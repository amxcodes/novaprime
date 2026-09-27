import { expect, test } from "bun:test";
import { validClientAccessDate } from "./client-access";
import { validTimelineDate } from "./timeline";
import { validTaskDueDate } from "./work-context";

test("date-bearing read and membership inputs reject impossible calendar dates", () => {
  expect(validTimelineDate("2026-02-28")).toBe(true);
  expect(validTimelineDate("2026-02-30")).toBe(false);
  expect(validClientAccessDate("2024-02-29")).toBe(true);
  expect(validClientAccessDate("2025-02-29")).toBe(false);
  expect(validTaskDueDate("2026-04-30")).toBe(true);
  expect(validTaskDueDate("2026-04-31")).toBe(false);
  expect(validTaskDueDate("2024-02-29")).toBe(true);
  expect(validTaskDueDate("2000-02-29")).toBe(true);
  expect(validTaskDueDate("1900-02-29")).toBe(false);
  expect(validTaskDueDate("2100-02-29")).toBe(false);
  expect(validTaskDueDate("0001-01-01")).toBe(true);
  expect(validTaskDueDate("0000-01-01")).toBe(false);
});
