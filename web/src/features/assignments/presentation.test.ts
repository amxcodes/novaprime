import { expect, test } from "bun:test";
import { formatAssignmentDueDate, getAssignmentStatus } from "./presentation";

test("assignment statuses use clear labels and safe neutral fallback", () => {
  expect(getAssignmentStatus("in_progress")).toEqual({ label: "In progress", tone: "info" });
  expect(getAssignmentStatus("awaiting_review")).toEqual({ label: "Awaiting review", tone: "warning" });
  expect(getAssignmentStatus("new_server_state")).toEqual({ label: "new server state", tone: "neutral" });
});

test("date-only deadlines stay on their calendar day and malformed dates stay legible", () => {
  expect(formatAssignmentDueDate("2026-10-03")).toContain("2026");
  expect(formatAssignmentDueDate("2026-02-31")).toBe("2026-02-31");
  expect(formatAssignmentDueDate(null)).toBeNull();
});
