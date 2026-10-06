import { expect, test } from "bun:test";
import { canShowAvailabilityNavigation, planAvailabilityAgendaReads } from "./capabilities";

const none = { schedule: false, holidays: false, attendance: false, leave: false, wfh: false };

test("availability agenda capabilities fail closed for missing, malformed, or failed grant reads", () => {
  expect(planAvailabilityAgendaReads(undefined)).toEqual(none);
  expect(planAvailabilityAgendaReads({ grants: null })).toEqual(none);
  expect(planAvailabilityAgendaReads({ grants: [], readError: "REQUEST_FAILED" })).toEqual(none);
  expect(canShowAvailabilityNavigation({ grants: [], readError: "PERMISSION_DENIED" })).toBe(false);
});

test("schedule requires both calendar and shift view, while each other source is independent", () => {
  expect(planAvailabilityAgendaReads({ grants: [
    { permissionKey: "availability.calendar.view", scope: "organisation" },
  ] })).toEqual(none);

  expect(planAvailabilityAgendaReads({ grants: [
    { permissionKey: "availability.calendar.view", scope: "organisation" },
    { permissionKey: "availability.shift.view", scope: "organisation" },
    { permissionKey: "availability.holiday.view", scope: "organisation" },
    { permissionKey: "attendance.view", scope: "office", officeId: "office-1" },
    { permissionKey: "leave.review", scope: "organisation_department", organisationDepartmentId: "department-1" },
    { permissionKey: "availability.wfh.request", scope: "own_record", selfApplicable: true },
  ] })).toEqual({ schedule: true, holidays: true, attendance: true, leave: true, wfh: true });
});

test("out-of-scope grants do not expose sources and Super Admin status does not imply route grants", () => {
  expect(planAvailabilityAgendaReads({ grants: [
    { permissionKey: "attendance.view", scope: "group", groupId: "group-1" },
    { permissionKey: "leave.request", scope: "client", clientId: "client-1" },
    { permissionKey: "availability.wfh.review", scope: "assigned_work" },
  ] })).toEqual(none);
  expect(planAvailabilityAgendaReads({ isSuperAdmin: true, grants: [] })).toEqual(none);
  expect(canShowAvailabilityNavigation({ isSuperAdmin: true, grants: [] })).toBe(false);
});
