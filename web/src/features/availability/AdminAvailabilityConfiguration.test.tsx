import { describe, expect, it } from "bun:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { AdminAvailabilityConfiguration } from "./AdminAvailabilityConfiguration";
import type { AdminAvailabilityConfigurationProps } from "./admin-configuration-contracts";
import {
  acquireAvailabilityMutation,
  buildCalendarRequest,
  buildHolidayRequest,
  buildShiftRequest,
  defaultCalendarRules,
  releaseAvailabilityMutation,
} from "./admin-configuration-model";

const offices = { status: "ready", data: [{ id: "office-1", name: "Central office" }] } as const;
const shiftOption = { id: "shift-1", name: "Standard day" };
const shift = {
  id: "shift-1",
  name: "Standard day",
  startLocalTime: "09:30",
  endLocalTime: "18:30",
  breakStartLocalTime: "13:00",
  breakEndLocalTime: "14:00",
  graceMinutes: 10,
  overtimeEnabled: false,
  spansMidnight: false,
};

function props(overrides: Partial<AdminAvailabilityConfigurationProps> = {}): AdminAvailabilityConfigurationProps {
  return {
    shifts: { visible: true, canManage: false, read: { status: "ready", data: [shift] } },
    calendars: { visible: true, canManage: false, read: { status: "ready", data: [] } },
    holidays: { visible: true, canManage: false, read: { status: "ready", data: [] } },
    offices,
    shiftTargets: { visible: true, read: { status: "ready", data: [shiftOption] } },
    onCreateShift: async () => {},
    onCreateCalendar: async () => {},
    onCreateHoliday: async () => {},
    ...overrides,
  };
}

function markup(value: AdminAvailabilityConfigurationProps) {
  return renderToStaticMarkup(createElement(AdminAvailabilityConfiguration, value));
}

describe("Admin availability configuration access and read states", () => {
  it("renders each visible resource independently and exposes management only where granted", () => {
    const html = markup(props({
      shifts: { visible: true, canManage: true, read: { status: "error", message: "Shift read failed." } },
      calendars: { visible: true, canManage: false, read: { status: "ready", data: [{
        id: "calendar-1", name: "Central weekdays", office: offices.data[0], effectiveOn: "2026-10-01", rules: defaultCalendarRules(),
      }] } },
      holidays: { visible: false, canManage: false, read: { status: "ready", data: [] } },
    }));

    expect(html).toContain("Shift list unavailable");
    expect(html).toContain("Shift read failed.");
    expect(html).toContain("Create shift");
    expect(html).toContain("Central weekdays");
    expect(html).not.toContain("Add holiday");
    expect(html).not.toContain("Office holidays");
    expect(html).not.toContain("name=\"calendar-name\"");
  });

  it("shows a per-resource denial without leaking hidden resources", () => {
    const html = markup(props({
      shifts: { visible: false, canManage: false, read: { status: "ready", data: [shift] } },
      calendars: { visible: false, canManage: false, read: { status: "ready", data: [] } },
      holidays: { visible: true, canManage: false, read: { status: "denied", message: "Holiday access changed." } },
    }));
    expect(html).toContain("Holiday list unavailable");
    expect(html).toContain("Holiday access changed.");
    expect(html).not.toContain("Configured shifts");
    expect(html).not.toContain("Working calendars");
  });

  it("keeps office and shift target failures distinct and scopes each to calendar setup", () => {
    const html = markup(props({
      shifts: { visible: false, canManage: false, read: { status: "ready", data: [] } },
      calendars: { visible: true, canManage: true, read: { status: "ready", data: [] } },
      holidays: { visible: false, canManage: false, read: { status: "ready", data: [] } },
      offices: { status: "error", message: "Office lookup failed." },
      shiftTargets: { visible: true, read: { status: "denied", message: "Shift options were denied." } },
    }));
    expect(html).toContain("Office choices unavailable");
    expect(html).toContain("Office lookup failed.");
    expect(html).toContain("Shift choices unavailable");
    expect(html).toContain("Shift options were denied.");
    expect(html).not.toContain("Create calendar");
    expect(html).not.toContain("Office holidays");
  });

  it("provides labeled weekday selectors with a separate target source", () => {
    const html = markup(props({
      shifts: { visible: false, canManage: false, read: { status: "ready", data: [] } },
      calendars: { visible: true, canManage: true, read: { status: "ready", data: [] } },
      holidays: { visible: false, canManage: false, read: { status: "ready", data: [] } },
    }));
    expect(html).toContain("Shift for Monday");
    expect(html.match(/role="combobox"/g)?.length).toBe(8);
    expect(html.match(/>Working<\/span>/g)?.length).toBe(7);
    expect(Array.from(html.matchAll(/aria-label="([A-Z][a-z]+ is a working day)"/g), ([, label]) => label)).toEqual([
      "Sunday is a working day",
      "Monday is a working day",
      "Tuesday is a working day",
      "Wednesday is a working day",
      "Thursday is a working day",
      "Friday is a working day",
      "Saturday is a working day",
    ]);
    expect(html.match(/aria-required="true"/g)?.length).toBe(6);
    expect(html.match(/disabled=""/g)?.length).toBe(2);
    expect(html).not.toContain("<select");
  });

  it("uses searchable, required target controls and retains office names in FormData", () => {
    const html = markup(props({
      shifts: { visible: false, canManage: false, read: { status: "ready", data: [] } },
      calendars: { visible: true, canManage: true, read: { status: "ready", data: [] } },
      holidays: { visible: true, canManage: true, read: { status: "ready", data: [] } },
    }));

    expect(html.match(/role="combobox"/g)?.length).toBe(9);
    expect(html.match(/aria-required="true"/g)?.length).toBe(7);
    expect(html).toContain('name="officeId" value=""');
    expect(html).toContain('name="holiday-office" value=""');
    expect(html).toContain('placeholder="Choose office"');
    expect(html).not.toContain("<select");
  });

  it("leaves the calendar effective date blank until the administrator chooses one", () => {
    const html = markup(props({
      shifts: { visible: false, canManage: false, read: { status: "ready", data: [] } },
      calendars: { visible: true, canManage: true, read: { status: "ready", data: [] } },
      holidays: { visible: false, canManage: false, read: { status: "ready", data: [] } },
    }));
    expect(html).toMatch(/name="calendar-effective-on"[^>]*value=""/);
    expect(html).toContain("Effective from");
  });
});

describe("availability configuration request payloads", () => {
  it("rejects repeated submissions until the active mutation settles", () => {
    const lock = { current: false };
    expect(acquireAvailabilityMutation(lock)).toBe(true);
    expect(acquireAvailabilityMutation(lock)).toBe(false);
    releaseAvailabilityMutation(lock);
    expect(acquireAvailabilityMutation(lock)).toBe(true);
  });

  it("mirrors the shift endpoint DTO and omits empty break fields and inferred overnight flag", () => {
    expect(buildShiftRequest({
      name: "  Early shift ",
      startLocalTime: "22:00",
      endLocalTime: "06:00",
      breakStartLocalTime: "",
      breakEndLocalTime: "",
      graceMinutes: "5",
      overtimeEnabled: true,
    })).toEqual({
      name: "Early shift",
      startLocalTime: "22:00",
      endLocalTime: "06:00",
      graceMinutes: 5,
      overtimeEnabled: true,
    });
  });

  it("sends all seven calendar weekdays with ordinal zero and working-day shift IDs only", () => {
    const rules = defaultCalendarRules().map((rule) => rule.isWorking ? { ...rule, shiftId: "shift-1" } : rule);
    const request = buildCalendarRequest({
      name: "Weekday calendar",
      officeId: "office-1",
      effectiveOn: "2026-10-01",
      rules,
    });
    expect(request).toEqual({
      name: "Weekday calendar",
      officeId: "office-1",
      effectiveOn: "2026-10-01",
      rules: [
        { weekday: 0, ordinal: 0, isWorking: false },
        { weekday: 1, ordinal: 0, isWorking: true, shiftId: "shift-1" },
        { weekday: 2, ordinal: 0, isWorking: true, shiftId: "shift-1" },
        { weekday: 3, ordinal: 0, isWorking: true, shiftId: "shift-1" },
        { weekday: 4, ordinal: 0, isWorking: true, shiftId: "shift-1" },
        { weekday: 5, ordinal: 0, isWorking: true, shiftId: "shift-1" },
        { weekday: 6, ordinal: 0, isWorking: false },
      ],
    });
    expect(buildCalendarRequest({ name: "bad", officeId: "office-1", effectiveOn: "2026-10-01", rules: defaultCalendarRules() })).toBeUndefined();
  });

  it("mirrors the holiday endpoint DTO and validates real dates", () => {
    expect(buildHolidayRequest({ name: "Founders day", date: "2026-10-01", officeId: "office-1" })).toEqual({
      name: "Founders day", date: "2026-10-01", officeId: "office-1",
    });
    expect(buildHolidayRequest({ name: "Bad date", date: "2026-02-30", officeId: "office-1" })).toBeUndefined();
  });

  it("uses semantic responsive tokens rather than fixed palette values", async () => {
    const css = await Bun.file(new URL("./AdminAvailabilityConfiguration.module.css", import.meta.url)).text();
    expect(css).toContain("@container availability-config (max-width: 39.999rem)");
    expect(css).toContain("@container availability-config (min-width: 40rem) and (max-width: 63.999rem)");
    expect(css).toContain("container: availability-panel / inline-size");
    expect(css).toContain("@container availability-panel (max-width: 23.999rem)");
    expect(css).toContain("@container availability-panel (max-width: 25.999rem)");
    expect(css).toContain(".shiftFields,\n  .holidayFields { grid-template-columns: minmax(0, 1fr); }");
    expect(css).toContain(".weekRow {\n    grid-template-columns: minmax(0, 1fr);");
    expect(css).toContain('.weekRow :global(input[role="combobox"]) { width: 100%; }');
    expect(css).toContain("var(--nova-control-touch-target)");
    expect(css).toContain("var(--nova-color-surface)");
    expect(css).toContain('input[role="combobox"]');
    expect(css).not.toMatch(/#[0-9a-f]{3,8}\b/i);
  });
});
