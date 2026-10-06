import { describe, expect, it } from "bun:test";
import { readFileSync } from "node:fs";
import { createElement, isValidElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { hasPermissionGrant } from "../../app-shell/permission-grants";
import { AttendancePolicySettingsSection } from "../../features/admin/attendance-policy/AttendancePolicySettingsSection";
import { HistoricalExceptionsSection } from "../../features/admin/exceptions/HistoricalExceptionsSection";
import { OrganizationStructureSection } from "../../features/admin/organization/OrganizationStructureSection";
import { RolePermissionsSection } from "../../features/admin/roles/RolePermissionsSection";
import { OfficeGeofenceSettingsSection } from "../../features/admin/OfficeGeofenceSettingsSection";
import { AvailabilityConfigurationSection } from "../../features/availability/AvailabilityConfigurationSection";
import { LeaveRequestsSection } from "../../features/admin/leave-requests/LeaveRequestsSection";
import { WfhRequestsReviewSection } from "../../features/admin/wfh-requests/WfhRequestsReviewSection";
import { WfhPolicyOverridesSection } from "../../features/admin/WfhPolicyOverridesSection";
import { PeopleAdministrationSection } from "../../features/admin/PeopleAdministrationSection";
import { OwnerTransfer } from "../../features/admin/owner-transfer/OwnerTransfer";
import { NotificationDeliveryOperationsSection } from "../../features/notifications/delivery-operations/NotificationDeliveryOperationsSection";
import {
  AvailabilityConfigurationLoadFailureSection,
  buildAuthorizedAdminPageSections,
  LeaveRequestsLoadFailureSection,
  RolePermissionsLoadFailureSection,
  type AdminPageSectionDefinitions,
  WfhRequestsReviewLoadFailureSection,
  WfhPolicyOverridesLoadFailureSection,
  PeopleAdministrationLoadFailureSection,
  OwnerTransferLoadFailureSection,
  AdminWorkLoadFailureSection,
} from "./admin-page-sections";
import type { AdminPageSectionId } from "./AdminPage";

const sectionIds: readonly AdminPageSectionId[] = [
  "organization-structure",
  "geofence",
  "attendance-policy",
  "availability-configuration",
  "wfh-overrides",
  "roles",
  "work",
  "people",
  "owner-transfer",
  "leave-review",
  "wfh-review",
  "historical-exceptions",
  "audit",
  "notification-delivery",
];

const baseDefinitions = Object.fromEntries(sectionIds.map((id) => [id, createElement("div", { "data-admin-test-section": id })])) as AdminPageSectionDefinitions;
const visibleIds = (read: Parameters<typeof buildAuthorizedAdminPageSections>[0]) =>
  buildAuthorizedAdminPageSections(read, baseDefinitions).map(({ id }) => id);

describe("Admin page feature visibility", () => {
  it("fails closed when the grant read is absent, malformed, or unavailable", () => {
    expect(visibleIds(undefined)).toEqual([]);
    expect(visibleIds({ grants: null })).toEqual([]);
    expect(visibleIds({ grants: [], readError: "REQUEST_FAILED" })).toEqual([]);
  });

  it("keeps the Admin full-roster section organization-scoped while separate directory scopes stay separate", () => {
    expect(visibleIds({ grants: [
      { permissionKey: "people.view", scope: "office", officeId: "office-7" },
    ] })).toEqual([]);

    expect(visibleIds({ grants: [
      { permissionKey: "people.view", scope: "organisation_department", organisationDepartmentId: "dept-4" },
    ] })).toEqual([]);

    expect(visibleIds({ grants: [
      { permissionKey: "people.view", scope: "own_record", selfApplicable: true },
    ] })).toEqual([]);

    expect(visibleIds({ grants: [
      { permissionKey: "people.view", scope: "organisation" },
    ] })).toEqual(["people", "audit"]);
  });

  it("allows organization-scoped invites to expose People without a directory grant", () => {
    expect(visibleIds({ grants: [
      { permissionKey: "people.invite", scope: "organisation" },
    ] })).toEqual(["people"]);
  });

  it("composes People as a typed lazy child only for organization invite or roster access", () => {
    const content = createElement(PeopleAdministrationSection, {
      canInvite: true,
      canViewPeople: false,
      peopleRead: { status: "unavailable", message: "Organization roster access is required." },
      people: [],
      onInvite: async () => ({ delivery: "sent", kind: "success", message: "Invitation sent." }),
      onResendInvitation: async () => {},
      onFreeze: async () => {},
      onStartOffboarding: async () => {},
      onCompleteExit: async () => {},
      onCompleteOnboarding: async () => {},
    });
    const inviteOnly = buildAuthorizedAdminPageSections({ grants: [
      { permissionKey: "people.invite", scope: "organisation" },
    ] }, { ...baseDefinitions, people: content });
    expect(inviteOnly).toEqual([{ id: "people", content }]);
    expect(inviteOnly[0]?.content?.type).toBe(PeopleAdministrationSection);
    expect(inviteOnly[0]?.content?.props.canViewPeople).toBe(false);

    for (const grants of [
      [{ permissionKey: "people.view", scope: "office", officeId: "office-7" }],
      [{ permissionKey: "people.view", scope: "organisation_department", organisationDepartmentId: "dept-4" }],
      [{ permissionKey: "people.view", scope: "own_record", selfApplicable: true }],
    ]) {
      expect(buildAuthorizedAdminPageSections({ grants }, { ...baseDefinitions, people: content }).map(({ id }) => id))
        .not.toContain("people");
    }
  });

  it("requires Super Admin and organization People access for owner transfer; delivery remains view-gated", () => {
    expect(visibleIds({ grants: [
      { permissionKey: "organisation.owner_transfer", scope: "organisation" },
      { permissionKey: "notifications.manage", scope: "organisation" },
    ] })).toEqual([]);

    expect(visibleIds({ grants: [], isSuperAdmin: true })).not.toContain("owner-transfer");
    expect(visibleIds({ grants: [
      { permissionKey: "people.view", scope: "organisation" },
    ], isSuperAdmin: true })).toContain("owner-transfer");
    expect(visibleIds({ grants: [
      { permissionKey: "notifications.delivery.view", scope: "organisation" },
    ] })).toEqual(["notification-delivery"]);
    expect(visibleIds({ grants: [], isSuperAdmin: true, readError: "REQUEST_FAILED" })).toEqual([]);
  });

  it("composes Owner Transfer as a typed child only for a healthy Super Admin read", () => {
    const content = createElement(OwnerTransfer, {
      canTransfer: true,
      read: { status: "unavailable" },
      onRetry() {},
    });
    const definitions = { ...baseDefinitions, "owner-transfer": content };
    const superAdmin = buildAuthorizedAdminPageSections({ grants: [
      { permissionKey: "people.view", scope: "organisation" },
    ], isSuperAdmin: true }, definitions);
    expect(superAdmin.map(({ id }) => id)).toEqual(["people", "owner-transfer", "audit"]);
    expect(superAdmin.find(({ id }) => id === "owner-transfer")).toEqual({ id: "owner-transfer", content });
    expect(superAdmin.find(({ id }) => id === "owner-transfer")?.content.type).toBe(OwnerTransfer);

    for (const read of [
      { grants: [{ permissionKey: "organisation.owner_transfer", scope: "organisation" }], isSuperAdmin: false },
      { grants: [{ permissionKey: "organisation.settings.manage", scope: "organisation" }], isSuperAdmin: false },
      { grants: [], isSuperAdmin: true },
      { grants: [{ permissionKey: "people.view", scope: "office", officeId: "office-7" }], isSuperAdmin: true },
      { grants: [], isSuperAdmin: true, readError: "REQUEST_FAILED" },
      { grants: null, isSuperAdmin: true },
    ]) {
      expect(buildAuthorizedAdminPageSections(read, definitions).map(({ id }) => id)).not.toContain("owner-transfer");
    }
  });

  it("does not infer ordinary Admin reads or sections from Super Admin status alone", () => {
    const read = { grants: [], isSuperAdmin: true };
    expect(visibleIds(read)).toEqual([]);
  });

  it("composes Organization Structure as a typed child only for organization settings management", () => {
    const content = createElement(OrganizationStructureSection, {
      canView: true,
      canManageOrganization: true,
      canManageOfficeGeofence: false,
      offices: { result: { offices: [] } },
      departments: { result: { departments: [] } },
      onCreateOffice() {},
      onCreateDepartment() {},
    });
    const organizationAccess = buildAuthorizedAdminPageSections({ grants: [
      { permissionKey: "organisation.settings.manage", scope: "organisation" },
    ] }, { ...baseDefinitions, "organization-structure": content });
    expect(organizationAccess.find(({ id }) => id === "organization-structure")).toEqual({
      id: "organization-structure", content,
    });
    expect(content.type).toBe(OrganizationStructureSection);
    expect(content.props.canManageOrganization).toBe(true);
    expect(content.props.canManageOfficeGeofence).toBe(false);

    const officeScoped = buildAuthorizedAdminPageSections({ grants: [
      { permissionKey: "organisation.settings.manage", scope: "office", officeId: "office-7" },
    ] }, { ...baseDefinitions, "organization-structure": content });
    expect(officeScoped.map(({ id }) => id)).not.toContain("organization-structure");

    const geofenceOnly = buildAuthorizedAdminPageSections({ grants: [
      { permissionKey: "availability.office_geofence.manage", scope: "organisation" },
    ] }, { ...baseDefinitions, "organization-structure": content });
    expect(geofenceOnly.map(({ id }) => id)).not.toContain("organization-structure");
  });

  it("composes Attendance Policy as a typed child only for organization-scoped settings management", () => {
    const content = createElement(AttendancePolicySettingsSection, {
      access: { status: "visible", manage: "allowed" },
      read: { status: "ready", policy: null },
      onSchedule() {},
    });
    const organizationAccess = buildAuthorizedAdminPageSections({ grants: [
      { permissionKey: "organisation.settings.manage", scope: "organisation" },
    ] }, { ...baseDefinitions, "attendance-policy": content });
    expect(organizationAccess.find(({ id }) => id === "attendance-policy")).toEqual({
      id: "attendance-policy",
      content,
    });
    expect(content.type).toBe(AttendancePolicySettingsSection);

    const officeAccess = buildAuthorizedAdminPageSections({ grants: [
      { permissionKey: "organisation.settings.manage", scope: "office", officeId: "office-7" },
    ] }, { ...baseDefinitions, "attendance-policy": content });
    expect(officeAccess.map(({ id }) => id)).not.toContain("attendance-policy");
  });

  it("composes Geofence as a typed child only for organization-scoped geofence management", () => {
    const content = createElement(OfficeGeofenceSettingsSection, {
      canManage: true,
      read: { status: "ready", offices: [] },
      onSave() {},
    });
    const organizationAccess = buildAuthorizedAdminPageSections({ grants: [
      { permissionKey: "availability.office_geofence.manage", scope: "organisation" },
    ] }, { ...baseDefinitions, geofence: content });
    expect(organizationAccess).toEqual([{ id: "geofence", content }]);
    expect(content.type).toBe(OfficeGeofenceSettingsSection);

    const officeAccess = buildAuthorizedAdminPageSections({ grants: [
      { permissionKey: "availability.office_geofence.manage", scope: "office", officeId: "office-7" },
    ] }, { ...baseDefinitions, geofence: content });
    expect(officeAccess.map(({ id }) => id)).not.toContain("geofence");
  });

  it("composes Availability configuration as a typed child for an organization-scoped resource grant", () => {
    const content = createElement(AvailabilityConfigurationSection, {
      availability: { visibility: { shifts: true }, shifts: [] },
      offices: { offices: [] },
      canReadOffices: false,
      capabilities: {
        shifts: { view: true, manage: false },
        calendars: { view: false, manage: false },
        holidays: { view: false, manage: false },
        shiftTargets: true,
      },
      onCreateShift: async () => {},
      onCreateCalendar: async () => {},
      onCreateHoliday: async () => {},
    });
    const organizationAccess = buildAuthorizedAdminPageSections({ grants: [
      { permissionKey: "availability.shift.view", scope: "organisation" },
    ] }, { ...baseDefinitions, "availability-configuration": content });
    expect(organizationAccess).toEqual([{ id: "availability-configuration", content }]);
    expect(content.type).toBe(AvailabilityConfigurationSection);

    const scopedOnly = buildAuthorizedAdminPageSections({ grants: [
      { permissionKey: "availability.shift.manage", scope: "office", officeId: "office-7" },
    ] }, { ...baseDefinitions, "availability-configuration": content });
    expect(scopedOnly.map(({ id }) => id)).not.toContain("availability-configuration");
  });

  it("keeps Leave Review and WFH Review as separate children behind their own effective grants", () => {
    const leaveContent = createElement(LeaveRequestsSection, {
      result: { requests: [] },
      actions: { status: "idle" },
      onReview: async () => {},
      onResolveConflict: async () => {},
    });
    const wfhContent = createElement(WfhRequestsReviewSection, {
      result: { requests: [] },
      onReview: async () => {},
    });
    const definitions = { ...baseDefinitions, "leave-review": leaveContent, "wfh-review": wfhContent };

    const leaveOnly = buildAuthorizedAdminPageSections({ grants: [
      { permissionKey: "leave.review", scope: "organisation" },
    ] }, definitions);
    expect(leaveOnly).toEqual([{ id: "leave-review", content: leaveContent }]);
    expect(leaveOnly[0]?.content?.type).toBe(LeaveRequestsSection);

    const wfhOnly = buildAuthorizedAdminPageSections({ grants: [
      { permissionKey: "availability.wfh.review", scope: "organisation_department", organisationDepartmentId: "dept-3" },
    ] }, definitions);
    expect(wfhOnly).toEqual([{ id: "wfh-review", content: wfhContent }]);
    expect(wfhOnly[0]?.content?.type).toBe(WfhRequestsReviewSection);

    const ownRecordOnly = buildAuthorizedAdminPageSections({ grants: [
      { permissionKey: "leave.review", scope: "own_record", selfApplicable: true },
      { permissionKey: "availability.wfh.review", scope: "own_record", selfApplicable: true },
    ] }, definitions);
    expect(ownRecordOnly.map(({ id }) => id)).not.toContain("leave-review");
    expect(ownRecordOnly.map(({ id }) => id)).not.toContain("wfh-review");
  });

  it("keeps WFH override visibility and management independent in its typed child", () => {
    const createContent = (canView: boolean, canManage: boolean) => createElement(WfhPolicyOverridesSection, {
      canView,
      canManage,
      policies: { authorized: canView, result: { policies: [] } },
      targets: {
        office: { authorized: false, result: { offices: [] } },
        organisation_department: { authorized: false, result: { departments: [] } },
        person: { authorized: false, result: { people: [] } },
      },
      onCreate: async () => {},
    });
    const viewOnlyContent = createContent(true, false);
    const viewOnly = buildAuthorizedAdminPageSections({ grants: [
      { permissionKey: "availability.wfh_policy.view", scope: "organisation" },
    ] }, { ...baseDefinitions, "wfh-overrides": viewOnlyContent });
    expect(viewOnly).toEqual([{ id: "wfh-overrides", content: viewOnlyContent }]);
    expect(viewOnly[0]?.content?.props.canView).toBe(true);
    expect(viewOnly[0]?.content?.props.canManage).toBe(false);

    const manageOnlyContent = createContent(false, true);
    const manageOnly = buildAuthorizedAdminPageSections({ grants: [
      { permissionKey: "availability.wfh_policy.manage", scope: "organisation" },
    ] }, { ...baseDefinitions, "wfh-overrides": manageOnlyContent });
    expect(manageOnly).toEqual([{ id: "wfh-overrides", content: manageOnlyContent }]);
    expect(manageOnly[0]?.content?.props.canView).toBe(false);
    expect(manageOnly[0]?.content?.props.canManage).toBe(true);

    for (const grants of [
      [{ permissionKey: "availability.wfh_policy.view", scope: "office", officeId: "office-7" }],
      [{ permissionKey: "availability.wfh_policy.manage", scope: "own_record", selfApplicable: true }],
    ]) {
      expect(buildAuthorizedAdminPageSections({ grants }, { ...baseDefinitions, "wfh-overrides": manageOnlyContent })
        .map(({ id }) => id)).not.toContain("wfh-overrides");
    }
  });

  it("composes historical exceptions from organization view access while resolving stays separately gated", () => {
    const viewOnly = { grants: [
      { permissionKey: "availability.exception.view", scope: "organisation" },
    ] };
    const viewOnlyContent = createElement(HistoricalExceptionsSection, {
      capabilities: { view: true, resolve: false },
      read: { status: "empty" },
      onResolve() {},
    });
    const viewOnlySections = buildAuthorizedAdminPageSections(viewOnly, {
      ...baseDefinitions,
      "historical-exceptions": viewOnlyContent,
    });
    expect(viewOnlySections).toEqual([{ id: "historical-exceptions", content: viewOnlyContent }]);
    expect(viewOnlySections[0]?.content?.type).toBe(HistoricalExceptionsSection);
    expect(viewOnlyContent.props.capabilities).toEqual({ view: true, resolve: false });

    const viewAndResolve = { grants: [
      { permissionKey: "availability.exception.view", scope: "organisation" },
      { permissionKey: "availability.exception.resolve", scope: "organisation" },
    ] };
    const viewAndResolveContent = createElement(HistoricalExceptionsSection, {
      capabilities: { view: true, resolve: true },
      read: { status: "empty" },
      onResolve() {},
    });
    expect(buildAuthorizedAdminPageSections(viewAndResolve, {
      ...baseDefinitions,
      "historical-exceptions": viewAndResolveContent,
    })).toEqual([{ id: "historical-exceptions", content: viewAndResolveContent }]);
    expect(viewAndResolveContent.props.capabilities.resolve).toBe(true);

    const officeView = { grants: [
      { permissionKey: "availability.exception.view", scope: "office", officeId: "office-7" },
      { permissionKey: "availability.exception.resolve", scope: "organisation" },
    ] };
    expect(buildAuthorizedAdminPageSections(officeView, {
      ...baseDefinitions,
      "historical-exceptions": viewAndResolveContent,
    }).map(({ id }) => id)).not.toContain("historical-exceptions");

    const resolveOnly = { grants: [
      { permissionKey: "availability.exception.resolve", scope: "organisation" },
    ] };
    expect(buildAuthorizedAdminPageSections(resolveOnly, {
      ...baseDefinitions,
      "historical-exceptions": viewAndResolveContent,
    })).toEqual([]);
  });

  it("composes Roles as a typed child under roles.view with create and edit capabilities kept separate", () => {
    const content = createElement(RolePermissionsSection, {
      canView: true,
      canCreate: false,
      canEdit: false,
      roles: { result: { roles: [] } },
      permissions: { result: { permissions: [] } },
      targetReads: {
        office: { result: { offices: [] }, rows: [], resource: "office scope targets" },
        organisation_department: { result: { departments: [] }, rows: [], resource: "department scope targets" },
        client: { result: { clients: [] }, rows: [], resource: "client scope targets" },
        client_workstream: { result: { clientWorkstreams: [] }, rows: [], resource: "client workstream scope targets" },
        group: { result: { groups: [] }, rows: [], resource: "group scope targets" },
      },
      formatError: () => undefined,
      onCreate() {},
      onUpdate() {},
    });
    const definitions = { ...baseDefinitions, roles: content };
    const viewOnly = { grants: [{ permissionKey: "roles.view", scope: "organisation" }] };
    expect(buildAuthorizedAdminPageSections(viewOnly, definitions)).toEqual([{ id: "roles", content }]);
    expect(content.type).toBe(RolePermissionsSection);
    expect(content.props.canCreate).toBe(false);
    expect(content.props.canEdit).toBe(false);

    const viewAndCreate = buildAuthorizedAdminPageSections({ grants: [
      { permissionKey: "roles.view", scope: "organisation" },
      { permissionKey: "roles.create", scope: "organisation" },
    ] }, { ...baseDefinitions, roles: createElement(RolePermissionsSection, { ...content.props, canCreate: true }) });
    expect(viewAndCreate[0]?.id).toBe("roles");
    expect(viewAndCreate[0]?.content?.type).toBe(RolePermissionsSection);
    expect(viewAndCreate[0]?.content?.props.canCreate).toBe(true);
    expect(viewAndCreate[0]?.content?.props.canEdit).toBe(false);

    const viewAndEdit = buildAuthorizedAdminPageSections({ grants: [
      { permissionKey: "roles.view", scope: "organisation" },
      { permissionKey: "roles.edit", scope: "organisation" },
    ] }, { ...baseDefinitions, roles: createElement(RolePermissionsSection, { ...content.props, canEdit: true }) });
    expect(viewAndEdit[0]?.content?.props.canCreate).toBe(false);
    expect(viewAndEdit[0]?.content?.props.canEdit).toBe(true);

    for (const grants of [
      [{ permissionKey: "roles.assign", scope: "organisation" }],
      [{ permissionKey: "roles.create", scope: "organisation" }],
      [{ permissionKey: "roles.view", scope: "office", officeId: "office-7" }],
    ]) {
      expect(buildAuthorizedAdminPageSections({ grants }, definitions).map(({ id }) => id)).not.toContain("roles");
    }
  });

  it("keeps each feature in the established page order and composes only authorized sections", () => {
    const read = {
      grants: [
        { permissionKey: "organisation.settings.manage", scope: "organisation" },
        { permissionKey: "availability.office_geofence.manage", scope: "organisation" },
        { permissionKey: "people.view", scope: "organisation_department", organisationDepartmentId: "dept-4" },
        { permissionKey: "leave.review", scope: "office", officeId: "office-7" },
      ],
    };
    expect(visibleIds(read)).toEqual([
      "organization-structure",
      "geofence",
      "attendance-policy",
      "leave-review",
    ]);
    expect(buildAuthorizedAdminPageSections(read, baseDefinitions).every(({ content }) => isValidElement(content))).toBe(true);
  });

  it("keeps typed feature content inside the same grant-filtered page composition", () => {
    const deliveryContent = (grants: Parameters<typeof buildAuthorizedAdminPageSections>[0]) => createElement(NotificationDeliveryOperationsSection, {
      readState: { status: "ready", deliveries: [], limit: 50 },
      canRequeue: hasPermissionGrant(grants, "notifications.manage"),
      onRetryRead() {},
      onRequeue() {},
    });
    const auditContent = createElement("section", { "aria-label": "Recent audit activity" }, "Safe audit rows");
    const viewOnlyRead = { grants: [
      { permissionKey: "notifications.delivery.view", scope: "organisation" },
    ] };
    const viewOnlyContent = deliveryContent(viewOnlyRead);
    const definitions = { ...baseDefinitions, audit: auditContent, "notification-delivery": viewOnlyContent };

    const visible = buildAuthorizedAdminPageSections({ grants: [
      { permissionKey: "people.view", scope: "organisation" },
    ] }, definitions);
    expect(visible.map(({ id }) => id)).toEqual(["people", "audit"]);
    expect(visible.find(({ id }) => id === "audit")).toEqual({ id: "audit", content: auditContent });

    const hidden = buildAuthorizedAdminPageSections({ grants: [
      { permissionKey: "people.view", scope: "office", officeId: "office-7" },
    ] }, definitions);
    expect(hidden).toEqual([]);

    const deliveryViewOnly = buildAuthorizedAdminPageSections(viewOnlyRead, definitions);
    expect(deliveryViewOnly).toEqual([{ id: "notification-delivery", content: viewOnlyContent }]);
    expect(deliveryViewOnly[0]?.content?.type).toBe(NotificationDeliveryOperationsSection);
    expect(viewOnlyContent.props.canRequeue).toBe(false);

    const viewAndManageRead = { grants: [
      { permissionKey: "notifications.delivery.view", scope: "organisation" },
      { permissionKey: "notifications.manage", scope: "organisation" },
    ] };
    const viewAndManageContent = deliveryContent(viewAndManageRead);
    const viewAndManageSections = buildAuthorizedAdminPageSections(viewAndManageRead, {
      ...definitions,
      "notification-delivery": viewAndManageContent,
    });
    expect(viewAndManageSections[0]?.content?.type).toBe(NotificationDeliveryOperationsSection);
    expect(viewAndManageContent.props.canRequeue).toBe(true);

    const officeManageRead = { grants: [
      { permissionKey: "notifications.delivery.view", scope: "organisation" },
      { permissionKey: "notifications.manage", scope: "office", officeId: "office-7" },
    ] };
    const officeManageContent = deliveryContent(officeManageRead);
    const officeManageSections = buildAuthorizedAdminPageSections(officeManageRead, {
      ...definitions,
      "notification-delivery": officeManageContent,
    });
    expect(officeManageSections[0]?.content?.type).toBe(NotificationDeliveryOperationsSection);
    expect(officeManageContent.props.canRequeue).toBe(false);

    const deliveryManageOnly = buildAuthorizedAdminPageSections({ grants: [
      { permissionKey: "notifications.manage", scope: "organisation" },
    ] }, definitions);
    expect(deliveryManageOnly).toEqual([]);
  });
});

describe("Roles chunk-load fallback", () => {
  it("keeps the feature heading and uses the design-system assertive error state", () => {
    const html = renderToStaticMarkup(createElement(RolePermissionsLoadFailureSection));
    const css = readFileSync(
      new URL("../../features/admin/roles/RolePermissionsLoadFailureSection.module.css", import.meta.url),
      "utf8",
    );

    expect(html).toContain('aria-labelledby="admin-role-permissions-title"');
    expect(html).toContain("Roles and permissions");
    expect(html).toContain('role="alert"');
    expect(html).toContain("Role and permission controls could not load");
    expect(css).toContain("var(--nova-space-4)");
    expect(css).toContain("var(--nova-color-text-primary)");
    expect(css).not.toMatch(/#[0-9a-f]{3,8}\b/i);
  });
});

describe("Availability configuration chunk-load fallback", () => {
  it("keeps the feature heading and uses semantic token styles", () => {
    const html = renderToStaticMarkup(createElement(AvailabilityConfigurationLoadFailureSection));
    const css = readFileSync(
      new URL("../../features/availability/AvailabilityConfigurationFallback.module.css", import.meta.url),
      "utf8",
    );

    expect(html).toContain('aria-labelledby="admin-availability-configuration-title"');
    expect(html).toContain("Availability configuration");
    expect(html).toContain('role="alert"');
    expect(html).toContain("Reload Admin to try again");
    expect(css).toContain("var(--nova-space-4)");
    expect(css).toContain("var(--nova-color-text-primary)");
    expect(css).not.toMatch(/#[0-9a-f]{3,8}\b/i);
  });
});

describe("Leave and WFH review chunk-load fallbacks", () => {
  it("keeps each failed review feature independently labeled with tokenized styles", async () => {
    const leaveHtml = renderToStaticMarkup(createElement(LeaveRequestsLoadFailureSection));
    const leaveCss = await Bun.file(new URL(
      "../../features/admin/leave-requests/LeaveRequestsFallback.module.css",
      import.meta.url,
    )).text();
    expect(leaveHtml).toContain("Leave review");
    expect(leaveHtml).toContain('role="alert"');
    expect(leaveHtml).toContain("Reload Admin to try again");
    expect(leaveCss).toContain("var(--nova-space-4)");
    expect(leaveCss).not.toMatch(/#[0-9a-f]{3,8}\b/i);

    const wfhHtml = renderToStaticMarkup(createElement(WfhRequestsReviewLoadFailureSection));
    const wfhCss = await Bun.file(new URL(
      "../../features/admin/wfh-requests/WfhRequestsReviewFallback.module.css",
      import.meta.url,
    )).text();
    expect(wfhHtml).toContain("WFH request review");
    expect(wfhHtml).toContain('role="alert"');
    expect(wfhHtml).toContain("Reload Admin to try again");
    expect(wfhCss).toContain("var(--nova-space-4)");
    expect(wfhCss).not.toMatch(/#[0-9a-f]{3,8}\b/i);
  });
});

describe("WFH policy override chunk-load fallback", () => {
  it("keeps its one feature heading and semantic loading/error surface", () => {
    const html = renderToStaticMarkup(createElement(WfhPolicyOverridesLoadFailureSection));
    const css = readFileSync(new URL(
      "../../features/admin/WfhPolicyOverridesSection.module.css",
      import.meta.url,
    ), "utf8");
    expect(html).toContain('aria-labelledby="admin-wfh-policy-overrides-title"');
    expect(html).toContain("WFH eligibility overrides");
    expect(html).toContain('role="alert"');
    expect(html).toContain("Reload Admin to try again");
    expect(css).toContain("var(--nova-space-4)");
    expect(css).not.toMatch(/#[0-9a-f]{3,8}\b/i);
  });
});

describe("People chunk-load fallback", () => {
  it("keeps the People feature heading and tokenized loading/error states", async () => {
    const html = renderToStaticMarkup(createElement(PeopleAdministrationLoadFailureSection));
    const css = await Bun.file(new URL(
      "../../features/admin/PeopleAdministrationFallback.module.css",
      import.meta.url,
    )).text();
    expect(html).toContain('aria-labelledby="admin-people-administration-title"');
    expect(html).toContain("People and onboarding");
    expect(html).toContain('role="alert"');
    expect(html).toContain("Reload Admin to try again");
    expect(css).toContain("var(--nova-space-4)");
    expect(css).not.toMatch(/#[0-9a-f]{3,8}\b/i);
  });
});

describe("Owner Transfer chunk-load fallback", () => {
  it("keeps a protected feature heading and semantic error state", () => {
    const html = renderToStaticMarkup(createElement(OwnerTransferLoadFailureSection));
    const css = readFileSync(new URL(
      "../../features/admin/owner-transfer/OwnerTransferFallback.module.css",
      import.meta.url,
    ), "utf8");
    expect(html).toContain('aria-labelledby="admin-owner-transfer-title"');
    expect(html).toContain("Ownership transfer");
    expect(html).toContain('role="alert"');
    expect(html).toContain("Reload Admin to try again");
    expect(css).toContain("var(--nova-space-4)");
    expect(css).not.toMatch(/#[0-9a-f]{3,8}\b/i);
  });
});

describe("Admin Work composition chunk-load fallback", () => {
  it("keeps the feature identity and leaves sibling Admin sections available", () => {
    const html = renderToStaticMarkup(createElement(AdminWorkLoadFailureSection));
    const css = readFileSync(new URL(
      "../../features/admin/work/AdminWorkFallback.module.css",
      import.meta.url,
    ), "utf8");
    expect(html).toContain("Client work and task operations");
    expect(html).toContain("Work tools could not load");
    expect(html).toContain("Other authorized Admin sections remain available.");
    expect(css).toContain("var(--nova-space-4)");
    expect(css).not.toMatch(/#[0-9a-f]{3,8}\b/i);
  });
});
