import { expect, test } from "bun:test";
import {
  canShowOperationsNavigation,
  planOperationsAvailabilitySources,
  planOperationsReads,
} from "./capabilities";

const none = { people: false, tasks: false, availability: false, reviews: false, recovery: false };

test("Operations report planning fails closed for unavailable or malformed grants", () => {
  expect(planOperationsReads(undefined)).toEqual(none);
  expect(planOperationsReads({ grants: null })).toEqual(none);
  expect(planOperationsReads({ grants: [], readError: "REQUEST_FAILED" })).toEqual(none);
  expect(canShowOperationsNavigation({ grants: [], readError: "PERMISSION_DENIED" })).toBe(false);
});

test("each Operations section follows its source endpoint's supported scopes", () => {
  expect(planOperationsReads({ grants: [
    { permissionKey: "people.invite", scope: "organisation" },
    { permissionKey: "tasks.create", scope: "organisation" },
    { permissionKey: "availability.calendar.view", scope: "organisation" },
  ] })).toEqual({ ...none, availability: true });

  expect(planOperationsReads({ grants: [
    { permissionKey: "people.view", scope: "office", officeId: "office-1" },
    { permissionKey: "tasks.view", scope: "assigned_work" },
    { permissionKey: "availability.calendar.manage", scope: "organisation" },
    { permissionKey: "tasks.review", scope: "client_workstream", clientWorkstreamId: "stream-1" },
    { permissionKey: "attendance.recover", scope: "own_record", selfApplicable: true },
  ] })).toEqual({ people: true, tasks: false, availability: true, reviews: true, recovery: true });

  expect(planOperationsReads({ grants: [
    { permissionKey: "people.view", scope: "own_record", selfApplicable: true },
    { permissionKey: "tasks.view", scope: "office", officeId: "office-1" },
    { permissionKey: "availability.holiday.view", scope: "client", clientId: "client-1" },
    { permissionKey: "tasks.review", scope: "own_record", selfApplicable: true },
    { permissionKey: "attendance.recover", scope: "group", groupId: "group-1" },
  ] })).toEqual(none);
});

test("Super Admin status does not replace ordinary Operations read grants", () => {
  expect(planOperationsReads({ isSuperAdmin: true, grants: [] })).toEqual(none);
  expect(canShowOperationsNavigation({ isSuperAdmin: true, grants: [] })).toBe(false);
  expect(planOperationsReads({ isSuperAdmin: true, grants: [
    { permissionKey: "tasks.view", scope: "organisation" },
  ] })).toEqual({ ...none, tasks: true });
});

test("Operations only shows availability subsections authorized by their exact source grants", () => {
  expect(planOperationsAvailabilitySources({ isSuperAdmin: true, grants: [] })).toEqual({
    shifts: false, calendars: false, holidays: false,
  });
  expect(planOperationsAvailabilitySources({ grants: [
    { permissionKey: "availability.calendar.manage", scope: "organisation" },
    { permissionKey: "availability.holiday.view", scope: "office", officeId: "office-1" },
    { permissionKey: "availability.shift.view", scope: "client", clientId: "client-1" },
  ] })).toEqual({ shifts: false, calendars: true, holidays: false });
});
