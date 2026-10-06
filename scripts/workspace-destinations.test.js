import { expect, test } from "bun:test";
import {
  canShowAdminNavigation,
  canShowAvailabilityNavigation,
  canShowInviteNavigation,
  canShowOperationsNavigation,
  canShowPeopleNavigation,
  canShowTodayNavigation,
  canShowWorkNavigation,
  canShowWorkSetupNavigation,
  planAvailabilityAgendaReads,
  planMyDayReads,
  planOperationsReads,
  planAdminReads,
  planWorkSetupReads,
} from "../web/admin-read-state.js";
import { planWorkReads } from "../web/src/features/work/read-capabilities.ts";
import {
  WORKSPACE_DESTINATION_VIEW_IDS,
  WORKSPACE_DESTINATIONS,
  canAccessWorkspaceDestination,
  getVisibleWorkspaceDestinations,
  resolveWorkspaceDestinationView,
  resolveWorkspaceHome,
} from "../web/workspace-destinations.js";
import { resolveNotificationDeepLink } from "../web/notification-destinations.js";

function grants(actorPersonId, grants, extra = {}) {
  return { actorPersonId, grants, ...extra };
}

const destinationViews = (read) =>
  getVisibleWorkspaceDestinations(read).map(({ view }) => view);

test("registry exposes only current signed-in routes with stable labels", () => {
  expect(WORKSPACE_DESTINATION_VIEW_IDS).toEqual([
    "today", "work", "availability", "people", "notifications", "operations", "admin",
    "admin-organisation", "admin-availability", "admin-access", "admin-work", "admin-requests", "admin-audit",
    "invite", "work-setup", "settings",
  ]);
  expect(WORKSPACE_DESTINATIONS.map(({ label }) => label)).toEqual([
    "My Day", "Work", "Availability", "People", "Notifications", "Operations", "Admin console",
    "Organisation", "Availability", "People and access", "Work administration", "Requests and exceptions", "Audit and delivery",
    "Invite a person", "Work setup", "Settings",
  ]);
  expect(WORKSPACE_DESTINATIONS.map(({ group }) => group)).toEqual([
    "My workspace", "My workspace", "My workspace", "Team operations", "My workspace", "Team operations", "Team operations",
    "Administration", "Administration", "Administration", "Administration", "Administration", "Administration",
    "Team operations", "Configuration", "Configuration",
  ]);
});

test("legacy task notification links resolve to Work while ordinary Today links stay on My Day", () => {
  expect(resolveWorkspaceDestinationView(new URLSearchParams("view=today"))).toBe("today");
  expect(resolveWorkspaceDestinationView(new URLSearchParams("view=today&task=task-1"))).toBe("work");
  expect(resolveWorkspaceDestinationView(new URLSearchParams("view=today&review=assignment-1"))).toBe("work");
  expect(resolveWorkspaceDestinationView(new URLSearchParams("view=work&review=assignment-1"))).toBe("work");
  expect(resolveWorkspaceDestinationView(new URLSearchParams("view=unknown&task=task-1"))).toBeNull();
});

test("typed collaboration request links resolve only valid, single request IDs to Work", () => {
  const reviewerId = "11111111-1111-4111-8111-111111111111";
  const handoverId = "22222222-2222-4222-8222-222222222222";
  expect(resolveWorkspaceDestinationView(new URLSearchParams(`view=work&reviewerRequest=${reviewerId}`))).toBe("work");
  expect(resolveWorkspaceDestinationView(new URLSearchParams(`view=work&handoverRequest=${handoverId}`))).toBe("work");
  expect(resolveWorkspaceDestinationView(new URLSearchParams("view=work&reviewerRequest=bad"))).toBeNull();
  expect(resolveWorkspaceDestinationView(new URLSearchParams(`view=admin&reviewerRequest=${reviewerId}`))).toBeNull();
  expect(resolveWorkspaceDestinationView(new URLSearchParams(`view=work&view=admin&reviewerRequest=${reviewerId}`))).toBeNull();
  expect(resolveWorkspaceDestinationView(new URLSearchParams(`view=work&reviewerRequest=${reviewerId}&handoverRequest=${handoverId}`))).toBeNull();
  expect(resolveWorkspaceDestinationView(new URLSearchParams(`view=work&reviewerRequest=${reviewerId}&reviewerRequest=${handoverId}`))).toBeNull();
});

test("notification links stay internal and follow the same destination grants", () => {
  const workReader = grants("work-reader", [
    { permissionKey: "tasks.view", scope: "assigned_work" },
  ]);
  const noFeatureGrants = grants("inbox-only", []);

  expect(resolveNotificationDeepLink("/?view=work&task=task-1", {
    origin: "https://nova.example", grants: workReader,
  })).toBe("/?view=work&task=task-1");
  expect(resolveNotificationDeepLink("/?view=work&reviewerRequest=11111111-1111-4111-8111-111111111111", {
    origin: "https://nova.example", grants: workReader,
  })).toBe("/?view=work&reviewerRequest=11111111-1111-4111-8111-111111111111");
  expect(resolveNotificationDeepLink("/?view=work&handoverRequest=not-a-uuid", {
    origin: "https://nova.example", grants: workReader,
  })).toBeNull();
  expect(resolveNotificationDeepLink("/?view=home&handoverRequest=22222222-2222-4222-8222-222222222222", {
    origin: "https://nova.example", grants: workReader, homeView: "today",
  })).toBeNull();
  expect(resolveNotificationDeepLink("/?view=today&task=task-1", {
    origin: "https://nova.example", grants: noFeatureGrants,
  })).toBeNull();
  expect(resolveNotificationDeepLink("/?view=people", {
    origin: "https://nova.example", grants: noFeatureGrants,
  })).toBeNull();
  expect(resolveNotificationDeepLink("/?view=home", {
    origin: "https://nova.example", grants: noFeatureGrants, homeView: "settings",
  })).toBe("/?view=home");
  expect(resolveNotificationDeepLink("//attacker.example/collect", {
    origin: "https://nova.example", grants: workReader,
  })).toBeNull();
  expect(resolveNotificationDeepLink("https://nova.example/admin", {
    origin: "https://nova.example", grants: workReader,
  })).toBeNull();
  expect(resolveNotificationDeepLink("/?view=unknown", {
    origin: "https://nova.example", grants: workReader,
  })).toBeNull();
});

test("reviewer and handover notifications remain available to their narrow feature roles", () => {
  const reviewerRecipient = grants("review-recipient", [
    { permissionKey: "tasks.reviewer_request", scope: "assigned_work" },
  ]);
  const handoverRecipient = grants("handover-recipient", [
    { permissionKey: "tasks.handover_accept", scope: "assigned_work" },
  ]);
  const noWorkCapability = grants("other-role", []);

  const reviewerLink = "/?view=work&reviewerRequest=11111111-1111-4111-8111-111111111111";
  const handoverLink = "/?view=work&handoverRequest=22222222-2222-4222-8222-222222222222";
  expect(canAccessWorkspaceDestination("work", reviewerRecipient)).toBe(true);
  expect(canAccessWorkspaceDestination("work", handoverRecipient)).toBe(true);
  expect(resolveNotificationDeepLink(reviewerLink, {
    origin: "https://nova.example", grants: reviewerRecipient,
  })).toBe(reviewerLink);
  expect(resolveNotificationDeepLink(handoverLink, {
    origin: "https://nova.example", grants: handoverRecipient,
  })).toBe(handoverLink);
  expect(resolveNotificationDeepLink(handoverLink, {
    origin: "https://nova.example", grants: noWorkCapability,
  })).toBe(handoverLink);
  expect(canAccessWorkspaceDestination("work", noWorkCapability, new URLSearchParams(reviewerLink.split("?")[1]))).toBe(true);
  expect(canAccessWorkspaceDestination("work", noWorkCapability)).toBe(false);
});

test("employee destinations use the same grants for discoverability and direct entry", () => {
  const employee = grants("employee-1", [
    { permissionKey: "attendance.view", scope: "own_record", selfApplicable: true },
    { permissionKey: "tasks.view", scope: "assigned_work" },
  ]);

  expect(destinationViews(employee)).toEqual(["today", "work", "availability", "notifications", "settings"]);
  for (const view of WORKSPACE_DESTINATION_VIEW_IDS) {
    expect(canAccessWorkspaceDestination(view, employee)).toBe(destinationViews(employee).includes(view));
  }
  expect(resolveWorkspaceHome(employee)).toBe("today");
});

test("My Day is discoverable from a self-service module without implying attendance access", () => {
  const leaveOnly = grants("leave-only", [
    { permissionKey: "leave.request", scope: "own_record", selfApplicable: true },
  ]);
  const attendanceActionOnly = grants("attendance-action-only", [
    { permissionKey: "attendance.check_in", scope: "own_record", selfApplicable: true },
  ]);

  expect(canAccessWorkspaceDestination("today", leaveOnly)).toBe(true);
  expect(canAccessWorkspaceDestination("today", attendanceActionOnly)).toBe(true);
  expect(canAccessWorkspaceDestination("work", attendanceActionOnly)).toBe(false);
});

test("invite-only grants expose the invite destination without exposing Admin", () => {
  const inviteOnly = grants("inviter-1", [
    { permissionKey: "people.invite", scope: "organisation" },
  ]);

  expect(canAccessWorkspaceDestination("invite", inviteOnly)).toBe(true);
  expect(canAccessWorkspaceDestination("people", inviteOnly)).toBe(false);
  expect(canAccessWorkspaceDestination("admin", inviteOnly)).toBe(false);
  expect(canAccessWorkspaceDestination("work", inviteOnly)).toBe(false);
  expect(resolveWorkspaceHome(inviteOnly)).toBe("invite");
});

test("scoped administration and reporting remain discoverable at supported scopes", () => {
  const scopedManager = grants("manager-1", [
    { permissionKey: "people.view", scope: "office", officeId: "office-1" },
  ]);

  expect(canAccessWorkspaceDestination("admin", scopedManager)).toBe(false);
  expect(canAccessWorkspaceDestination("operations", scopedManager)).toBe(true);
  expect(canAccessWorkspaceDestination("invite", scopedManager)).toBe(false);
  expect(resolveWorkspaceHome(scopedManager)).toBe("operations");
  expect(canAccessWorkspaceDestination("admin", grants("calendar-viewer", [
    { permissionKey: "availability.calendar.view", scope: "office", officeId: "office-1" },
  ]))).toBe(false);

  const selfOnly = grants("employee-2", [
    { permissionKey: "attendance.view", scope: "own_record", selfApplicable: true },
  ]);
  expect(canAccessWorkspaceDestination("operations", selfOnly)).toBe(false);
  expect(canAccessWorkspaceDestination("availability", selfOnly)).toBe(true);
  expect(canAccessWorkspaceDestination("people", selfOnly)).toBe(false);
});

test("work exposes create-only task entry while operations still requires a readable feature", () => {
  const unsupported = grants("person-6", [
    { permissionKey: "tasks.create", scope: "organisation" },
  ]);
  expect(canAccessWorkspaceDestination("work", unsupported)).toBe(true);
  expect(canAccessWorkspaceDestination("operations", unsupported)).toBe(false);
  expect(canAccessWorkspaceDestination("availability", grants("holiday-viewer", [
    { permissionKey: "availability.holiday.view", scope: "organisation" },
  ]))).toBe(true);
  expect(canAccessWorkspaceDestination("operations", grants("holiday-viewer", [
    { permissionKey: "availability.holiday.view", scope: "organisation" },
  ]))).toBe(true);
});

test("Work setup is visible only for supported catalog or billing-policy capability", () => {
  const catalogManager = grants("catalog-manager", [
    { permissionKey: "tasks.catalog.manage", scope: "organisation" },
  ]);
  expect(destinationViews(catalogManager)).toEqual(["notifications", "work-setup", "settings"]);
  expect(canAccessWorkspaceDestination("work", catalogManager)).toBe(false);
  expect(canAccessWorkspaceDestination("work-setup", catalogManager)).toBe(true);

  const billingManager = grants("billing-manager", [
    { permissionKey: "workstreams.billing_policy.manage", scope: "client_workstream", clientId: "client-1", clientWorkstreamId: "stream-1" },
  ]);
  expect(canAccessWorkspaceDestination("work-setup", billingManager)).toBe(true);
  expect(canAccessWorkspaceDestination("work", billingManager)).toBe(false);

  const unsupportedCatalogScope = grants("unsupported-catalog", [
    { permissionKey: "tasks.catalog.review", scope: "client", clientId: "client-1" },
  ]);
  expect(canAccessWorkspaceDestination("work-setup", unsupportedCatalogScope)).toBe(false);
});

test("gated routes fail closed when grants are unavailable while own destinations remain", () => {
  const unresolvedReads = [
    undefined,
    {},
    { actorPersonId: "person-1" },
    grants("person-1", [], { readError: "REQUEST_FAILED" }),
    { grants: [{ permissionKey: "roles.create", scope: "organisation" }] },
  ];

  for (const read of unresolvedReads) {
    expect(canAccessWorkspaceDestination("today", read)).toBe(false);
    expect(canAccessWorkspaceDestination("work", read)).toBe(false);
    expect(canAccessWorkspaceDestination("work-setup", read)).toBe(false);
    expect(canAccessWorkspaceDestination("operations", read)).toBe(false);
    expect(canAccessWorkspaceDestination("admin", read)).toBe(false);
    expect(canAccessWorkspaceDestination("invite", read)).toBe(false);
    expect(canAccessWorkspaceDestination("notifications", read)).toBe(true);
    expect(canAccessWorkspaceDestination("settings", read)).toBe(true);
    expect(resolveWorkspaceHome(read)).toBe("settings");
    expect(destinationViews(read)).toEqual(["notifications", "settings"]);
  }
});

test("workspace visibility agrees with each feature read planner for representative grants", () => {
  const cases = [
    {
      view: "today",
      read: grants("person-a", [{ permissionKey: "attendance.view", scope: "own_record", selfApplicable: true }]),
      navigation: canShowTodayNavigation,
      hasUsableRead: (read) => planMyDayReads(read).hasAny,
    },
    {
      view: "work",
      read: grants("person-b", [{ permissionKey: "tasks.view", scope: "assigned_work" }]),
      navigation: canShowWorkNavigation,
      hasUsableRead: (read) => Object.entries(planWorkReads(read)).some(([feature, enabled]) => feature !== "taskCatalog" && enabled),
    },
    {
      view: "availability",
      read: grants("person-c", [{ permissionKey: "availability.holiday.view", scope: "organisation" }]),
      navigation: canShowAvailabilityNavigation,
      hasUsableRead: (read) => Object.values(planAvailabilityAgendaReads(read)).some(Boolean),
    },
    {
      view: "operations",
      read: grants("person-d", [{ permissionKey: "people.view", scope: "office", officeId: "office-1" }]),
      navigation: canShowOperationsNavigation,
      hasUsableRead: (read) => Object.values(planOperationsReads(read)).some(Boolean),
    },
    {
      view: "work-setup",
      read: grants("person-e", [{ permissionKey: "tasks.catalog.manage", scope: "organisation" }]),
      navigation: canShowWorkSetupNavigation,
      hasUsableRead: (read) => planWorkSetupReads(read).hasAny,
    },
    {
      view: "people",
      read: grants("person-f", [{ permissionKey: "people.view", scope: "office", officeId: "office-2" }]),
      navigation: canShowPeopleNavigation,
      hasUsableRead: canShowPeopleNavigation,
    },
    {
      view: "invite",
      read: grants("person-g", [{ permissionKey: "people.invite", scope: "organisation" }]),
      navigation: canShowInviteNavigation,
      hasUsableRead: canShowInviteNavigation,
    },
  ];

  for (const { view, read, navigation, hasUsableRead } of cases) {
    const expected = hasUsableRead(read);
    expect(navigation(read)).toBe(expected);
    expect(canAccessWorkspaceDestination(view, read)).toBe(expected);
    expect(destinationViews(read).includes(view)).toBe(expected);
  }

  const irrelevantScope = grants("person-h", [{ permissionKey: "people.view", scope: "own_record", selfApplicable: true }]);
  expect(canShowOperationsNavigation(irrelevantScope)).toBe(false);
  expect(canAccessWorkspaceDestination("operations", irrelevantScope)).toBe(false);

  const superAdminWithoutPeopleRead = grants("person-i", [], { isSuperAdmin: true });
  expect(canShowAdminNavigation(superAdminWithoutPeopleRead)).toBe(false);
  expect(canAccessWorkspaceDestination("admin", superAdminWithoutPeopleRead)).toBe(false);
  expect(Object.values(planAdminReads(superAdminWithoutPeopleRead)).every((allowed) => !allowed)).toBe(true);

  const superAdminWithPeopleRead = grants("person-j", [
    { permissionKey: "people.view", scope: "organisation" },
  ], { isSuperAdmin: true });
  expect(canShowAdminNavigation(superAdminWithPeopleRead)).toBe(true);
  expect(canAccessWorkspaceDestination("admin", superAdminWithPeopleRead)).toBe(true);
});

test("home resolution uses the explicit My Day, Work, Operations, Settings priority", () => {
  const multipleDestinations = grants("person-3", [
    { permissionKey: "attendance.view", scope: "own_record", selfApplicable: true },
    { permissionKey: "tasks.view", scope: "assigned_work" },
    { permissionKey: "availability.calendar.view", scope: "organisation" },
  ]);

  expect(resolveWorkspaceHome(multipleDestinations)).toBe("today");
  expect(resolveWorkspaceHome(grants("person-4", [
    { permissionKey: "tasks.view", scope: "assigned_work" },
    { permissionKey: "availability.calendar.view", scope: "organisation" },
  ]))).toBe("today");
});

test("own inbox and settings remain available; unknown routes do not pass the registry", () => {
  const noFeatureGrants = grants("person-5", []);
  expect(canAccessWorkspaceDestination("notifications", noFeatureGrants)).toBe(true);
  expect(canAccessWorkspaceDestination("settings", noFeatureGrants)).toBe(true);
  expect(canAccessWorkspaceDestination("people", noFeatureGrants)).toBe(false);
  expect(canAccessWorkspaceDestination("payroll", noFeatureGrants)).toBe(false);
});
