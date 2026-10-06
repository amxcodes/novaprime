import { hasAnyPermissionGrant, hasPermissionGrant, type EffectivePermissionRead } from "../../app-shell/permission-grants";

type OperationsPermissionRead = EffectivePermissionRead & { isSuperAdmin?: boolean };

export interface OperationsReadPlan {
  people: boolean;
  tasks: boolean;
  availability: boolean;
  reviews: boolean;
  recovery: boolean;
}

export interface OperationsAvailabilitySources {
  shifts: boolean;
  calendars: boolean;
  holidays: boolean;
}

const recoveryScopes = Object.freeze(["organisation", "own_record", "office", "organisation_department"]);

/** Plan each Operations report only when its existing endpoint can return a useful scoped result. */
export function planOperationsReads(
  read: OperationsPermissionRead | null | undefined,
): Readonly<OperationsReadPlan> {
  const none = { people: false, tasks: false, availability: false, reviews: false, recovery: false };
  if (read?.readError || !Array.isArray(read?.grants)) return Object.freeze(none);

  return Object.freeze({
    people: hasAnyPermissionGrant(read, ["people.view"], ["organisation", "office", "organisation_department"]),
    // The visible summary endpoint supports organization/client/workstream/group scopes;
    // assigned-work users stay on Work/Mine's purpose-limited projection.
    tasks: hasAnyPermissionGrant(read, ["tasks.view"], ["organisation", "client", "client_workstream", "group"]),
    // The composite endpoint projects each configuration source by its own grant.
    availability: hasAnyPermissionGrant(read, [
      "availability.calendar.view", "availability.calendar.manage",
      "availability.shift.view", "availability.shift.manage",
      "availability.holiday.view", "availability.holiday.manage",
    ], ["organisation"]),
    reviews: hasAnyPermissionGrant(read, ["tasks.review"], ["organisation", "client", "client_workstream", "group", "assigned_work"]),
    recovery: hasAnyPermissionGrant(read, ["attendance.recover"], recoveryScopes),
  });
}

export function canShowOperationsNavigation(
  read: OperationsPermissionRead | null | undefined,
): boolean {
  return Object.values(planOperationsReads(read)).some(Boolean);
}

/** Keep each availability subsection aligned with the source grants used by the API. */
export function planOperationsAvailabilitySources(
  read: OperationsPermissionRead | null | undefined,
): Readonly<OperationsAvailabilitySources> {
  if (read?.readError || !Array.isArray(read?.grants)) {
    return Object.freeze({ shifts: false, calendars: false, holidays: false });
  }
  return Object.freeze({
    shifts: hasPermissionGrant(read, "availability.shift.view") || hasPermissionGrant(read, "availability.shift.manage"),
    calendars: hasPermissionGrant(read, "availability.calendar.view") || hasPermissionGrant(read, "availability.calendar.manage"),
    holidays: hasPermissionGrant(read, "availability.holiday.view") || hasPermissionGrant(read, "availability.holiday.manage"),
  });
}
