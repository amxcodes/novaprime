import { hasAnyPermissionGrant, hasPermissionGrant, type EffectivePermissionRead } from "../../app-shell/permission-grants";

type AvailabilityPermissionRead = EffectivePermissionRead & { isSuperAdmin?: boolean };

const availabilityScopes = Object.freeze(["organisation", "own_record", "office", "organisation_department"]);

/** Date-bounded agenda sources; each event family retains its own permission. */
export function planAvailabilityAgendaReads(
  read: AvailabilityPermissionRead | null | undefined,
) {
  const none = { schedule: false, holidays: false, attendance: false, leave: false, wfh: false };
  if (read?.readError || !Array.isArray(read?.grants)) return Object.freeze(none);
  return Object.freeze({
    schedule: hasPermissionGrant(read, "availability.calendar.view") && hasPermissionGrant(read, "availability.shift.view"),
    holidays: hasPermissionGrant(read, "availability.holiday.view"),
    attendance: hasAnyPermissionGrant(read, ["attendance.view"], availabilityScopes),
    leave: hasAnyPermissionGrant(read, ["leave.request", "leave.review"], availabilityScopes),
    wfh: hasAnyPermissionGrant(read, ["availability.wfh.request", "availability.wfh.review"], availabilityScopes),
  });
}

export function canShowAvailabilityNavigation(
  read: AvailabilityPermissionRead | null | undefined,
): boolean {
  return Object.values(planAvailabilityAgendaReads(read)).some(Boolean);
}
