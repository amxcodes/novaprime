import { expect, test } from "bun:test";
import {
  adminReadIssue,
  adminPermissionNoticeMessage,
  canCreateOffice,
  canShowAdminFeature,
  canShowAdminNavigation,
  canShowInviteNavigation,
  canShowPeopleNavigation,
  canShowWorkContextGroup,
  canShowWorkNavigation,
  canShowWorkSetupNavigation,
  canViewAuthHandoffs,
  hasAnyPermissionGrant,
  hasPermissionGrant,
  planAdminReads,
  planAvailabilityAgendaReads,
  planMyDayReads,
  planOperationsReads,
  planTodayFeatures,
  planWorkReads,
  planWorkSetupReads,
  readOrError,
  skippedAdminRead,
} from "../web/admin-read-state.js";

test("Operations plans each dashboard read only from its endpoint's read permission", () => {
  const none = { people: false, tasks: false, availability: false, reviews: false, recovery: false };
  expect(planOperationsReads(undefined)).toEqual(none);
  expect(planOperationsReads({ grants: [], readError: "REQUEST_FAILED" })).toEqual(none);
  expect(planOperationsReads({ actorPersonId: "p1", grants: [
    { permissionKey: "people.invite", scope: "organisation" },
    { permissionKey: "tasks.create", scope: "organisation" },
    { permissionKey: "availability.holiday.view", scope: "organisation" },
  ] })).toEqual({ ...none, availability: true });
  expect(planOperationsReads({ actorPersonId: "p1", grants: [
    { permissionKey: "people.view", scope: "office", officeId: "office-1" },
    { permissionKey: "tasks.view", scope: "assigned_work" },
    { permissionKey: "availability.calendar.view", scope: "organisation" },
    { permissionKey: "tasks.review", scope: "client_workstream", clientWorkstreamId: "stream-1" },
  ] })).toEqual({ people: true, tasks: false, availability: true, reviews: true, recovery: false });
  expect(planOperationsReads({ actorPersonId: "p1", grants: [
    { permissionKey: "people.view", scope: "own_record" },
    { permissionKey: "tasks.review", scope: "own_record" },
    { permissionKey: "availability.calendar.view", scope: "office", officeId: "office-1" },
  ] })).toEqual(none);
  expect(planOperationsReads({ actorPersonId: "p1", grants: [
    { permissionKey: "tasks.view", scope: "assigned_work" },
  ] })).toEqual(none);
  expect(planOperationsReads({ actorPersonId: "p1", grants: [
    { permissionKey: "tasks.view", scope: "group", groupId: "group-1" },
  ] })).toMatchObject({ tasks: true });
});

test("availability agenda keeps every event family behind its own effective grant", () => {
  const none = { schedule: false, holidays: false, attendance: false, leave: false, wfh: false };
  expect(planAvailabilityAgendaReads(undefined)).toEqual(none);
  expect(planAvailabilityAgendaReads({ grants: [{ permissionKey: "availability.calendar.view", scope: "organisation" }] }))
    .toEqual(none);
  expect(planAvailabilityAgendaReads({ isSuperAdmin: true, grants: [] })).toEqual(none);
  expect(planAvailabilityAgendaReads({ grants: [
    { permissionKey: "availability.calendar.view", scope: "organisation" },
    { permissionKey: "availability.shift.view", scope: "organisation" },
    { permissionKey: "availability.holiday.view", scope: "organisation" },
    { permissionKey: "attendance.view", scope: "office", officeId: "office-1" },
    { permissionKey: "leave.review", scope: "organisation_department", organisationDepartmentId: "department-1" },
    { permissionKey: "availability.wfh.review", scope: "client", clientId: "client-1" },
  ] })).toEqual({ schedule: true, holidays: true, attendance: true, leave: true, wfh: false });
});

test("Admin task discovery follows the final permission scope catalogue", () => {
  const unsupportedTaskScopes = planAdminReads({ grants: [
    { permissionKey: "tasks.view", scope: "office", officeId: "office-1" },
    { permissionKey: "tasks.create", scope: "organisation_department", organisationDepartmentId: "department-1" },
  ] });
  expect(unsupportedTaskScopes.work).toBe(false);
  expect(unsupportedTaskScopes.tasks).toBe(false);

  const supportedAssignedWork = planAdminReads({ grants: [
    { permissionKey: "tasks.view", scope: "assigned_work" },
    { permissionKey: "tasks.edit", scope: "assigned_work" },
  ] });
  expect(supportedAssignedWork.work).toBe(false);
  expect(supportedAssignedWork.tasks).toBe(false);
  const broadTaskViewer = planAdminReads({ grants: [
    { permissionKey: "tasks.view", scope: "client", clientId: "client-1" },
    { permissionKey: "tasks.assign", scope: "client", clientId: "client-1" },
  ] });
  expect(broadTaskViewer.work).toBe(true);
  expect(broadTaskViewer.tasks).toBe(true);
  expect(broadTaskViewer.people).toBe(false);
});

test("Work plans independent reads from effective feature grants and self applicability", () => {
  const none = {
    assignments: false, sessions: false, timeline: false, reviews: false,
    reviewerRequests: false, handoverRequests: false, workContext: false,
    workContextView: false, taskDetail: false, reviewerManagement: false,
    tasks: false, taskCollection: false, taskCatalog: false, attendance: false,
  };
  expect(planWorkReads(undefined)).toEqual(none);
  expect(planWorkReads({ grants: [], readError: "REQUEST_FAILED" })).toEqual(none);
  expect(planWorkReads({ actorPersonId: "p1", grants: [
    { permissionKey: "tasks.create", scope: "organisation" },
    { permissionKey: "work.timeline_adjust_own", scope: "own_record", selfApplicable: true },
    { permissionKey: "attendance.view", scope: "own_record", selfApplicable: true },
  ] })).toEqual({ ...none, workContext: true, attendance: true });
  expect(planWorkReads({ actorPersonId: "p1", grants: [
    { permissionKey: "tasks.create", scope: "client", clientId: "client-1" },
  ] })).toMatchObject({ workContext: true, workContextView: false, tasks: false, taskCollection: false, assignments: false });
  expect(planWorkReads({ actorPersonId: "p1", grants: [
    { permissionKey: "workstreams.view", scope: "client_workstream", clientWorkstreamId: "stream-1", clientId: "client-1" },
  ] })).toMatchObject({ workContext: true, workContextView: true, tasks: false, taskCollection: false, assignments: false });
  expect(planWorkReads({ actorPersonId: "p1", grants: [
    { permissionKey: "clients.view", scope: "client", clientId: "client-1" },
  ] })).toMatchObject({ workContext: true, workContextView: true, tasks: false, taskCollection: false, assignments: false });
  expect(planWorkReads({ actorPersonId: "p1", grants: [
    { permissionKey: "groups.view", scope: "office", officeId: "office-1" },
  ] })).toMatchObject({ workContext: false, workContextView: false });
  expect(planWorkReads({ actorPersonId: "p1", grants: [
    { permissionKey: "workstreams.billing_policy.manage", scope: "client_workstream", clientWorkstreamId: "stream-1", clientId: "client-1" },
  ] })).toEqual({
    assignments: false, sessions: false, timeline: false, reviews: false,
    reviewerRequests: false, handoverRequests: false, workContext: false,
    workContextView: false, taskDetail: false, reviewerManagement: false,
    tasks: false, taskCollection: false, taskCatalog: false, attendance: false,
  });
  expect(planWorkReads({ actorPersonId: "p1", grants: [
    { permissionKey: "workstreams.billing_policy.manage", scope: "group", groupId: "group-1" },
  ] })).toMatchObject({ workContext: false, workContextView: false });
  expect(planWorkReads({ actorPersonId: "p1", grants: [
    { permissionKey: "tasks.start", scope: "assigned_work" },
  ] })).toMatchObject({ assignments: true, sessions: true, taskCollection: false, tasks: false, workContext: false });
  expect(planWorkReads({ actorPersonId: "reviewer-1", grants: [
    { permissionKey: "tasks.review", scope: "client_workstream", clientId: "client-1", clientWorkstreamId: "stream-1" },
  ] })).toMatchObject({ reviews: true, taskDetail: false, taskCollection: false, tasks: false });
  expect(planWorkReads({ actorPersonId: "p1", grants: [
    { permissionKey: "tasks.reviewer_manage", scope: "organisation" },
  ] })).toMatchObject({ reviewerRequests: false, workContext: false, tasks: false });
  expect(planWorkReads({ actorPersonId: "p1", grants: [
    { permissionKey: "tasks.view", scope: "assigned_work" },
    { permissionKey: "tasks.create", scope: "organisation" },
  ] })).toMatchObject({ tasks: false, taskCollection: false });
  expect(planWorkReads({ actorPersonId: "p1", grants: [
    { permissionKey: "tasks.view", scope: "assigned_work" },
    { permissionKey: "tasks.start", scope: "assigned_work" },
    { permissionKey: "tasks.review", scope: "client", clientId: "client-1" },
    { permissionKey: "tasks.reviewer_request", scope: "group", groupId: "group-1" },
    { permissionKey: "tasks.handover_accept", scope: "assigned_work" },
    { permissionKey: "work.timeline.view", scope: "own_record", selfApplicable: true },
    { permissionKey: "attendance.view", scope: "office", officeId: "office-1", selfApplicable: true },
  ] })).toEqual({
    assignments: true, sessions: true, timeline: true, reviews: true,
    reviewerRequests: true, handoverRequests: true, workContext: false, workContextView: false,
    taskDetail: true, reviewerManagement: false, tasks: false, taskCollection: false, taskCatalog: false, attendance: true,
  });
  expect(planWorkReads({ actorPersonId: "p1", grants: [
    { permissionKey: "tasks.view", scope: "client", clientId: "client-1" },
  ] })).toMatchObject({ taskDetail: true, taskCollection: true, tasks: false, assignments: true });
  expect(planWorkReads({ actorPersonId: "p1", grants: [
    { permissionKey: "tasks.create", scope: "organisation" },
    { permissionKey: "tasks.view", scope: "organisation" },
    { permissionKey: "tasks.catalog.propose", scope: "organisation" },
  ] })).toMatchObject({ workContext: true, tasks: true, taskCatalog: true, assignments: true });
});

test("Work setup plans only organization catalog and supported billing-policy scopes", () => {
  const none = { taskCatalog: false, billingPolicy: false, hasAny: false };
  expect(planWorkSetupReads(undefined)).toEqual(none);
  expect(planWorkSetupReads({ grants: [], readError: "REQUEST_FAILED" })).toEqual(none);
  for (const permissionKey of [
    "tasks.catalog.view", "tasks.catalog.propose", "tasks.catalog.manage", "tasks.catalog.review",
  ]) {
    expect(planWorkSetupReads({ grants: [{ permissionKey, scope: "organisation" }] }))
      .toEqual({ taskCatalog: true, billingPolicy: false, hasAny: true });
  }
  expect(planWorkSetupReads({ grants: [{ permissionKey: "tasks.catalog.manage", scope: "client", clientId: "c1" }] }))
    .toEqual(none);
  for (const scope of ["organisation", "client", "client_workstream"]) {
    expect(planWorkSetupReads({ grants: [{ permissionKey: "workstreams.billing_policy.manage", scope }] }))
      .toEqual({ taskCatalog: false, billingPolicy: true, hasAny: true });
  }
  for (const scope of ["office", "organisation_department", "group", "assigned_work"]) {
    expect(planWorkSetupReads({ grants: [{ permissionKey: "workstreams.billing_policy.manage", scope }] }))
      .toEqual(none);
  }
  expect(planWorkSetupReads({ isSuperAdmin: true, grants: [] })).toEqual(none);
});

test("Today exposes each action and request module only from its own self-applicable grant", () => {
  const none = { checkIn: false, checkOut: false, changeMode: false, leaveRequest: false, wfhRequest: false };
  expect(planTodayFeatures(undefined)).toEqual(none);
  expect(planTodayFeatures({ grants: [], readError: "REQUEST_FAILED" })).toEqual(none);
  expect(planTodayFeatures({ grants: [
    { permissionKey: "attendance.view", scope: "own_record", selfApplicable: true },
  ] })).toEqual(none);
  expect(planTodayFeatures({ grants: [
    { permissionKey: "attendance.check_in", scope: "office", officeId: "office-1", selfApplicable: true },
    { permissionKey: "attendance.check_out", scope: "office", officeId: "office-2", selfApplicable: false },
    { permissionKey: "attendance.change_mode", scope: "own_record", selfApplicable: true },
    { permissionKey: "leave.request", scope: "own_record", selfApplicable: true },
    { permissionKey: "availability.wfh.request", scope: "office", officeId: "office-1", selfApplicable: true },
  ] })).toEqual({ checkIn: true, checkOut: false, changeMode: true, leaveRequest: true, wfhRequest: true });
});

test("My Day composes only independently authorized self-service reads", () => {
  const none = {
    attendance: false, attendanceActionContext: false, assignments: false, timeline: false,
    leaveRequest: false, wfhRequest: false, hasAny: false,
  };
  expect(planMyDayReads(undefined)).toEqual(none);
  expect(planMyDayReads({ grants: [], readError: "REQUEST_FAILED" })).toEqual(none);
  expect(planMyDayReads({ isSuperAdmin: true, grants: [] })).toEqual(none);
  expect(planMyDayReads({ grants: [
    { permissionKey: "attendance.check_in", scope: "own_record", selfApplicable: true },
  ] })).toEqual({ ...none, attendanceActionContext: true, hasAny: true });
  expect(planMyDayReads({ grants: [
    { permissionKey: "leave.request", scope: "own_record", selfApplicable: true },
  ] })).toEqual({ ...none, leaveRequest: true, hasAny: true });
  expect(planMyDayReads({ grants: [
    { permissionKey: "tasks.start", scope: "assigned_work", selfApplicable: false },
    { permissionKey: "work.timeline.view", scope: "own_record", selfApplicable: true },
    { permissionKey: "attendance.view", scope: "own_record", selfApplicable: true },
  ] })).toEqual({
    attendance: true, attendanceActionContext: false, assignments: true, timeline: true,
    leaveRequest: false, wfhRequest: false, hasAny: true,
  });
});

test("admin reads distinguish a permission denial from an empty result", () => {
  expect(adminReadIssue({ requests: [] }, "pending leave requests")).toBeUndefined();
  expect(adminReadIssue({ requests: [], readError: "PERMISSION_DENIED" }, "pending leave requests")).toEqual({
    kind: "unavailable",
    message: "You do not have permission to view pending leave requests.",
  });
});

test("admin reads report a retryable failure without claiming the resource is empty", () => {
  expect(adminReadIssue({ tasks: [], readError: "REQUEST_FAILED" }, "tasks")).toEqual({
    kind: "unavailable",
    message: "Could not load tasks. Refresh the page to try again.",
  });
});

test("a skipped dependent read explains its prerequisite without pretending it failed", () => {
  const skipped = skippedAdminRead({ people: [] }, "people.view");
  expect(skipped).toEqual({
    people: [],
    readError: "PREREQUISITE_PERMISSION_REQUIRED",
    requiredPermission: "people.view",
  });
  expect(adminReadIssue(skipped, "people choices")).toEqual({
    kind: "unavailable",
    message: "Cannot load people choices; people.view is required for this selector.",
  });
});

test("permission-load notice gives unverified users the actual next step", () => {
  expect(adminPermissionNoticeMessage({ readError: "PERMISSION_DENIED" }, { emailVerified: false })).toBe(
    "Your email is still unverified, so role permissions are unavailable. Request a verification link in Settings; if email is not available, use the secure handoff there.",
  );
  expect(adminPermissionNoticeMessage({ readError: "REQUEST_FAILED" }, { emailVerified: true })).toBe(
    "Admin links are hidden because your permissions could not be checked. Refresh to try again.",
  );
  expect(adminPermissionNoticeMessage({ grants: [] }, { emailVerified: false })).toBeUndefined();
});

test("optional reads preserve successes and mark failed reads without mutating the fallback", async () => {
  const fallback = { requests: [] };
  expect(await readOrError(Promise.resolve({ requests: [{ id: "1" }] }), fallback)).toEqual({ requests: [{ id: "1" }] });
  expect(await readOrError(Promise.reject({ code: "PERMISSION_DENIED" }), fallback)).toEqual({
    requests: [], readError: "PERMISSION_DENIED",
  });
  expect(fallback).toEqual({ requests: [] });
});

test("permission UI hints fail closed and match only the actor's applicable grant scope", () => {
  const grants = {
    actorPersonId: "actor-1",
    grants: [
      { permissionKey: "roles.create", scope: "organisation" },
      { permissionKey: "people.offboard", scope: "office", officeId: "office-1" },
      { permissionKey: "people.edit", scope: "own_record" },
    ],
  };
  expect(hasPermissionGrant(grants, "roles.create")).toBe(true);
  expect(hasPermissionGrant(grants, "people.offboard", { officeId: "office-1" })).toBe(true);
  expect(hasPermissionGrant(grants, "people.offboard", { officeId: "office-2" })).toBe(false);
  expect(hasPermissionGrant(grants, "people.edit", { personId: "actor-1" })).toBe(true);
  expect(hasPermissionGrant(grants, "people.edit", { personId: "person-2" })).toBe(false);
  expect(hasPermissionGrant({ grants: [], readError: "REQUEST_FAILED" }, "roles.create")).toBe(false);
  expect(hasAnyPermissionGrant(grants, ["people.offboard"], ["office"])).toBe(true);
  expect(hasAnyPermissionGrant(grants, ["people.offboard"], ["organisation"])).toBe(false);
  expect(hasPermissionGrant(undefined, "roles.create")).toBe(false);
});

test("freeze row visibility respects the target person's current office or department", () => {
  const grants = {
    grants: [
      { permissionKey: "people.freeze", scope: "office", officeId: "office-1" },
      { permissionKey: "people.freeze", scope: "organisation_department", organisationDepartmentId: "department-2" },
    ],
  };
  expect(hasPermissionGrant(grants, "people.freeze", { officeId: "office-1" })).toBe(true);
  expect(hasPermissionGrant(grants, "people.freeze", { officeId: "office-3" })).toBe(false);
  expect(hasPermissionGrant(grants, "people.freeze", { organisationDepartmentId: "department-2" })).toBe(true);
  expect(hasPermissionGrant(grants, "people.freeze", { organisationDepartmentId: "department-4" })).toBe(false);
});

test("office creation visibility requires both organization and geofence grants", () => {
  expect(canCreateOffice({ grants: [{ permissionKey: "organisation.settings.manage", scope: "organisation" }] })).toBe(false);
  expect(canCreateOffice({ grants: [{ permissionKey: "availability.office_geofence.manage", scope: "organisation" }] })).toBe(false);
  expect(canCreateOffice({ grants: [
    { permissionKey: "organisation.settings.manage", scope: "organisation" },
    { permissionKey: "availability.office_geofence.manage", scope: "organisation" },
  ] })).toBe(true);
  expect(canCreateOffice({ grants: [], readError: "REQUEST_FAILED" })).toBe(false);
});

test("Admin feature discovery follows the endpoint's supported permission scope", () => {
  const officePeopleAdmin = {
    grants: [
      { permissionKey: "people.view", scope: "office", officeId: "office-1" },
      { permissionKey: "leave.review", scope: "office", officeId: "office-1" },
      { permissionKey: "availability.calendar.view", scope: "office", officeId: "office-1" },
    ],
  };
  expect(canShowAdminFeature(officePeopleAdmin, "people")).toBe(false);
  expect(canShowAdminFeature({ grants: [{ permissionKey: "people.invite", scope: "office", officeId: "office-1" }] }, "people")).toBe(false);
  expect(canShowAdminFeature(officePeopleAdmin, "leaveReview")).toBe(true);
  expect(canShowAdminFeature({ grants: [{ permissionKey: "leave.review", scope: "own_record" }] }, "leaveReview")).toBe(false);
  expect(canShowAdminFeature({ grants: [{ permissionKey: "availability.wfh.review", scope: "own_record" }] }, "wfhReview")).toBe(false);
  expect(canShowAdminFeature(officePeopleAdmin, "audit")).toBe(false);
  expect(canShowAdminFeature(officePeopleAdmin, "availabilityConfiguration")).toBe(false);
  expect(canShowAdminFeature(officePeopleAdmin, "roles")).toBe(false);
  expect(canShowAdminFeature({ grants: [{ permissionKey: "roles.create", scope: "organisation" }] }, "roles")).toBe(false);
  expect(canShowAdminFeature({ grants: [{ permissionKey: "roles.view", scope: "organisation" }] }, "roles")).toBe(true);
  expect(canShowAdminFeature({ grants: [{ permissionKey: "availability.wfh_policy.manage", scope: "organisation" }] }, "wfhOverrides")).toBe(true);
  expect(canShowAdminFeature({ grants: [{ permissionKey: "availability.wfh_policy.manage", scope: "office", officeId: "office-1" }] }, "wfhOverrides")).toBe(false);
  expect(canShowAdminFeature({ grants: [{ permissionKey: "availability.wfh_policy.view", scope: "organisation" }] }, "wfhOverrides")).toBe(true);
  expect(canShowAdminFeature({ grants: [{ permissionKey: "availability.shift.manage", scope: "organisation" }] }, "availabilityConfiguration")).toBe(true);
  expect(canShowAdminFeature({ grants: [{ permissionKey: "tasks.view", scope: "assigned_work" }] }, "leaveReview")).toBe(false);
  expect(canShowAdminFeature({ grants: [{ permissionKey: "tasks.view", scope: "assigned_work" }] }, "work")).toBe(false);
  expect(canShowAdminFeature({ grants: [{ permissionKey: "tasks.assign", scope: "client", clientId: "client-1" }] }, "work")).toBe(false);
  expect(canShowAdminFeature({ grants: [
    { permissionKey: "tasks.view", scope: "client", clientId: "client-1" },
    { permissionKey: "tasks.assign", scope: "client", clientId: "client-1" },
  ] }, "work")).toBe(true);
  expect(canShowAdminFeature({ grants: [
    { permissionKey: "tasks.edit", scope: "assigned_work" },
  ] }, "work")).toBe(false);
  expect(canShowAdminFeature({ grants: [
    { permissionKey: "workstreams.create", scope: "client", clientId: "client-1" },
  ] }, "work")).toBe(false);
  expect(canShowAdminFeature({ grants: [
    { permissionKey: "workstreams.create", scope: "client", clientId: "client-1" },
    { permissionKey: "clients.view", scope: "client", clientId: "client-1" },
  ] }, "work")).toBe(true);
  expect(canShowAdminFeature({ grants: [
    { permissionKey: "groups.create", scope: "client_workstream", clientId: "client-1", clientWorkstreamId: "stream-1" },
  ] }, "work")).toBe(false);
  expect(canShowAdminFeature({ grants: [
    { permissionKey: "groups.create", scope: "client_workstream", clientId: "client-1", clientWorkstreamId: "stream-1" },
    { permissionKey: "workstreams.view", scope: "client_workstream", clientId: "client-1", clientWorkstreamId: "stream-1" },
  ] }, "work")).toBe(true);
  expect(canShowAdminFeature({ grants: [{ permissionKey: "tasks.reviewer_manage", scope: "organisation" }] }, "work")).toBe(false);
  expect(canShowAdminFeature({ grants: [{ permissionKey: "groups.edit", scope: "organisation" }] }, "work")).toBe(false);
  expect(canShowAdminFeature({ grants: [{ permissionKey: "workstreams.billing_policy.manage", scope: "client_workstream", clientWorkstreamId: "stream-1", clientId: "client-1" }] }, "work")).toBe(false);
  expect(canShowAdminFeature({ grants: [{ permissionKey: "workstreams.billing_policy.manage", scope: "group", groupId: "group-1" }] }, "work")).toBe(false);
  expect(canShowAdminFeature({ grants: [{ permissionKey: "workstreams.billing_policy.manage", scope: "assigned_work" }] }, "work")).toBe(false);
  expect(canShowAdminFeature({ grants: [{ permissionKey: "availability.calendar.view", scope: "organisation" }] }, "availabilityConfiguration")).toBe(true);
  expect(canShowAdminNavigation({ grants: [{ permissionKey: "tasks.catalog.propose", scope: "organisation" }] })).toBe(false);
  expect(canShowAdminFeature({ isSuperAdmin: true, grants: [] }, "audit")).toBe(false);
  expect(canShowAdminFeature({ grants: [], readError: "REQUEST_FAILED" }, "audit")).toBe(false);
});

test("WFH policy listing remains view-only when a role has create-only access", () => {
  const manageOnly = {
    isSuperAdmin: false,
    grants: [{ permissionKey: "availability.wfh_policy.manage", scope: "organisation" }],
  };
  const viewOnly = {
    isSuperAdmin: false,
    grants: [{ permissionKey: "availability.wfh_policy.view", scope: "organisation" }],
  };

  expect(canShowAdminFeature(manageOnly, "wfhOverrides")).toBe(true);
  expect(planAdminReads(manageOnly).wfhPolicies).toBe(false);
  expect(planAdminReads(viewOnly).wfhPolicies).toBe(true);
});

test("Admin read plan follows each endpoint's exact read contract", () => {
  const plan = planAdminReads({
    actorPersonId: "actor-1",
    grants: [
      { permissionKey: "people.view", scope: "office", officeId: "office-1" },
      { permissionKey: "leave.review", scope: "office", officeId: "office-1" },
      { permissionKey: "availability.wfh.review", scope: "own_record" },
      { permissionKey: "availability.office_geofence.manage", scope: "organisation" },
      { permissionKey: "tasks.create", scope: "client", clientId: "client-1" },
      { permissionKey: "roles.view", scope: "organisation" },
      { permissionKey: "roles.create", scope: "organisation" },
    ],
  });

  expect(plan).toEqual({
    organisation: false,
    offices: false,
    departments: false,
    permissions: true,
    roles: true,
    people: false,
    audit: false,
    availability: false,
    wfhPolicies: false,
    leavePending: true,
    wfhPending: false,
    exceptions: false,
    workContext: true,
    work: true,
    tasks: false,
    taskCatalog: false,
    geofenceOptions: true,
    notificationDelivery: false,
  });

  expect(planAdminReads({ grants: [], readError: "REQUEST_FAILED" })).toEqual({
    organisation: false,
    offices: false,
    departments: false,
    permissions: false,
    roles: false,
    people: false,
    audit: false,
    availability: false,
    wfhPolicies: false,
    leavePending: false,
    wfhPending: false,
    exceptions: false,
    workContext: false,
    work: false,
    tasks: false,
    taskCatalog: false,
    geofenceOptions: false,
    notificationDelivery: false,
  });
});

test("Super Admin status alone does not expose Admin without the owner-transfer People read", () => {
  const plan = planAdminReads({ isSuperAdmin: true, grants: [] });
  expect(Object.values(plan).some(Boolean)).toBe(false);
  expect(canShowAdminFeature({ isSuperAdmin: true, grants: [] }, "audit")).toBe(false);
  expect(canShowAdminNavigation({ isSuperAdmin: true, grants: [] })).toBe(false);
  expect(canShowAdminNavigation({ isSuperAdmin: true, grants: [], readError: "REQUEST_FAILED" })).toBe(false);
  expect(canShowAdminNavigation({
    isSuperAdmin: true,
    grants: [{ permissionKey: "people.view", scope: "organisation" }],
  })).toBe(true);
});

test("invite permission does not authorize a people read and scoped people access does not authorize audit", () => {
  expect(planAdminReads({ grants: [{ permissionKey: "people.invite", scope: "organisation" }] }).people).toBe(false);
  const scoped = planAdminReads({ grants: [{ permissionKey: "people.view", scope: "office", officeId: "office-1" }] });
  expect(scoped.people).toBe(false);
  expect(scoped.audit).toBe(false);
  expect(canShowAdminNavigation({ grants: [{ permissionKey: "people.view", scope: "office", officeId: "office-1" }] })).toBe(false);
  expect(canShowPeopleNavigation({ grants: [{ permissionKey: "people.view", scope: "office", officeId: "office-1" }] })).toBe(true);
});

test("management navigation follows grants while self-service pages do not depend on admin access", () => {
  const employee = {
    actorPersonId: "worker-1",
    isSuperAdmin: false,
    grants: [
      { permissionKey: "tasks.view", scope: "assigned_work" },
      { permissionKey: "attendance.view", scope: "own_record" },
    ],
  };
  expect(canShowAdminNavigation(employee)).toBe(false);
  expect(canShowWorkNavigation(employee)).toBe(true);
  expect(canShowWorkSetupNavigation(employee)).toBe(false);
  expect(canShowInviteNavigation(employee)).toBe(false);
  expect(canViewAuthHandoffs(employee)).toBe(false);
  expect(hasAnyPermissionGrant(employee, ["tasks.view"])).toBe(true);
  expect(canShowAdminNavigation({
    isSuperAdmin: false,
    grants: [{ permissionKey: "people.view", scope: "office", officeId: "office-1" }],
  })).toBe(false);
  expect(canShowAdminNavigation({
    isSuperAdmin: false,
    grants: [{ permissionKey: "availability.calendar.view", scope: "office", officeId: "office-1" }],
  })).toBe(false);
  expect(canShowWorkNavigation({
    isSuperAdmin: false,
    grants: [{ permissionKey: "workstreams.view", scope: "client_workstream", clientWorkstreamId: "stream-1" }],
  })).toBe(true);
  expect(canShowWorkNavigation({
    isSuperAdmin: false,
    grants: [{ permissionKey: "workstreams.view", scope: "office", officeId: "office-1" }],
  })).toBe(false);
  const catalogOnly = { isSuperAdmin: false, grants: [{ permissionKey: "tasks.catalog.manage", scope: "organisation" }] };
  expect(canShowWorkNavigation(catalogOnly)).toBe(false);
  expect(canShowWorkSetupNavigation(catalogOnly)).toBe(true);
  expect(canShowWorkSetupNavigation({
    readError: "REQUEST_FAILED",
    grants: [{ permissionKey: "workstreams.billing_policy.manage", scope: "organisation" }],
  })).toBe(false);
  expect(canShowWorkNavigation({ hasOpenWorkSession: true, readError: "REQUEST_FAILED" })).toBe(false);
  expect(canShowInviteNavigation({
    isSuperAdmin: false,
    grants: [{ permissionKey: "people.invite", scope: "organisation" }],
  })).toBe(true);
  expect(canShowAdminNavigation({
    isSuperAdmin: false,
    grants: [{ permissionKey: "people.invite", scope: "organisation" }],
  })).toBe(false);
  expect(canShowAdminNavigation({
    isSuperAdmin: false,
    grants: [{ permissionKey: "availability.calendar.view", scope: "office", officeId: "office-1" }],
  })).toBe(false);
  expect(canViewAuthHandoffs({
    isSuperAdmin: false,
    grants: [{ permissionKey: "auth.manual_recovery", scope: "organisation" }],
  })).toBe(true);
  expect(canShowAdminNavigation({ grants: [], readError: "REQUEST_FAILED" })).toBe(false);
  expect(canShowAdminNavigation({ isSuperAdmin: true, grants: [] })).toBe(false);
});

test("client-scoped membership managers can discover only the existing client context workflows", () => {
  const membershipManager = {
    isSuperAdmin: false,
    grants: [{ permissionKey: "clients.members.manage", scope: "client", clientId: "client-1" }],
  };

  expect(canShowAdminFeature(membershipManager, "work")).toBe(true);
  expect(canShowAdminNavigation(membershipManager)).toBe(true);
  expect(planAdminReads(membershipManager)).toMatchObject({
    work: true,
    workContext: true,
    tasks: false,
    people: false,
  });
  expect(planWorkReads(membershipManager)).toMatchObject({
    workContext: true,
    workContextView: true,
    tasks: false,
    taskCollection: false,
  });
  expect(canShowWorkNavigation(membershipManager)).toBe(true);
});

test("read-only Work Context hides create-only groups", () => {
  expect(canShowWorkContextGroup({ canViewGroup: true, canCreateTask: false })).toBe(true);
  expect(canShowWorkContextGroup({ canViewGroup: true, canCreateTask: true })).toBe(true);
  expect(canShowWorkContextGroup({ canViewGroup: false, canCreateTask: true })).toBe(false);
  expect(canShowWorkContextGroup({ canCreateTask: true })).toBe(false);
});
