import type {
  AvailabilityCalendarRule,
  CreateAvailabilityCalendarRequest,
  CreateAvailabilityHolidayRequest,
  CreateAvailabilityShiftRequest,
} from "./admin-configuration-contracts";

export const AVAILABILITY_WEEKDAYS = [
  "Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday",
] as const;

export function acquireAvailabilityMutation(lock: { current: boolean }): boolean {
  if (lock.current) return false;
  lock.current = true;
  return true;
}

export function releaseAvailabilityMutation(lock: { current: boolean }): void {
  lock.current = false;
}

export interface ShiftDraft {
  name: string;
  startLocalTime: string;
  endLocalTime: string;
  breakStartLocalTime: string;
  breakEndLocalTime: string;
  graceMinutes: string;
  overtimeEnabled: boolean;
}

export interface CalendarRuleDraft {
  weekday: number;
  isWorking: boolean;
  shiftId: string;
}

export interface CalendarDraft {
  name: string;
  officeId: string;
  effectiveOn: string;
  rules: readonly CalendarRuleDraft[];
}

export interface HolidayDraft {
  name: string;
  date: string;
  officeId: string;
}

export function buildShiftRequest(draft: ShiftDraft): CreateAvailabilityShiftRequest | undefined {
  const name = draft.name.trim();
  const graceMinutes = Number(draft.graceMinutes);
  const hasBreakStart = Boolean(draft.breakStartLocalTime);
  const hasBreakEnd = Boolean(draft.breakEndLocalTime);
  const overnight = draft.endLocalTime < draft.startLocalTime;
  if (
    !name || !draft.startLocalTime || !draft.endLocalTime ||
    draft.startLocalTime === draft.endLocalTime ||
    !Number.isInteger(graceMinutes) || graceMinutes < 0 || graceMinutes > 720 ||
    hasBreakStart !== hasBreakEnd ||
    (overnight && hasBreakStart) ||
    (hasBreakStart && (
      draft.breakStartLocalTime < draft.startLocalTime ||
      draft.breakEndLocalTime <= draft.breakStartLocalTime ||
      draft.breakEndLocalTime > draft.endLocalTime
    ))
  ) return undefined;

  return {
    name,
    startLocalTime: draft.startLocalTime,
    endLocalTime: draft.endLocalTime,
    graceMinutes,
    overtimeEnabled: draft.overtimeEnabled,
    ...(hasBreakStart ? {
      breakStartLocalTime: draft.breakStartLocalTime,
      breakEndLocalTime: draft.breakEndLocalTime,
    } : {}),
  };
}

export function buildCalendarRequest(draft: CalendarDraft): CreateAvailabilityCalendarRequest | undefined {
  const name = draft.name.trim();
  if (!name || !draft.officeId || !isValidDate(draft.effectiveOn) || draft.rules.length !== 7) return undefined;
  const rules: AvailabilityCalendarRule[] = [];
  for (let weekday = 0; weekday < 7; weekday += 1) {
    const draftRule = draft.rules.find((rule) => rule.weekday === weekday);
    if (!draftRule || (draftRule.isWorking && !draftRule.shiftId)) return undefined;
    rules.push({
      weekday,
      ordinal: 0,
      isWorking: draftRule.isWorking,
      ...(draftRule.isWorking ? { shiftId: draftRule.shiftId } : {}),
    });
  }
  return { name, officeId: draft.officeId, effectiveOn: draft.effectiveOn, rules };
}

export function buildHolidayRequest(draft: HolidayDraft): CreateAvailabilityHolidayRequest | undefined {
  const name = draft.name.trim();
  if (!name || !draft.officeId || !isValidDate(draft.date)) return undefined;
  return { name, date: draft.date, officeId: draft.officeId };
}

export function defaultCalendarRules(): CalendarRuleDraft[] {
  return AVAILABILITY_WEEKDAYS.map((_, weekday) => ({ weekday, isWorking: weekday > 0 && weekday < 6, shiftId: "" }));
}

function isValidDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const [year, month, day] = value.split("-").map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day;
}
