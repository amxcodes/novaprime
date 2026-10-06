import { createElement } from "react";
import {
  canShowAdminFeature,
  hasAnyPermissionGrant,
  planAdminReads,
  adminReadIssue,
} from "../admin-read-state.js";
import {
  canInviteAdminPeople,
  canShowOwnerTransfer,
  canViewAdminPeople,
} from "../src/features/admin/capabilities.ts";
import { canRenderLeaveConflictAction, canRenderRequestReviewActions } from "../review-actions.js";
import { describeInvitationFeedback } from "../src/features/admin/invitation-feedback.ts";
import { resolveAdminNotificationFocus } from "./admin-notification-focus.js";
import { projectTaskComposerOptions } from "./task-composer-route.js";
import { projectAuditEventsReadState } from "../src/features/admin/audit/projection.ts";
import { projectNotificationDeliveryReadState } from "../src/features/notifications/delivery-operations/projection.ts";
import { projectAttendancePolicySettingsProps } from "./admin-attendance-policy-route.js";
import { projectOfficeGeofenceSettingsProps } from "../src/features/admin/office-geofence-projection.ts";
import { projectHistoricalExceptionsReadState } from "../src/features/admin/exceptions/projection.ts";

/**
 * Admin page composition stays separate from the application router. The host
 * injects current identity, server transport, command guards, and page mounting.
 */
export function loadAdminFeatureModule(authorized, load) {
  if (!authorized) return Promise.resolve(null);
  return Promise.resolve().then(load).catch(() => null);
}

export function createAdminPageRoute(host) {
  const {
    state,
    getTarget,
    isCurrentPageRequest,
    mountAdminPage,
    hasPermissionGrant,
    captureCommandContext,
    isCurrentCommand,
    isCurrentCommandIdentity,
    recoverProtectedCommandFailure,
    api,
    pageApi,
    requestOptions,
    errorText,
    adminCommandUiError,
    adminFeatureReadError,
    hasAdminPermission,
    runAdminProtectedCommand,
    runAdminRequestReviewCommand,
    saveAdminRole,
    setMessage,
    showFeedback,
    loadAdmin,
    render,
    taskCreateIdempotencyHeaders,
    clearTaskCreateIdempotency,
    reflectInvitationDelivery,
    taskBillingConfirmation,
    taskCorrectionConfirmation,
    isWithinApp,
    errorMessages,
  } = host;
  const requiredFunctions = {
    getTarget, isCurrentPageRequest, mountAdminPage, hasPermissionGrant, captureCommandContext,
    isCurrentCommand, isCurrentCommandIdentity, recoverProtectedCommandFailure, api, pageApi,
    requestOptions, errorText, adminCommandUiError, adminFeatureReadError,
    hasAdminPermission, runAdminProtectedCommand, runAdminRequestReviewCommand, saveAdminRole,
    setMessage, showFeedback, loadAdmin, render, taskCreateIdempotencyHeaders,
    clearTaskCreateIdempotency, reflectInvitationDelivery, taskBillingConfirmation, taskCorrectionConfirmation, isWithinApp,
  };
  for (const [name, service] of Object.entries(requiredFunctions)) {
    if (typeof service !== "function") throw new TypeError("Admin route service " + name + " must be a function");
  }

  let adminWorkContentRevision = 0;

  return async function renderAdminContent(data, lifetime) {

  const target = getTarget();
  if (!target || !isCurrentPageRequest(lifetime)) return;
  const identityEpoch = state.identityEpoch;
  const adminWorkVisible = canShowAdminFeature(data.actorGrants, "work");
  const adminWorkReadPlan = planAdminReads(data.actorGrants);
  const adminContextCreationVisible = adminWorkVisible && hasAnyPermissionGrant(data.actorGrants,
    ["clients.create", "workstreams.create", "groups.create"], ["organisation", "client", "client_workstream"]);
  const adminTaskCreationVisible = adminWorkVisible && hasAnyPermissionGrant(data.actorGrants,
    ["tasks.create"], ["organisation", "client", "client_workstream", "group"]);
  const adminMembershipVisible = adminWorkVisible && hasAnyPermissionGrant(data.actorGrants,
    ["clients.members.manage"], ["organisation", "client"]);
  const featureLoadFailure = (feature) => createElement(
    "p",
    { role: "alert" },
    feature + " could not load. Reload Admin to try again.",
  );
  const [adminPageSections, roleSectionModule, roleScopeTargetsRouteModule, organizationStructureModule, availabilityConfigurationModule,
    availabilityPickerSearchModule,
    officeGeofenceModule, attendancePolicyModule,
    wfhPolicyOverridesModule, wfhPolicyOverridesRouteModule, wfhPolicyTargetSearchModule, peopleModule, peopleRouteModule,
    ownerTransferModule, ownerTransferRouteModule,
    leaveReviewModule, wfhReviewModule, adminWorkModule, adminWorkCompositionModule,
    historicalExceptionsModule, auditModule, notificationDeliveryModule,
    adminWorkContextCreationModule, adminWorkContextCreationRouteModule,
    adminTaskComposerModule, adminTaskComposerRouteModule,
    adminWorkOperationsModule, adminWorkOperationsRouteModule,
    adminMembershipTargetsModule, adminClientMembershipsRouteModule] = await Promise.all([
    import("../src/pages/admin/admin-page-sections.ts"),
    loadAdminFeatureModule(canShowAdminFeature(data.actorGrants, "roles"), () => import("../src/features/admin/roles/RolePermissionsSection.tsx")),
    loadAdminFeatureModule(canShowAdminFeature(data.actorGrants, "roles"), () => import("./admin-role-scope-targets-route.js")),
    loadAdminFeatureModule(canShowAdminFeature(data.actorGrants, "organisationStructure"), () => import("../src/features/admin/organization/OrganizationStructureSection.tsx")),
    loadAdminFeatureModule(canShowAdminFeature(data.actorGrants, "availabilityConfiguration"), () => import("../src/features/availability/AvailabilityConfigurationSection.tsx")),
    loadAdminFeatureModule(canShowAdminFeature(data.actorGrants, "availabilityConfiguration"), () => import("./admin-availability-picker-search-route.js")),
    loadAdminFeatureModule(canShowAdminFeature(data.actorGrants, "geofence"), () => import("../src/features/admin/OfficeGeofenceSettingsSection.tsx")),
    loadAdminFeatureModule(canShowAdminFeature(data.actorGrants, "attendancePolicy"), () => import("../src/features/admin/attendance-policy/AttendancePolicySettingsSection.tsx")),
    loadAdminFeatureModule(canShowAdminFeature(data.actorGrants, "wfhOverrides"), () => import("../src/features/admin/WfhPolicyOverridesSection.tsx")),
    loadAdminFeatureModule(canShowAdminFeature(data.actorGrants, "wfhOverrides"), () => import("./admin-wfh-policy-overrides-route.js")),
    loadAdminFeatureModule(canShowAdminFeature(data.actorGrants, "wfhOverrides"), () => import("./admin-wfh-policy-target-search-route.js")),
    loadAdminFeatureModule(canInviteAdminPeople(data.actorGrants) || canViewAdminPeople(data.actorGrants), () => import("../src/features/admin/PeopleAdministrationSection.tsx")),
    loadAdminFeatureModule(canInviteAdminPeople(data.actorGrants) || canViewAdminPeople(data.actorGrants), () => import("./admin-people-route.js")),
    loadAdminFeatureModule(canShowOwnerTransfer(data.actorGrants), () => import("../src/features/admin/owner-transfer/index.ts")),
    loadAdminFeatureModule(canShowOwnerTransfer(data.actorGrants), () => import("./admin-owner-transfer-route.js")),
    loadAdminFeatureModule(canShowAdminFeature(data.actorGrants, "leaveReview"), () => import("../src/features/admin/leave-requests/LeaveRequestsSection.tsx")),
    loadAdminFeatureModule(canShowAdminFeature(data.actorGrants, "wfhReview"), () => import("../src/features/admin/wfh-requests/WfhRequestsReviewSection.tsx")),
    loadAdminFeatureModule(adminWorkVisible, () => import("../src/features/admin/work/AdminWorkSection.tsx")),
    loadAdminFeatureModule(adminWorkVisible, () => import("./admin-work-composition.js")),
    loadAdminFeatureModule(canShowAdminFeature(data.actorGrants, "historicalExceptions"), () => import("../src/features/admin/exceptions/HistoricalExceptionsSection.tsx")),
    loadAdminFeatureModule(canShowAdminFeature(data.actorGrants, "audit"), () => import("../src/features/admin/audit/AuditEventsSection.tsx")),
    loadAdminFeatureModule(canShowAdminFeature(data.actorGrants, "notificationDelivery"), () => import("../src/features/notifications/delivery-operations/NotificationDeliveryOperationsSection.tsx")),
    loadAdminFeatureModule(adminContextCreationVisible, () => import("../src/features/work-context/WorkContextCreation.tsx")),
    loadAdminFeatureModule(adminContextCreationVisible, () => import("./admin-work-context-creation-route.js")),
    loadAdminFeatureModule(adminTaskCreationVisible, () => import("../src/features/work/task-composer/TaskComposer.tsx")),
    loadAdminFeatureModule(adminTaskCreationVisible, () => import("./admin-task-composer-route.js")),
    loadAdminFeatureModule(adminWorkReadPlan.tasks, () => import("../src/features/admin/work-operations/WorkOperations.tsx")),
    loadAdminFeatureModule(adminWorkReadPlan.tasks, () => import("./admin-work-operations-route.js")),
    loadAdminFeatureModule(adminMembershipVisible, () => import("../src/features/work-context/AdminClientMembershipTargets.tsx")),
    loadAdminFeatureModule(adminMembershipVisible, () => import("./admin-client-memberships-route.js")),
  ]);
  if (!target.isConnected || !isCurrentPageRequest(lifetime) || identityEpoch !== state.identityEpoch || state.adminData !== data) return;
  const {
    buildAuthorizedAdminPageSections,
    AvailabilityConfigurationLoadFailureSection,
    LeaveRequestsLoadFailureSection,
    OrganizationStructureLoadFailureSection,
    RolePermissionsLoadFailureSection,
    OwnerTransferLoadFailureSection,
    WfhPolicyOverridesLoadFailureSection,
    PeopleAdministrationLoadFailureSection,
    WfhRequestsReviewLoadFailureSection,
    AdminWorkLoadFailureSection,
  } = adminPageSections;
  const RolePermissionsSection = roleSectionModule?.RolePermissionsSection;
  const roleScopeTargetsRoute = RolePermissionsSection && hasAdminPermission(data, "roles.view")
    ? roleScopeTargetsRouteModule?.createAdminRoleScopeTargetsRoute({
      state,
      target,
      lifetime,
      identityEpoch,
      isCurrentPageRequest,
      hasAdminPermission,
      pageApi,
      captureCommandContext,
      isCurrentCommand,
      recoverProtectedCommandFailure,
      adminCommandUiError,
    })
    : undefined;
  const searchRoleScopeTargets = roleScopeTargetsRoute?.searchTargets ?? (async () => {
    throw adminCommandUiError("Role scope search could not load. Reload Admin and try again.");
  });
  const OrganizationStructureSection = organizationStructureModule?.OrganizationStructureSection;
  const OfficeGeofenceSettings = canShowAdminFeature(state.adminData?.actorGrants, "geofence")
    ? officeGeofenceModule?.OfficeGeofenceSettingsSection
    : undefined;
  const AttendancePolicySettings = canShowAdminFeature(state.adminData?.actorGrants, "attendancePolicy")
    ? attendancePolicyModule?.AttendancePolicySettingsSection
    : undefined;
  const AvailabilityConfigurationSection = canShowAdminFeature(
    state.adminData?.actorGrants,
    "availabilityConfiguration",
  ) ? availabilityConfigurationModule?.AvailabilityConfigurationSection : undefined;
  const WfhPolicyOverridesSection = canShowAdminFeature(
    state.adminData?.actorGrants,
    "wfhOverrides",
  ) ? wfhPolicyOverridesModule?.WfhPolicyOverridesSection : undefined;
  const availabilityPickerSearchRoute = AvailabilityConfigurationSection
    ? availabilityPickerSearchModule?.createAvailabilityPickerSearchRoute({
      state,
      target,
      lifetime,
      isCurrentPageRequest,
      hasPermissionGrant,
      pageApi,
      captureCommandContext,
      isCurrentCommand,
      isCurrentCommandIdentity,
      recoverProtectedCommandFailure,
      errorText,
      adminCommandUiError,
    })
    : undefined;
  const wfhPolicyTargetSearchRoute = WfhPolicyOverridesSection
    ? wfhPolicyTargetSearchModule?.createWfhPolicyTargetSearchRoute({
      state,
      target,
      lifetime,
      isCurrentPageRequest,
      canShowAdminFeature,
      hasPermissionGrant,
      canViewAdminPeople,
      pageApi,
      captureCommandContext,
      isCurrentCommand,
      isCurrentCommandIdentity,
      errorText,
      adminCommandUiError,
      recoverProtectedCommandFailure,
    })
    : undefined;
  const wfhPolicyOverridesRoute = WfhPolicyOverridesSection && canShowAdminFeature(
    state.adminData?.actorGrants,
    "wfhOverrides",
  ) ? wfhPolicyOverridesRouteModule?.createWfhPolicyOverridesRoute({
    state,
    target,
    lifetime,
    isCurrentPageRequest,
    canShowAdminFeature,
    hasPermissionGrant,
    canViewAdminPeople,
    searchTargets: wfhPolicyTargetSearchRoute?.searchTargets ?? (async () => {
      throw adminCommandUiError("WFH target search could not load. Reload Admin and try again.");
    }),
    captureCommandContext,
    isCurrentCommand,
    isCurrentCommandIdentity,
    recoverProtectedCommandFailure,
    api,
    pageApi,
    requestOptions,
    errorText,
    adminCommandUiError,
    adminReadIssue,
    setMessage,
    renderAdminContent: (currentData, currentLifetime) => renderAdminContent(currentData, currentLifetime),
    showFeedback,
  }) : undefined;
  const PeopleAdministrationSection = canInviteAdminPeople(state.adminData?.actorGrants) ||
    canViewAdminPeople(state.adminData?.actorGrants)
    ? peopleModule?.PeopleAdministrationSection
    : undefined;
  const peopleRoute = PeopleAdministrationSection &&
    (canInviteAdminPeople(state.adminData?.actorGrants) || canViewAdminPeople(state.adminData?.actorGrants))
    ? peopleRouteModule?.createAdminPeopleRoute({
      state,
      target,
      lifetime,
      identityEpoch,
      isCurrentPageRequest,
      canInviteAdminPeople,
      canViewAdminPeople,
      pageApi,
      hasPermissionGrant,
      adminReadIssue,
      adminCommandUiError,
      runProtectedCommand: (permissionCheck, permissionTarget, path, payload, successMessage, afterSuccess) =>
        runAdminProtectedCommand(
          target,
          lifetime,
          permissionCheck,
          permissionTarget,
          "POST",
          path,
          payload,
          successMessage,
          afterSuccess,
        ),
      describeInvitationFeedback,
      reflectInvitationDelivery,
      errorText,
    })
    : undefined;
  const LeaveRequestsSection = canShowAdminFeature(
    state.adminData?.actorGrants,
    "leaveReview",
  ) ? leaveReviewModule?.LeaveRequestsSection : undefined;
  const WfhRequestsReviewSection = canShowAdminFeature(
    state.adminData?.actorGrants,
    "wfhReview",
  ) ? wfhReviewModule?.WfhRequestsReviewSection : undefined;
  const HistoricalExceptions = canShowAdminFeature(state.adminData?.actorGrants, "historicalExceptions")
    ? historicalExceptionsModule?.HistoricalExceptionsSection
    : undefined;
  const AuditEvents = canShowAdminFeature(state.adminData?.actorGrants, "audit")
    ? auditModule?.AuditEventsSection
    : undefined;
  const NotificationDeliveryOperations = canShowAdminFeature(state.adminData?.actorGrants, "notificationDelivery")
    ? notificationDeliveryModule?.NotificationDeliveryOperationsSection
    : undefined;
  const OwnerTransfer = canShowOwnerTransfer(state.adminData?.actorGrants)
    ? ownerTransferModule?.OwnerTransfer
    : undefined;
  const ownerTransferRoute = OwnerTransfer && canShowOwnerTransfer(state.adminData?.actorGrants)
    ? ownerTransferRouteModule?.createOwnerTransferRoute({
      state,
      target,
      lifetime,
      isCurrentPageRequest,
      canViewAdminPeople,
      pageApi,
      runAdminProtectedCommand,
      renderAdmin,
      adminCommandUiError,
    })
    : undefined;
  const createAdminWorkComposition = adminWorkCompositionModule?.createAdminWorkComposition;
  const adminWorkContent = !adminWorkVisible
    ? null
    : typeof createAdminWorkComposition !== "function"
      ? createElement(AdminWorkLoadFailureSection)
      : createAdminWorkComposition({
        data,
        state,
        target,
        lifetime,
        identityEpoch,
        revision: ++adminWorkContentRevision,
        fallback: AdminWorkLoadFailureSection,
        modules: {
          AdminWorkSection: adminWorkModule?.AdminWorkSection,
          AdminWorkFeatureFailure: adminWorkModule?.AdminWorkFeatureFailure,
          WorkContextCreation: adminWorkContextCreationModule?.WorkContextCreation,
          TaskComposer: adminTaskComposerModule?.TaskComposer,
          WorkOperations: adminWorkOperationsModule?.WorkOperations,
          AdminClientMembershipTargets: adminMembershipTargetsModule?.AdminClientMembershipTargets,
          AdminClientMembershipEditor: adminMembershipTargetsModule?.AdminClientMembershipEditor,
          adminWorkContextCreationRoute: adminWorkContextCreationRouteModule?.createAdminWorkContextCreationRoute,
          adminTaskComposerRoute: adminTaskComposerRouteModule?.createAdminTaskComposerRoute,
          adminWorkOperationsRoute: adminWorkOperationsRouteModule?.createAdminWorkOperationsRoute,
          adminClientMembershipsRoute: adminClientMembershipsRouteModule?.createAdminClientMembershipsRoute,
        },
        host: {
          canShowAdminFeature,
          hasAdminPermission,
          hasAnyPermissionGrant,
          planAdminReads,
          isCurrentPageRequest,
          adminReadIssue,
          adminFeatureReadError,
          adminCommandUiError,
          runAdminProtectedCommand,
          pageApi,
          requestOptions,
          errorText,
          setMessage,
          taskCreateIdempotencyHeaders,
          clearTaskCreateIdempotency,
          taskBillingConfirmation,
          taskCorrectionConfirmation,
          projectTaskComposerOptions,
          canViewAdminPeople,
          captureCommandContext,
          isCurrentCommand,
          isCurrentCommandIdentity,
          recoverProtectedCommandFailure,
          api,
          isWithinApp: (node) => app.contains(node),
        },
      });
  const organisation = data.organisation.organisation;
  const actorPermissionIssue = adminReadIssue(data.actorGrants, "your current action permissions");
  const routeWarning = actorPermissionIssue
    ? actorPermissionIssue.message + " Write controls are hidden until this can be refreshed."
    : undefined;
  const adminNotificationFocus = resolveAdminNotificationFocus(
    window.location.search,
    data.actorGrants,
    canShowAdminFeature,
  );
  let summary;
  if (organisation) {
    const peopleSummary = data.people.readState === "not-requested"
      ? ""
      : data.people.readError
        ? " · people list unavailable"
        : " · " + data.people.people.length + " people";
    summary = organisation.name + peopleSummary;
  }

  const createAvailabilityConfiguration = async (permission, path, input, successMessage) => {
    if (!target.isConnected || !isCurrentPageRequest(lifetime) || state.adminData !== data ||
        !canShowAdminFeature(state.adminData?.actorGrants, "availabilityConfiguration")) {
      throw new Error("The Admin page changed before this availability action could start. Refresh and try again.");
    }
    if (!hasAdminPermission(state.adminData, permission)) {
      throw new Error("Your current access no longer allows this availability change. Refresh Admin to check access.");
    }
    const context = captureCommandContext(target);
    if (!isCurrentCommand(context)) return;
    try {
      await api(path, requestOptions("POST", input));
    } catch (error) {
      if (!isCurrentCommandIdentity(context)) return;
      if (recoverProtectedCommandFailure(error, context)) return;
      if (!isCurrentCommand(context)) return;
      throw new Error(errorText(error));
    }
    if (!isCurrentCommand(context)) return;
    setMessage(successMessage);
    showFeedback();
    render();
  };

  const availability = data.availability || {};
  const availabilityConfigurationProps = {
    availability,
    availabilityIssue: adminReadIssue(data.availability, "availability configuration"),
    offices: data.offices,
    officesIssue: adminReadIssue(data.offices, "offices for availability configuration"),
    canReadOffices: hasAdminPermission(data, "organisation.settings.manage"),
    searchOffices: availabilityPickerSearchRoute?.searchOffices ?? (async () => {
      throw adminCommandUiError("Availability target search could not load. Reload Admin and try again.");
    }),
    searchShifts: availabilityPickerSearchRoute?.searchShifts ?? (async () => {
      throw adminCommandUiError("Availability target search could not load. Reload Admin and try again.");
    }),
    capabilities: {
      shifts: {
        view: hasAdminPermission(data, "availability.shift.view"),
        manage: hasAdminPermission(data, "availability.shift.manage"),
      },
      calendars: {
        view: hasAdminPermission(data, "availability.calendar.view"),
        manage: hasAdminPermission(data, "availability.calendar.manage"),
      },
      holidays: {
        view: hasAdminPermission(data, "availability.holiday.view"),
        manage: hasAdminPermission(data, "availability.holiday.manage"),
      },
      shiftTargets:
        hasAdminPermission(data, "availability.shift.view") ||
        hasAdminPermission(data, "availability.shift.manage") ||
        hasAdminPermission(data, "availability.calendar.manage"),
    },
    onCreateShift: (input) => createAvailabilityConfiguration(
      "availability.shift.manage",
      "/api/availability/shifts",
      input,
      "Shift created.",
    ),
    onCreateCalendar: (input) => createAvailabilityConfiguration(
      "availability.calendar.manage",
      "/api/availability/calendars",
      input,
      "Working calendar created and assigned to the office.",
    ),
    onCreateHoliday: (input) => createAvailabilityConfiguration(
      "availability.holiday.manage",
      "/api/availability/holidays",
      input,
      "Holiday added.",
    ),
  };

  const leaveReviewProps = {
    result: data.leavePending,
    failure: adminFeatureReadError(data.leavePending, "pending leave requests"),
    focusRequestId: adminNotificationFocus?.kind === "leave" ? adminNotificationFocus.requestId : null,
    actions: { status: "idle" },
    formatError: (error) => error?.uiMessage === true && typeof error.message === "string"
      ? error.message
      : errorText(error),
    onReview: async (requestId, decision) => {
      const request = data.leavePending?.requests?.find((item) => item.id === requestId);
      if (!canRenderRequestReviewActions(request) || request.hasConflict === true) {
        throw adminCommandUiError("This request is no longer eligible for ordinary leave review.");
      }
      await runAdminRequestReviewCommand(
        target, lifetime, data,
        "/api/leave/" + encodeURIComponent(requestId) + "/review",
        { decision },
        decision === "approved" ? "Leave approved." : "Leave rejected.",
      );
    },
    onResolveConflict: async (requestId, decision, note) => {
      const request = data.leavePending?.requests?.find((item) => item.id === requestId);
      if (!canRenderLeaveConflictAction(request)) {
        throw adminCommandUiError("Attendance recovery access is no longer available for this request.");
      }
      await runAdminRequestReviewCommand(
        target, lifetime, data,
        "/api/leave/" + encodeURIComponent(requestId) + "/resolve-conflict",
        { decision, note },
        decision === "approved"
          ? "Leave approved; attendance was preserved."
          : "Leave rejected; attendance was preserved.",
      );
    },
  };

  const wfhReviewProps = {
    result: data.wfhPending,
    failure: adminFeatureReadError(data.wfhPending, "pending WFH requests"),
    focusRequestId: adminNotificationFocus?.kind === "wfh" ? adminNotificationFocus.requestId : null,
    onReview: async (requestId, command) => {
      const request = data.wfhPending?.requests?.find((item) => item.id === requestId);
      if (!canRenderRequestReviewActions(request)) {
        throw adminCommandUiError("This request is no longer eligible for WFH review.");
      }
      const payload = {
        decision: command.decision,
        ...(typeof command.reason === "string" && command.reason.trim()
          ? { reason: command.reason.trim() }
          : {}),
      };
      await runAdminRequestReviewCommand(
        target, lifetime, data,
        "/api/availability/wfh/" + encodeURIComponent(requestId) + "/review",
        payload,
        command.decision === "approved" ? "WFH approved." : "WFH rejected.",
      );
    },
  };

  const sections = buildAuthorizedAdminPageSections(data.actorGrants, {
    "organization-structure": OrganizationStructureSection ? createElement(OrganizationStructureSection, {
      canView: true,
      canManageOrganization: hasAdminPermission(data, "organisation.settings.manage"),
      canManageOfficeGeofence: hasAdminPermission(data, "availability.office_geofence.manage"),
      offices: { result: data.offices, issue: adminReadIssue(data.offices, "offices") },
      departments: { result: data.departments, issue: adminReadIssue(data.departments, "departments") },
      onCreateOffice: (input) => runAdminProtectedCommand(
        target, lifetime, ["organisation.settings.manage", "availability.office_geofence.manage"], {},
        "POST", "/api/offices", input, "Office created.",
      ),
      onCreateDepartment: (input) => runAdminProtectedCommand(
        target, lifetime, "organisation.settings.manage", {},
        "POST", "/api/organisation-departments", input, "Department created.",
      ),
    }) : createElement(OrganizationStructureLoadFailureSection),
    geofence: OfficeGeofenceSettings
      ? createElement(OfficeGeofenceSettings, projectOfficeGeofenceSettingsProps({
        result: data.geofenceOptions,
        issue: adminReadIssue(data.geofenceOptions, "office geofence settings"),
        canManage: canShowAdminFeature(data.actorGrants, "geofence"),
        onSave: async (officeId, input) => {
          if (!canShowAdminFeature(state.adminData?.actorGrants, "geofence")) {
            throw new Error("Your current access no longer allows attendance geofence changes. Refresh Admin to check access.");
          }
          return runAdminProtectedCommand(
            target,
            lifetime,
            "availability.office_geofence.manage",
            {},
            "PATCH",
            "/api/offices/" + encodeURIComponent(officeId) + "/geofence",
            input,
            "Office geofence updated.",
          );
        },
      }))
      : featureLoadFailure("Office geofencing"),
    "attendance-policy": AttendancePolicySettings
      ? createElement(AttendancePolicySettings, projectAttendancePolicySettingsProps({
        organisationRead: data.organisation,
        readFailure: adminFeatureReadError(data.organisation, "attendance policy"),
        canManage: hasAdminPermission(data, "organisation.settings.manage"),
        onSchedule: (request) => runAdminProtectedCommand(
          target, lifetime, "organisation.settings.manage", {},
          "PATCH", "/api/organisation/attendance-policy", request, "Attendance policy scheduled.",
        ),
      }))
      : featureLoadFailure("Attendance policy"),
    "availability-configuration": AvailabilityConfigurationSection
      ? createElement(AvailabilityConfigurationSection, availabilityConfigurationProps)
      : createElement(AvailabilityConfigurationLoadFailureSection),
    "wfh-overrides": WfhPolicyOverridesSection && wfhPolicyOverridesRoute
      ? createElement(WfhPolicyOverridesSection, wfhPolicyOverridesRoute.createProps(data))
      : createElement(WfhPolicyOverridesLoadFailureSection),
    roles: RolePermissionsSection ? createElement(RolePermissionsSection, {
      canView: hasAdminPermission(data, "roles.view"),
      canCreate: hasAdminPermission(data, "roles.create"),
      canEdit: hasAdminPermission(data, "roles.edit"),
      roles: { result: data.roles, issue: adminReadIssue(data.roles, "roles") },
      permissions: {
        result: data.permissions,
        issue: adminReadIssue(data.permissions, "the role permission catalogue"),
      },
      targetReads: {
        office: {
          result: data.offices,
          issue: adminReadIssue(data.offices, "office scope targets"),
          rows: data.offices?.offices,
          resource: "office scope targets",
        },
        organisation_department: {
          result: data.departments,
          issue: adminReadIssue(data.departments, "department scope targets"),
          rows: data.departments?.departments,
          resource: "department scope targets",
        },
        client: {
          result: data.workContext,
          issue: adminReadIssue(data.workContext, "client scope targets"),
          rows: data.workContext?.clients,
          resource: "client scope targets",
        },
        client_workstream: {
          result: data.workContext,
          issue: adminReadIssue(data.workContext, "client workstream scope targets"),
          rows: data.workContext?.clientWorkstreams,
          resource: "client workstream scope targets",
        },
        group: {
          result: data.workContext,
          issue: adminReadIssue(data.workContext, "group scope targets"),
          rows: data.workContext?.groups,
          resource: "group scope targets",
        },
      },
      formatError: (code) => errorMessages[code],
      onSearch: async (query) => {
        if (!isCurrentPageRequest(lifetime) || state.adminData !== data) {
          throw new Error("The Admin page changed before the role search could start. Refresh Admin and try again.");
        }
        try {
          return await pageApi("/api/roles?q=" + encodeURIComponent(query), lifetime);
        } catch (error) {
          if (error?.httpStatus === 403) {
            recoverProtectedCommandFailure(error, captureCommandContext(target), "Your role access changed. Admin is refreshing your permissions.");
          }
          throw new Error(errorText(error));
        }
      },
      onCreate: (payload) => saveAdminRole(target, lifetime, data, "create", undefined, payload),
      onSearchTargets: hasAdminPermission(data, "roles.view") ? searchRoleScopeTargets : undefined,
      onUpdate: (roleId, payload) => saveAdminRole(target, lifetime, data, "update", roleId, payload),
    }) : createElement(RolePermissionsLoadFailureSection),
    work: adminWorkContent ?? createElement(AdminWorkLoadFailureSection),
    people: PeopleAdministrationSection && peopleRoute
      ? createElement(PeopleAdministrationSection, peopleRoute.createProps(data))
      : createElement(PeopleAdministrationLoadFailureSection),
    "owner-transfer": OwnerTransfer && ownerTransferRoute
      ? createElement(OwnerTransfer, ownerTransferRoute.createProps(data))
      : createElement(OwnerTransferLoadFailureSection),
    "leave-review": LeaveRequestsSection
      ? createElement(LeaveRequestsSection, leaveReviewProps)
      : createElement(LeaveRequestsLoadFailureSection),
    "wfh-review": WfhRequestsReviewSection
      ? createElement(WfhRequestsReviewSection, wfhReviewProps)
      : createElement(WfhRequestsReviewLoadFailureSection),
    "historical-exceptions": HistoricalExceptions ? createElement(HistoricalExceptions, {
      capabilities: {
        view: true,
        resolve: hasAdminPermission(data, "availability.exception.resolve"),
      },
      read: projectHistoricalExceptionsReadState(
        data.exceptions,
        adminFeatureReadError(data.exceptions, "historical exceptions"),
      ),
      onResolve: async (exceptionId, outcome, auditNote) => {
        const exception = data.exceptions?.exceptions?.find((item) => item.id === exceptionId);
        if (!exception || exception.status !== "open" || exception.code === "availability.leave_attendance_conflict") {
          throw adminCommandUiError("This exception cannot be closed through the generic resolution flow.");
        }
        if (!hasAdminPermission(state.adminData, "availability.exception.resolve")) {
          throw adminCommandUiError("Your current access no longer allows exception resolution. Refresh Admin to check access.");
        }
        await runAdminRequestReviewCommand(
          target, lifetime, data,
          "/api/historical-exceptions/" + encodeURIComponent(exceptionId) + "/resolve",
          { status: outcome, note: auditNote },
          "Historical exception closed.",
        );
      },
    }) : featureLoadFailure("Historical exceptions"),
    audit: AuditEvents ? createElement(AuditEvents, {
      readState: projectAuditEventsReadState(
        data.audit,
        adminFeatureReadError(data.audit, "audit history"),
      ),
      onSearch: async ({ search }) => {
        if (!isCurrentPageRequest(lifetime) || state.adminData !== data) {
          throw adminCommandUiError("The Admin page changed before audit search could start. Refresh Admin and try again.");
        }
        const params = new URLSearchParams({ limit: "50", q: search.trim() });
        try {
          const result = await pageApi("/api/audit-events?" + params.toString(), lifetime);
          if (!isCurrentPageRequest(lifetime) || state.adminData !== data) {
            throw adminCommandUiError("The Admin page changed during audit search. Refresh Admin and try again.");
          }
          return projectAuditEventsReadState(result, adminFeatureReadError(result, "matching audit history"));
        } catch (error) {
          if (error?.httpStatus === 403) {
            recoverProtectedCommandFailure(error, captureCommandContext(target), "Your audit access changed. Admin is refreshing your permissions.");
          }
          throw adminCommandUiError(errorText(error));
        }
      },
    }) : featureLoadFailure("Audit history"),
    "notification-delivery": NotificationDeliveryOperations ? createElement(NotificationDeliveryOperations, {
      readState: projectNotificationDeliveryReadState(
        data.notificationDelivery,
        adminFeatureReadError(data.notificationDelivery, "notification delivery attempts"),
      ),
      canRequeue: hasAdminPermission(data, "notifications.manage"),
      onRetryRead: () => {
        if (target.isConnected && isCurrentPageRequest(lifetime)) void loadAdmin(lifetime);
      },
      onRequeue: async (deliveryId) => {
        const current = data;
        const freshCurrent = state.adminData;
        if (!target.isConnected || !isCurrentPageRequest(lifetime) || freshCurrent !== current) {
          throw adminCommandUiError("The Admin page changed before this delivery could be requeued.");
        }
        if (!canShowAdminFeature(state.actorGrants, "notificationDelivery") ||
            !hasAdminPermission(freshCurrent, "notifications.manage")) {
          throw adminCommandUiError("Your current access no longer allows this requeue. Refresh Admin to check permissions.");
        }
        const sourceRow = freshCurrent.notificationDelivery?.deliveries?.find((row) => row.id === deliveryId);
        if (!sourceRow || !["failed", "dead_letter"].includes(sourceRow.status)) {
          throw adminCommandUiError("This delivery is no longer in a requeueable state. Refresh Admin to check its status.");
        }
        await runAdminProtectedCommand(
          target,
          lifetime,
          (adminData) => adminData === current &&
            canShowAdminFeature(adminData.actorGrants, "notificationDelivery") &&
            hasAdminPermission(adminData, "notifications.manage"),
          {},
          "POST",
          "/api/notifications/delivery/" + encodeURIComponent(deliveryId) + "/requeue",
          undefined,
          "Notification requeue accepted. Delivery is not confirmed as sent.",
        );
      },
    }) : featureLoadFailure("Notification delivery"),
  });

  await mountAdminPage(target, lifetime, { state: { status: "ready" }, sections, summary, routeWarning });
  };
}
