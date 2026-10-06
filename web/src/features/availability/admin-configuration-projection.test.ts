import { describe, expect, it } from "bun:test";
import { projectAvailabilityConfigurationProps } from "./admin-configuration-projection";
import type { AvailabilityConfigurationProjectionInput } from "./admin-configuration-projection";

const rule = { weekday: 1, ordinal: 1, isWorking: true, shiftId: "shift-1", privateRuleNote: "omit" };
const availability = {
  visibility: { shifts: true, shiftOptions: true, calendars: true, holidays: true },
  shifts: [{
    id: "shift-1", name: "Standard", startLocalTime: "09:30", endLocalTime: "18:30",
    breakStartLocalTime: null, breakEndLocalTime: null, graceMinutes: 5,
    overtimeEnabled: false, spansMidnight: false, payrollCode: "omit",
  }],
  shiftOptions: [{ id: "shift-1", name: "Standard", internalNote: "omit" }],
  calendars: [{
    id: "calendar-1", name: "Weekdays", office: { id: "office-1", name: "Central", address: "omit" },
    effectiveOn: "2026-10-01", rules: [rule], internalVersion: 8,
  }],
  holidays: [{
    id: "holiday-1", name: "Foundation day", date: "2026-10-02",
    office: { id: "office-1", name: "Central", address: "omit" }, privateNote: "omit",
  }],
};

function input(overrides: Partial<AvailabilityConfigurationProjectionInput> = {}): AvailabilityConfigurationProjectionInput {
  return {
    availability,
    offices: { offices: [{ id: "office-1", name: "Central", address: "omit" }] },
    canReadOffices: true,
    capabilities: {
      shifts: { view: true, manage: false },
      calendars: { view: true, manage: false },
      holidays: { view: true, manage: false },
      shiftTargets: true,
    },
    onCreateShift: async () => {},
    onCreateCalendar: async () => {},
    onCreateHoliday: async () => {},
    ...overrides,
  };
}

describe("Availability configuration projection", () => {
  it("projects allowlisted fields from each authorized resource and selector read", () => {
    const props = projectAvailabilityConfigurationProps(input());
    expect(props.shifts.read).toEqual({ status: "ready", data: [{
      id: "shift-1", name: "Standard", startLocalTime: "09:30", endLocalTime: "18:30",
      breakStartLocalTime: null, breakEndLocalTime: null, graceMinutes: 5,
      overtimeEnabled: false, spansMidnight: false,
    }] });
    expect(props.calendars.read).toEqual({ status: "ready", data: [{
      id: "calendar-1", name: "Weekdays", office: { id: "office-1", name: "Central" },
      effectiveOn: "2026-10-01", rules: [{ weekday: 1, ordinal: 1, isWorking: true, shiftId: "shift-1" }],
    }] });
    expect(props.holidays.read).toEqual({ status: "ready", data: [{
      id: "holiday-1", name: "Foundation day", date: "2026-10-02",
      office: { id: "office-1", name: "Central" },
    }] });
    expect(props.offices).toEqual({ status: "ready", data: [{ id: "office-1", name: "Central" }] });
    expect(JSON.stringify(props)).not.toContain("omit");
  });

  it("fails closed when server visibility conflicts with effective feature capabilities", () => {
    const props = projectAvailabilityConfigurationProps(input({
      capabilities: {
        shifts: { view: false, manage: false },
        calendars: { view: false, manage: false },
        holidays: { view: false, manage: false },
        shiftTargets: false,
      },
    }));
    expect(props.shifts.visible).toBe(false);
    expect(props.calendars.visible).toBe(false);
    expect(props.holidays.visible).toBe(false);
    expect(props.shiftTargets.visible).toBe(false);
    expect(props.shifts.read).toEqual({ status: "ready", data: [] });
    expect(props.shiftTargets.read).toEqual({ status: "ready", data: [] });
  });

  it("keeps management and calendar shift-target capabilities distinct", () => {
    const props = projectAvailabilityConfigurationProps(input({
      capabilities: {
        shifts: { view: false, manage: false },
        calendars: { view: false, manage: true },
        holidays: { view: false, manage: false },
        shiftTargets: true,
      },
    }));
    expect(props.shifts.visible).toBe(false);
    expect(props.shifts.canManage).toBe(false);
    expect(props.calendars.visible).toBe(true);
    expect(props.calendars.canManage).toBe(true);
    expect(props.shiftTargets.visible).toBe(true);
    expect(props.shiftTargets.read.status).toBe("ready");
  });

  it("preserves the separately protected office target failure for calendar and holiday managers", () => {
    const props = projectAvailabilityConfigurationProps(input({
      canReadOffices: false,
      officesIssue: { message: "Offices require organization settings access." },
    }));
    expect(props.offices).toEqual({ status: "denied", message: "Offices require organization settings access." });
  });

  it("marks malformed resource and nested rule responses unavailable instead of passing partial rows", () => {
    const malformed = projectAvailabilityConfigurationProps(input({
      availability: { ...availability, calendars: [{ ...availability.calendars[0], rules: [{ ...rule, weekday: "Monday" }] }] },
    }));
    expect(malformed.calendars.read.status).toBe("error");
    if (malformed.calendars.read.status === "ready") throw new Error("malformed calendar unexpectedly passed projection");
    expect(malformed.calendars.read.message).toContain("response could not be read");

    const denied = projectAvailabilityConfigurationProps(input({
      availability: { ...availability, readError: "PERMISSION_DENIED" },
      availabilityIssue: { message: "Availability access changed." },
    }));
    expect(denied.shifts.read).toEqual({ status: "denied", message: "Availability access changed." });
  });
});
