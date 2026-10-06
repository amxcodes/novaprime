import { describe, expect, it } from "bun:test";
import { buildAvailabilityExportRows } from "./availability-export";
import type { OperationsAvailability } from "./contracts";

const availability: OperationsAvailability = {
  shifts: [{ name: "Day shift", startLocalTime: "09:00", endLocalTime: "17:30" }],
  calendars: [{
    name: "HQ working week",
    office: { name: "Head office" },
    effectiveOn: "2026-10-01",
    rules: [{ weekday: 1, ordinal: 0, isWorking: true, shiftId: "shift-1" }],
  }],
  holidays: [{ date: "2026-12-25", name: "Winter holiday", office: { name: "Head office" } }],
};
const expectedCalendarRules = '[{"weekday":1,"ordinal":0,"isWorking":true,"shiftId":"shift-1"}]';

describe("buildAvailabilityExportRows", () => {
  it("includes shifts only when the shift source is granted", () => {
    expect(buildAvailabilityExportRows(availability, {
      shifts: true,
      calendars: false,
      holidays: false,
    })).toEqual([
      ["shift", "", "Day shift", "", "", "09:00", "17:30", ""],
    ]);
  });

  it("includes calendars only when the calendar source is granted", () => {
    expect(buildAvailabilityExportRows(availability, {
      shifts: false,
      calendars: true,
      holidays: false,
    })).toEqual([
      ["calendar", "", "HQ working week", "Head office", "2026-10-01", "", "", expectedCalendarRules],
    ]);
  });

  it("includes holidays only when the holiday source is granted", () => {
    expect(buildAvailabilityExportRows(availability, {
      shifts: false,
      calendars: false,
      holidays: true,
    })).toEqual([
      ["holiday", "2026-12-25", "Winter holiday", "Head office", "", "", "", ""],
    ]);
  });

  it("fails closed when a source grant is absent and preserves grouped row order", () => {
    expect(buildAvailabilityExportRows(availability, undefined)).toEqual([]);
    expect(buildAvailabilityExportRows(availability, {
      shifts: true,
      calendars: true,
      holidays: true,
    })).toEqual([
      ["shift", "", "Day shift", "", "", "09:00", "17:30", ""],
      ["calendar", "", "HQ working week", "Head office", "2026-10-01", "", "", expectedCalendarRules],
      ["holiday", "2026-12-25", "Winter holiday", "Head office", "", "", "", ""],
    ]);
  });
});
