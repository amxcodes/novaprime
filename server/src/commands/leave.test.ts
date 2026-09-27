import { expect, test } from "bun:test";
import { leaveRequestInput } from "./leave";

test("accepts full and half-day leave portions within the requested range", () => {
  expect(leaveRequestInput({
    leaveType: "annual",
    startDate: "2026-09-21",
    endDate: "2026-09-23",
    reason: "Personal time",
    days: [
      { date: "2026-09-21", portion: 1 },
      { date: "2026-09-22", portion: 0.5 },
      { date: "2026-09-23", portion: 1 },
    ],
  })).toEqual({
    leaveType: "annual",
    startDate: "2026-09-21",
    endDate: "2026-09-23",
    reason: "Personal time",
    days: [
      { date: "2026-09-21", portion: 1 },
      { date: "2026-09-22", portion: 0.5 },
      { date: "2026-09-23", portion: 1 },
    ],
  });
});

test("rejects invalid dates, portions, duplicate days, and empty ranges", () => {
  expect(leaveRequestInput({
    leaveType: "annual", startDate: "2026-09-23", endDate: "2026-09-21",
    days: [{ date: "2026-09-22", portion: 1 }],
  })).toBeUndefined();
  expect(leaveRequestInput({
    leaveType: "annual", startDate: "2026-09-21", endDate: "2026-09-21",
    days: [{ date: "2026-09-21", portion: 0.25 }],
  })).toBeUndefined();
  expect(leaveRequestInput({
    leaveType: "annual", startDate: "2026-09-21", endDate: "2026-09-22",
    days: [{ date: "2026-09-21", portion: 1 }, { date: "2026-09-21", portion: 1 }],
  })).toBeUndefined();
});
