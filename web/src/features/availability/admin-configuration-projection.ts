import type {
  AdminAvailabilityConfigurationProps,
  AvailabilityCalendar,
  AvailabilityCalendarRule,
  AvailabilityHoliday,
  AvailabilityOfficeOption,
  AvailabilityReadState,
  AvailabilityShift,
  AvailabilityShiftOption,
} from "./admin-configuration-contracts";

interface ReadIssue {
  message: string;
}

/** Raw route reads and host-computed capabilities accepted only at this boundary. */
export interface AvailabilityConfigurationProjectionInput {
  availability: unknown;
  availabilityIssue?: ReadIssue | null;
  offices: unknown;
  officesIssue?: ReadIssue | null;
  canReadOffices: boolean;
  capabilities: Readonly<{
    shifts: Readonly<{ view: boolean; manage: boolean }>;
    calendars: Readonly<{ view: boolean; manage: boolean }>;
    holidays: Readonly<{ view: boolean; manage: boolean }>;
    shiftTargets: boolean;
  }>;
  onCreateShift: AdminAvailabilityConfigurationProps["onCreateShift"];
  onCreateCalendar: AdminAvailabilityConfigurationProps["onCreateCalendar"];
  onCreateHoliday: AdminAvailabilityConfigurationProps["onCreateHoliday"];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function nonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function nullableString(value: unknown): value is string | null {
  return value === null || typeof value === "string";
}

function finiteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function readFailure(input: unknown, issue: ReadIssue | null | undefined, resource: string): AvailabilityReadState<never> | null {
  const code = isRecord(input) && typeof input.readError === "string" ? input.readError : null;
  if (!code && !issue) return null;
  const status = code === "PERMISSION_DENIED" || code === "PREREQUISITE_PERMISSION_REQUIRED" ? "denied" : "error";
  return {
    status,
    message: issue?.message || `Could not load ${resource}. Refresh Admin to try again.`,
  };
}

function projectRows<T>(
  input: unknown,
  issue: ReadIssue | null | undefined,
  key: string,
  resource: string,
  project: (row: unknown) => T | null,
): AvailabilityReadState<T> {
  const failure = readFailure(input, issue, resource);
  if (failure) return failure;
  if (isRecord(input) && input.readState === "loading") {
    return { status: "error", message: `${resource} are still loading. Refresh Admin to try again.` };
  }
  if (!isRecord(input) || !Array.isArray(input[key])) {
    return { status: "error", message: `The ${resource} response could not be read. Refresh Admin to try again.` };
  }
  const rows = input[key].map(project);
  if (rows.some((row) => row === null)) {
    return { status: "error", message: `The ${resource} response could not be read. Refresh Admin to try again.` };
  }
  return { status: "ready", data: rows as T[] };
}

function projectOffice(value: unknown): AvailabilityOfficeOption | null {
  if (!isRecord(value) || !nonEmptyString(value.id) || !nonEmptyString(value.name)) return null;
  return { id: value.id, name: value.name };
}

function projectShift(value: unknown): AvailabilityShift | null {
  if (!isRecord(value) || !nonEmptyString(value.id) || !nonEmptyString(value.name) ||
      !nonEmptyString(value.startLocalTime) || !nonEmptyString(value.endLocalTime) ||
      !nullableString(value.breakStartLocalTime) || !nullableString(value.breakEndLocalTime) ||
      !finiteNumber(value.graceMinutes) || value.graceMinutes < 0 ||
      typeof value.overtimeEnabled !== "boolean" || typeof value.spansMidnight !== "boolean") return null;
  return {
    id: value.id,
    name: value.name,
    startLocalTime: value.startLocalTime,
    endLocalTime: value.endLocalTime,
    breakStartLocalTime: value.breakStartLocalTime,
    breakEndLocalTime: value.breakEndLocalTime,
    graceMinutes: value.graceMinutes,
    overtimeEnabled: value.overtimeEnabled,
    spansMidnight: value.spansMidnight,
  };
}

function projectShiftOption(value: unknown): AvailabilityShiftOption | null {
  if (!isRecord(value) || !nonEmptyString(value.id) || !nonEmptyString(value.name)) return null;
  return { id: value.id, name: value.name };
}

function projectRule(value: unknown): AvailabilityCalendarRule | null {
  if (!isRecord(value) || !Number.isInteger(value.weekday) || !Number.isInteger(value.ordinal) ||
      typeof value.isWorking !== "boolean" || !(value.shiftId === undefined || value.shiftId === null || typeof value.shiftId === "string")) return null;
  return {
    weekday: value.weekday as number,
    ordinal: value.ordinal as number,
    isWorking: value.isWorking,
    ...(nonEmptyString(value.shiftId) ? { shiftId: value.shiftId } : {}),
  };
}

function projectCalendar(value: unknown): AvailabilityCalendar | null {
  if (!isRecord(value) || !nonEmptyString(value.id) || !nonEmptyString(value.name) ||
      !nonEmptyString(value.effectiveOn) || !Array.isArray(value.rules)) return null;
  const office = projectOffice(value.office);
  const rules = value.rules.map(projectRule);
  if (!office || rules.some((rule) => rule === null)) return null;
  return {
    id: value.id,
    name: value.name,
    office,
    effectiveOn: value.effectiveOn,
    rules: rules as AvailabilityCalendarRule[],
  };
}

function projectHoliday(value: unknown): AvailabilityHoliday | null {
  if (!isRecord(value) || !nonEmptyString(value.id) || !nonEmptyString(value.date) || !nonEmptyString(value.name)) return null;
  const office = projectOffice(value.office);
  return office ? { id: value.id, office, date: value.date, name: value.name } : null;
}

function serverVisible(input: unknown, key: string, fallback: boolean): boolean {
  if (!fallback) return false;
  if (!isRecord(input) || !isRecord(input.visibility) || typeof input.visibility[key] !== "boolean") return true;
  return input.visibility[key] as boolean;
}

/** Convert route reads to allowlisted, per-grant feature props. Hidden collections carry no rows. */
export function projectAvailabilityConfigurationProps(
  input: AvailabilityConfigurationProjectionInput,
): AdminAvailabilityConfigurationProps {
  const availability = input.availability;
  const resource = <T,>(key: string, label: string, view: boolean, manage: boolean, project: (row: unknown) => T | null) => {
    const visible = serverVisible(availability, key, view || manage);
    return {
      visible,
      canManage: manage,
      read: visible
        ? projectRows(availability, input.availabilityIssue, key, label, project)
        : { status: "ready" as const, data: [] as T[] },
    };
  };
  const shiftTargetsVisible = serverVisible(
    availability,
    "shiftOptions",
    input.capabilities.shiftTargets,
  );

  return {
    shifts: resource("shifts", "availability shifts", input.capabilities.shifts.view, input.capabilities.shifts.manage, projectShift),
    calendars: resource("calendars", "working calendars", input.capabilities.calendars.view, input.capabilities.calendars.manage, projectCalendar),
    holidays: resource("holidays", "office holidays", input.capabilities.holidays.view, input.capabilities.holidays.manage, projectHoliday),
    offices: input.canReadOffices
      ? projectRows(input.offices, input.officesIssue, "offices", "offices for availability configuration", projectOffice)
      : {
        status: "denied",
        message: input.officesIssue?.message || "Office choices are unavailable under your current access.",
      },
    shiftTargets: {
      visible: shiftTargetsVisible,
      read: shiftTargetsVisible
        ? projectRows(availability, input.availabilityIssue, "shiftOptions", "shift targets for working calendar setup", projectShiftOption)
        : { status: "ready", data: [] },
    },
    onCreateShift: input.onCreateShift,
    onCreateCalendar: input.onCreateCalendar,
    onCreateHoliday: input.onCreateHoliday,
  };
}
